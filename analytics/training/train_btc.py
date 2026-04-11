"""
Train an XGBoost model on the Elliptic Dataset for Bitcoin.

═══════════════════════════════════════════════════════════
ABOUT THE ELLIPTIC DATASET
═══════════════════════════════════════════════════════════
A public labeled Bitcoin transaction dataset:
  - 203,769 transactions, graph of 234,355 edges
  - Class 1 = illicit (drugs, fraud, scams — ~4,600 tx)
  - Class 2 = licit  (exchanges, pools, services — ~42,000 tx)
  - Class 0 = unknown (no label)

Files (download from Kaggle: ellipticco/elliptic-data-set):
  elliptic_txs_features.csv  — 166 features per transaction
  elliptic_txs_classes.csv   — labels (unknown / 1 / 2)

Elliptic column layout (0-based after txId):
  0        = timestep
  1        = number of inputs
  2        = number of outputs
  3        = total BTC transacted
  4        = fees
  5        = total input BTC
  6        = total output BTC
  7-93     = other local features (UTXO patterns, script types, …)
  94-165   = aggregated neighbour features

IMPORTANT: Elliptic features are pre-normalized (z-scores by the dataset authors).
Our AddressFeatures use raw values (BTC, counts, ratios).
We must apply the same z-score normalization to raw features at inference time.

Strategy:
  1. Build a 27-column proxy matrix from Elliptic by mapping closest columns.
  2. For each mapped column compute mean/std from Elliptic labeled data.
  3. Train XGBoost on the normalized proxy matrix.
  4. Save mean/std as btc_scaler.json alongside the model.
  5. At inference time: normalize raw AddressFeatures → pass to model.

Flag features (mixer, scam, …) are always 0 in Elliptic training data —
the model learns volume/topology patterns; flags add extra signal at inference.

═══════════════════════════════════════════════════════════
HOW TO RUN
═══════════════════════════════════════════════════════════
  1. kaggle datasets download ellipticco/elliptic-data-set -p training/data --unzip
  2. cd analytics && python -m training.train_btc
  Output: models/btc_xgboost.json + models/btc_scaler.json
"""

from __future__ import annotations

import json
import sys
import logging
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import roc_auc_score, average_precision_score, classification_report

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ─── Paths ────────────────────────────────────────────────────────────────────

SCRIPT_DIR  = Path(__file__).parent
DATA_DIR    = SCRIPT_DIR / "data"
MODEL_DIR   = SCRIPT_DIR.parent / "models"
MODEL_PATH  = MODEL_DIR / "btc_xgboost.json"
SCALER_PATH = MODEL_DIR / "btc_scaler.json"

FEATURES_CSV = DATA_DIR / "elliptic_txs_features.csv"
CLASSES_CSV  = DATA_DIR / "elliptic_txs_classes.csv"

# ─── Proxy feature mapping ────────────────────────────────────────────────────
# (our_feature_name, elliptic_col_idx_after_txId)
# None → column is always 0 in training (flag features, temporal features)
FEATURE_MAP: list[tuple[str, int | None]] = [
    # Volume
    ("tx_in_count",              1),
    ("tx_out_count",             2),
    ("total_received",           5),
    ("total_sent",               6),
    ("median_tx_amount",         7),   # avg BTC received — closest proxy
    ("max_tx_amount",            9),   # std BTC received — proxy for extremes
    ("unique_counterparties",    3),   # total BTC transacted — proxy
    # Topology
    ("depth1_neighbors",        94),   # neighbour n_inputs — proxy for breadth
    ("depth2_neighbors",        95),   # neighbour n_outputs
    ("in_degree",                1),   # same as tx_in_count
    ("out_degree",               2),   # same as tx_out_count
    ("graph_density",         None),
    ("clustering_coefficient", None),
    # Temporal (not in Elliptic)
    ("active_days",            None),
    ("tx_per_day",             None),
    ("lifespan_days",          None),
    # Risk signals (not in Elliptic — always 0 during training)
    ("flagged_neighbors_count",  None),
    ("flagged_neighbors_ratio",  None),
    ("min_dist_to_flagged",      None),
    ("flag_mixer",               None),
    ("flag_scam",                None),
    ("flag_sanctions",           None),
    ("flag_darknet_market",      None),
    ("flag_ransomware",          None),
    ("flag_gambling",            None),
    ("flag_phishing",            None),
    ("flag_suspicious",          None),
]

OUR_FEATURE_NAMES = [name for name, _ in FEATURE_MAP]
# Indices of features that ARE mapped to Elliptic columns (normalization applies)
MAPPED_INDICES = [i for i, (_, idx) in enumerate(FEATURE_MAP) if idx is not None]


# ─── Data loading + normalization ─────────────────────────────────────────────

def load_elliptic() -> tuple[np.ndarray, np.ndarray, dict]:
    """
    Load Elliptic, build 27-dim proxy matrix, fit z-score normalization.

    Returns:
        X_norm: normalized float32 array (N, 27)
        y:      int array (N,)
        scaler: {"mean": [...], "std": [...]} for 27 features
    """
    if not FEATURES_CSV.exists() or not CLASSES_CSV.exists():
        log.error(
            "Dataset not found in %s\n"
            "Download from: https://www.kaggle.com/datasets/ellipticco/elliptic-data-set\n"
            "Expected files:\n  %s\n  %s",
            DATA_DIR, FEATURES_CSV, CLASSES_CSV,
        )
        sys.exit(1)

    log.info("Loading features from %s …", FEATURES_CSV)
    feat_df = pd.read_csv(FEATURES_CSV, header=None)
    txids = feat_df.iloc[:, 0]

    # Build raw proxy matrix
    proxy = np.zeros((len(feat_df), len(FEATURE_MAP)), dtype=np.float64)
    for col_idx, (_, elliptic_idx) in enumerate(FEATURE_MAP):
        if elliptic_idx is not None:
            proxy[:, col_idx] = feat_df.iloc[:, elliptic_idx + 1].values  # +1 for txId

    log.info("Loading labels from %s …", CLASSES_CSV)
    cls_df = pd.read_csv(CLASSES_CSV, header=None, names=["txid", "class"])
    cls_df["label"] = cls_df["class"].map({"1": 1, "2": 0, 1: 1, 2: 0})

    merged = pd.DataFrame({"txid": txids.astype(str)}).merge(
        cls_df.assign(txid=cls_df["txid"].astype(str)), on="txid", how="left"
    )
    mask = merged["label"].notna()

    X_labeled = proxy[mask.values]
    y_labeled  = merged.loc[mask, "label"].values.astype(int)

    # Fit z-score scaler on labeled data (only mapped columns)
    mean = np.zeros(len(FEATURE_MAP), dtype=np.float64)
    std  = np.ones(len(FEATURE_MAP),  dtype=np.float64)

    for i in MAPPED_INDICES:
        col = X_labeled[:, i]
        mean[i] = col.mean()
        std[i]  = col.std()
        if std[i] < 1e-9:
            std[i] = 1.0  # avoid division by zero for constant columns

    # Normalize
    X_norm = X_labeled.copy()
    for i in MAPPED_INDICES:
        X_norm[:, i] = (X_labeled[:, i] - mean[i]) / std[i]

    X_norm = X_norm.astype(np.float32)

    scaler = {
        "mean": mean.tolist(),
        "std":  std.tolist(),
        "feature_names": OUR_FEATURE_NAMES,
        "mapped_indices": MAPPED_INDICES,
    }

    log.info(
        "Labeled samples: %d  (illicit=%d %.1f%%, licit=%d)",
        len(y_labeled), y_labeled.sum(), 100 * y_labeled.mean(), (y_labeled == 0).sum(),
    )
    return X_norm, y_labeled, scaler


# ─── Training ─────────────────────────────────────────────────────────────────

def train(X: np.ndarray, y: np.ndarray) -> xgb.Booster:
    """5-fold stratified CV, then final training on the full dataset."""
    neg, pos = (y == 0).sum(), (y == 1).sum()
    scale_pos = neg / pos
    log.info("scale_pos_weight = %.1f  (neg=%d / pos=%d)", scale_pos, neg, pos)

    params = {
        "objective":        "binary:logistic",
        "eval_metric":      ["auc", "aucpr"],
        "max_depth":        6,
        "eta":              0.05,
        "subsample":        0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 3,
        "scale_pos_weight": scale_pos,
        "seed":             42,
        "tree_method":      "hist",
        "device":           "cpu",
    }

    log.info("5-fold stratified cross-validation …")
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    aucs, auprs, best_iters = [], [], []

    for fold, (tr_idx, val_idx) in enumerate(skf.split(X, y), 1):
        dtrain = xgb.DMatrix(X[tr_idx],  label=y[tr_idx],  feature_names=OUR_FEATURE_NAMES)
        dval   = xgb.DMatrix(X[val_idx], label=y[val_idx], feature_names=OUR_FEATURE_NAMES)

        bst = xgb.train(
            params, dtrain,
            num_boost_round=600,
            evals=[(dval, "val")],
            early_stopping_rounds=40,
            verbose_eval=False,
        )
        best_iters.append(bst.best_iteration)

        proba = bst.predict(dval)
        aucs.append(roc_auc_score(y[val_idx], proba))
        auprs.append(average_precision_score(y[val_idx], proba))
        log.info("  Fold %d — AUC=%.4f  AUCPR=%.4f  best_round=%d",
                 fold, aucs[-1], auprs[-1], bst.best_iteration)

    log.info(
        "CV mean: AUC=%.4f ± %.4f  |  AUCPR=%.4f ± %.4f",
        np.mean(aucs), np.std(aucs), np.mean(auprs), np.std(auprs),
    )

    log.info("Training final model on full dataset …")
    dtrain_full = xgb.DMatrix(X, label=y, feature_names=OUR_FEATURE_NAMES)
    best_rounds = int(np.mean(best_iters)) + 1

    final_model = xgb.train(
        params, dtrain_full,
        num_boost_round=best_rounds,
        verbose_eval=100,
    )

    preds = final_model.predict(dtrain_full)
    log.info(
        "\nFull-dataset classification report:\n%s",
        classification_report((preds > 0.5).astype(int), y,
                               target_names=["licit", "illicit"]),
    )
    return final_model


# ─── Save ─────────────────────────────────────────────────────────────────────

def save_artifacts(model: xgb.Booster, scaler: dict) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model.save_model(str(MODEL_PATH))
    log.info("Model  saved → %s", MODEL_PATH)
    SCALER_PATH.write_text(json.dumps(scaler, indent=2))
    log.info("Scaler saved → %s", SCALER_PATH)


# ─── Entrypoint ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("=== BTC XGBoost Training ===")
    X, y, scaler = load_elliptic()
    model = train(X, y)
    save_artifacts(model, scaler)
    log.info("Done.")
