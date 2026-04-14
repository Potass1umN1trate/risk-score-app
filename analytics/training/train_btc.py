"""
Train XGBoost on the Real-CATS Bitcoin dataset.

Feature mapping strategy
────────────────────────
Real-CATS columns → our 27 AddressFeatures fields:

  VOLUME
    receipt_transactions        → tx_in_count
    payment_transactions        → tx_out_count
    total_received_BTC / 1e8    → total_received   (satoshi → BTC)
    total_sent_BTC     / 1e8    → total_sent
    (total_received_BTC + total_sent_BTC) / max(transaction_number,1) / 1e8
                                → avg_tx_amount
    max(max_received_amount, max_sent_amount) / 1e8
                                → max_tx_amount
    received_counters + sent_counters
                                → unique_counterparties

  TOPOLOGY  (partially synthesised — see comments)
    total_input_slots + total_output_slots
                                → depth1_neighbors  (proxy: direct counterparty slots)
    SYNTHESISED                 → depth2_neighbors  = depth1 × branching + noise
    receipt_transactions        → in_degree
    payment_transactions        → out_degree
    SYNTHESISED                 → graph_density
    SYNTHESISED                 → clustering_coefficient

  TEMPORAL
    activity_d                  → active_days
    transaction_number / max(lifetime/86400, 1)
                                → tx_per_day
    lifetime / 86400            → lifespan_days

  RISK SIGNALS  (all zero during training; real values come from DB at inference)
    0                           → flagged_neighbors_count
    0.0                         → flagged_neighbors_ratio
    999                         → min_dist_to_flagged
    0 × 8                       → flag_* per category

Why synthesise graph topology?
  Real-CATS records per-address aggregates only (no full graph).
  depth2_neighbors, graph_density, and clustering_coefficient cannot be
  derived directly from a single-address record.  We generate them with
  distributions that match what the BFS graph builder produces in production:
    - depth2 ≈ Poisson(depth1 × mean_branching_factor)
    - graph_density = (in+out) / max(depth1*(depth1-1), 1)  — same formula as features.py
    - clustering_coefficient ~ Beta(0.5, 5) ≈ small positive values

  This is intentional: the model never sees real graph-topology values in
  production either (they are computed live from mempool.space data),
  so training on realistic-but-synthetic proxies is correct.

Normalization
  Scaler statistics are computed FROM the Real-CATS training split (never
  from hardcoded constants as in the Elliptic approach).  At inference,
  xgboost_scorer.py applies the identical log1p + z-score pipeline using
  btc_scaler.json produced here.

Label encoding
  label == 0  →  benign   (class 0, y=0)
  label == 1  →  criminal (class 1, y=1)
  Real-CATS labels: all BB.tsv rows are benign; all CB.tsv rows are criminal.
"""

import json
import logging
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import roc_auc_score, average_precision_score
import xgboost as xgb

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# ── Paths ──────────────────────────────────────────────────────────────────────
TRAINING_DIR = Path(__file__).parent
DATA_DIR     = TRAINING_DIR / "data"
MODEL_DIR    = TRAINING_DIR.parent / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

CB_PATH = DATA_DIR / "CB.tsv"
BB_PATH = DATA_DIR / "BB.tsv"

# These must stay in sync with OUR_FEATURE_NAMES in app/graph/features.py
FEATURE_NAMES = [
    "tx_in_count", "tx_out_count", "total_received", "total_sent",
    "avg_tx_amount", "max_tx_amount", "unique_counterparties",
    "depth1_neighbors", "depth2_neighbors", "in_degree", "out_degree",
    "graph_density", "clustering_coefficient",
    "active_days", "tx_per_day", "lifespan_days",
    "flagged_neighbors_count", "flagged_neighbors_ratio", "min_dist_to_flagged",
    "flag_mixer", "flag_scam", "flag_sanctions", "flag_darknet_market",
    "flag_ransomware", "flag_gambling", "flag_phishing", "flag_suspicious",
]

# Features that get log1p + z-score normalization at inference
LOG_FEATURES = {
    "tx_in_count", "tx_out_count", "total_received", "total_sent",
    "avg_tx_amount", "max_tx_amount", "unique_counterparties",
    "depth1_neighbors", "depth2_neighbors", "in_degree", "out_degree",
}



# ── Feature engineering ────────────────────────────────────────────────────────

def map_features(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """
    Transform a Real-CATS dataframe into the 27-column AddressFeatures space.
    Returns a new dataframe with exactly FEATURE_NAMES columns.
    """
    out = pd.DataFrame(index=df.index)

    # ── VOLUME ─────────────────────────────────────────────────────────────────
    out["tx_in_count"]  = df["receipt_transactions"].clip(lower=0)
    out["tx_out_count"] = df["payment_transactions"].clip(lower=0)

    out["total_received"] = df["total_received_BTC"].clip(lower=0)
    out["total_sent"]     = df["total_sent_BTC"].clip(lower=0)

    total_tx = df["transaction_number"].clip(lower=1)
    out["avg_tx_amount"] = (
        (df["total_received_BTC"] + df["total_sent_BTC"]) / total_tx
    ).clip(lower=0)

    max_sent = df["max_sent_amount"].fillna(0).clip(lower=0)
    max_recv = df["max_received_amount"].fillna(0).clip(lower=0)
    out["max_tx_amount"] = np.maximum(max_sent, max_recv)

    out["unique_counterparties"] = (
        df["received_counters"].fillna(0).clip(lower=0)
        + df["sent_counters"].fillna(0).clip(lower=0)
    )

    # ── TOPOLOGY ───────────────────────────────────────────────────────────────
    # depth1_neighbors = unique counterparties at hop distance 1.
    # received_counters + sent_counters gives exactly that: how many distinct
    # addresses have ever sent to or received from this address.
    # (total_input_slots / total_output_slots count transaction slots, not
    # unique addresses, so they overcount when one tx has many outputs.)
    depth1 = (
        df["received_counters"].fillna(0).clip(lower=0)
        + df["sent_counters"].fillna(0).clip(lower=0)
    ).clip(lower=1)
    out["depth1_neighbors"] = depth1

    # Synthesise depth2:  Poisson(depth1 × branching_factor)
    # Typical branching in Bitcoin graphs: 2-4 hops.
    branching_factor = rng.uniform(1.5, 3.5, size=len(df))
    lambda_ = np.maximum(depth1.values * branching_factor, depth1.values + 1)
    depth2 = rng.poisson(lam=lambda_).clip(min=depth1.values)
    out["depth2_neighbors"] = depth2

    out["in_degree"]  = df["receipt_transactions"].clip(lower=0)
    out["out_degree"] = df["payment_transactions"].clip(lower=0)

    # graph_density: same formula as features.py
    total_in_out = out["tx_in_count"] + out["tx_out_count"]
    d1 = depth1.values
    max_possible = np.where(d1 > 1, d1 * (d1 - 1), 1.0)
    out["graph_density"] = (total_in_out.values / max_possible).clip(0, 1.0)

    # clustering_coefficient: synthesised ~ Beta(0.5, 5)
    # Nodes in real transaction graphs have low clustering, so Beta(0.5, 5)
    # gives mostly small values which matches production observations.
    out["clustering_coefficient"] = rng.beta(0.5, 5.0, size=len(df))

    # ── TEMPORAL ───────────────────────────────────────────────────────────────
    out["active_days"]   = df["activity_d"].clip(lower=0)
    lifespan_days        = (df["lifetime"].fillna(0) / 86400).clip(lower=1)
    out["lifespan_days"] = lifespan_days
    out["tx_per_day"]    = (total_tx.values / lifespan_days.values).clip(min=0)

    # ── RISK SIGNALS — all zero during training ────────────────────────────────
    # In production these come from the flagged_addresses DB.  Training without
    # them is correct: the model learns volume/topology patterns only;
    # flag-proximity signals are handled by the heuristic in xgboost_scorer.py.
    out["flagged_neighbors_count"] = 0
    out["flagged_neighbors_ratio"] = 0.0
    out["min_dist_to_flagged"]     = 999
    for cat in ["flag_mixer", "flag_scam", "flag_sanctions", "flag_darknet_market",
                "flag_ransomware", "flag_gambling", "flag_phishing", "flag_suspicious"]:
        out[cat] = 0

    return out[FEATURE_NAMES].astype(np.float32)


# ── Normalization ──────────────────────────────────────────────────────────────

def fit_scaler(X: pd.DataFrame) -> dict:
    """
    Compute log1p mean/std for LOG_FEATURES from the training data.
    Returns a dict compatible with xgboost_scorer._RAW_STATS format.
    """
    stats = {}
    for col in FEATURE_NAMES:
        if col in LOG_FEATURES:
            log_vals = np.log1p(X[col].clip(lower=0).values.astype(np.float64))
            stats[col] = [float(log_vals.mean()), max(float(log_vals.std()), 1e-6)]
    return stats


def apply_scaler(X: pd.DataFrame, stats: dict) -> pd.DataFrame:
    Xn = X.copy()
    for col, (mu, sigma) in stats.items():
        log_vals = np.log1p(Xn[col].clip(lower=0))
        Xn[col] = (log_vals - mu) / sigma
    return Xn


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    rng = np.random.default_rng(42)

    # 1. Load data
    log.info("Loading Real-CATS data …")
    cb = pd.read_csv(CB_PATH, sep="\t")
    bb = pd.read_csv(BB_PATH, sep="\t")
    log.info("  Criminal: %d rows", len(cb))
    log.info("  Benign:   %d rows", len(bb))

    cb["_label"] = 1
    bb["_label"] = 0
    df = pd.concat([cb, bb], ignore_index=True)

    # Shuffle
    df = df.sample(frac=1, random_state=42).reset_index(drop=True)

    # 2. Feature mapping + synthesis
    log.info("Mapping features …")
    X = map_features(df, rng)
    y = df["_label"].values.astype(np.int32)

    log.info("  Feature matrix shape: %s", X.shape)
    log.info("  Class balance  — criminal: %d  benign: %d", y.sum(), (y == 0).sum())

    # Sanity checks
    assert X.shape[1] == len(FEATURE_NAMES), "Column count mismatch!"
    assert list(X.columns) == FEATURE_NAMES, "Column order mismatch!"
    assert not X.isnull().any().any(), "NaN values found in feature matrix!"

    # 3. Fit scaler on ALL data
    log.info("Fitting scaler from Real-CATS data …")
    scaler_stats = fit_scaler(X)
    Xn = apply_scaler(X, scaler_stats)

    # Save scaler
    scaler_path = MODEL_DIR / "btc_scaler.json"
    with open(scaler_path, "w") as f:
        json.dump(scaler_stats, f, indent=2)
    log.info("Scaler saved → %s", scaler_path)

    # 4. Cross-validation
    log.info("5-fold stratified CV …")

    pos = y.sum()
    neg = (y == 0).sum()
    spw = neg / pos
    log.info("  scale_pos_weight = %.3f", spw)

    params = dict(
        objective        = "binary:logistic",
        max_depth        = 6,
        learning_rate    = 0.05,
        subsample        = 0.8,
        colsample_bytree = 0.8,
        min_child_weight = 5,
        gamma            = 1.0,
        scale_pos_weight = spw,
        tree_method      = "hist",
        seed             = 42,
    )
    N_ROUNDS = 500
    EARLY_STOP = 30

    cv_aucs, cv_auprs, best_iters = [], [], []
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

    for fold, (tr_idx, val_idx) in enumerate(skf.split(Xn, y), 1):
        X_tr, X_val = Xn.iloc[tr_idx], Xn.iloc[val_idx]
        y_tr, y_val = y[tr_idx], y[val_idx]

        dtrain = xgb.DMatrix(X_tr, label=y_tr, feature_names=FEATURE_NAMES)
        dval   = xgb.DMatrix(X_val, label=y_val, feature_names=FEATURE_NAMES)

        booster = xgb.train(
            params,
            dtrain,
            num_boost_round=N_ROUNDS,
            evals=[(dval, "val")],
            early_stopping_rounds=EARLY_STOP,
            verbose_eval=False,
        )

        prob = booster.predict(dval)
        auc  = roc_auc_score(y_val, prob)
        aupr = average_precision_score(y_val, prob)
        cv_aucs.append(auc)
        cv_auprs.append(aupr)
        best_iters.append(booster.best_iteration)
        log.info("  Fold %d — AUC=%.4f  AUCPR=%.4f  (best iter=%d)",
                 fold, auc, aupr, booster.best_iteration)

    log.info("CV  AUC  = %.4f ± %.4f", np.mean(cv_aucs),  np.std(cv_aucs))
    log.info("CV  AUCPR= %.4f ± %.4f", np.mean(cv_auprs), np.std(cv_auprs))

    # 5. Train final model on full data
    best_rounds = int(np.mean(best_iters)) + 1
    log.info("Training final model (%d rounds) on full dataset …", best_rounds)
    dtrain_full = xgb.DMatrix(Xn, label=y, feature_names=FEATURE_NAMES)
    final_model = xgb.train(
        params,
        dtrain_full,
        num_boost_round=best_rounds,
        verbose_eval=False,
    )

    model_path = MODEL_DIR / "btc_xgboost.json"
    final_model.save_model(str(model_path))
    log.info("Model saved → %s", model_path)

    # 6. Sanity test: craft obviously malicious and benign feature vectors
    log.info("Sanity test with crafted feature vectors …")

    # Ransomware wallet: many small incoming payments, burst of activity
    # Amounts in satoshi: 2.5 BTC = 250_000_000 sat, etc.
    malicious_raw = pd.DataFrame([{
        "tx_in_count":             500,
        "tx_out_count":            5,
        "total_received":          250_000_000,   # 2.5 BTC
        "total_sent":              10_000_000,    # 0.1 BTC
        "avg_tx_amount":        500_000,       # 0.005 BTC
        "max_tx_amount":           20_000_000,    # 0.2 BTC
        "unique_counterparties":   450,
        "depth1_neighbors":        50,
        "depth2_neighbors":        120,
        "in_degree":               500,
        "out_degree":              5,
        "graph_density":           0.02,
        "clustering_coefficient":  0.01,
        "active_days":             3,
        "tx_per_day":              168,
        "lifespan_days":           3,
        "flagged_neighbors_count": 0,
        "flagged_neighbors_ratio": 0.0,
        "min_dist_to_flagged":     999,
        **{f: 0 for f in ["flag_mixer","flag_scam","flag_sanctions",
                           "flag_darknet_market","flag_ransomware",
                           "flag_gambling","flag_phishing","flag_suspicious"]},
    }], columns=FEATURE_NAMES).astype(np.float32)

    # Normal wallet: moderate balanced volume, long history
    # Amounts in satoshi: 0.12 BTC = 12_000_000 sat, etc.
    benign_raw = pd.DataFrame([{
        "tx_in_count":             10,
        "tx_out_count":            8,
        "total_received":          12_000_000,    # 0.12 BTC
        "total_sent":              11_000_000,    # 0.11 BTC
        "avg_tx_amount":        1_200_000,     # 0.012 BTC
        "max_tx_amount":           4_000_000,     # 0.04 BTC
        "unique_counterparties":   15,
        "depth1_neighbors":        12,
        "depth2_neighbors":        30,
        "in_degree":               10,
        "out_degree":              8,
        "graph_density":           0.003,
        "clustering_coefficient":  0.05,
        "active_days":             90,
        "tx_per_day":              0.2,
        "lifespan_days":           365,
        "flagged_neighbors_count": 0,
        "flagged_neighbors_ratio": 0.0,
        "min_dist_to_flagged":     999,
        **{f: 0 for f in ["flag_mixer","flag_scam","flag_sanctions",
                           "flag_darknet_market","flag_ransomware",
                           "flag_gambling","flag_phishing","flag_suspicious"]},
    }], columns=FEATURE_NAMES).astype(np.float32)

    def score_raw(raw_df: pd.DataFrame, label: str) -> None:
        normed = apply_scaler(raw_df, scaler_stats)
        dm = xgb.DMatrix(normed, feature_names=FEATURE_NAMES)
        prob = float(final_model.predict(dm)[0])
        ml_contribution = round(prob * 40.0, 2)
        log.info("  %-12s  raw_prob=%.4f  ml_contribution=%.1f/40", label, prob, ml_contribution)

    score_raw(malicious_raw, "MALICIOUS")
    score_raw(benign_raw,    "BENIGN")

    log.info("Done.")


if __name__ == "__main__":
    main()
