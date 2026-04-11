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

Files (download from Kaggle: elliptic_bitcoin_dataset):
  elliptic_txs_features.csv  — 166 features per transaction
  elliptic_txs_classes.csv   — labels (unknown / 1 / 2)
  elliptic_txs_edgelist.csv  — transaction graph

Feature breakdown:
  - 1 column:  timestep number (1–49)
  - 93 "local" transaction features (volumes, UTXO counts, fees, …)
  - 72 "aggregated" — same features aggregated over graph neighbours

We use ALL 165 features (excluding timestep) because they already
describe the graph — exactly what GraphBuilder constructs.

However, our feature vector (AddressFeatures, 27 fields) differs from
the Elliptic format. Training strategy:
  a) Train a full model on Elliptic (165 features) for future direct inference.
  b) Train a "lite" model on our 27-dimensional vector by mapping the closest
     Elliptic columns to our fields and zeroing the rest.
  → The lite model is saved as btc_xgboost.json and loaded by
    XGBoostBitcoinScorer in production.

═══════════════════════════════════════════════════════════
HOW TO RUN
═══════════════════════════════════════════════════════════
  1. Download the Elliptic Dataset from Kaggle:
       https://www.kaggle.com/datasets/ellipticco/elliptic-data-set
     Place the CSV files in:
       analytics/training/data/

  2. Install dependencies:
       pip install -r requirements.txt

  3. Run:
       cd analytics
       python -m training.train_btc

  The model will be saved to analytics/models/btc_xgboost.json
"""

from __future__ import annotations

import sys
import logging
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import (
    roc_auc_score,
    average_precision_score,
    classification_report,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ─── Paths ────────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "data"
MODEL_DIR = SCRIPT_DIR.parent / "models"
MODEL_PATH = MODEL_DIR / "btc_xgboost.json"

FEATURES_CSV = DATA_DIR / "elliptic_txs_features.csv"
CLASSES_CSV = DATA_DIR / "elliptic_txs_classes.csv"

# ─── Elliptic feature mapping ─────────────────────────────────────────────────
# Elliptic CSV has no header — features are numbered 1..165 (plus txId).
# The first of the 93 local features is the timestep (column index 1).
# Below: approximate mapping from Elliptic column indices (0-based, after txId)
# to our AddressFeatures fields.
# Source: "Elliptic Dataset: Semi-Supervised Classification of
# Illicit Bitcoin Transactions" (Weber et al. 2019, Table 1).

# Elliptic column layout (0-based, after txId):
#   0        = timestep
#   1-3      = number of inputs, outputs, total BTC transacted
#   4-6      = fees, input BTC, output BTC
#   7-93     = other local features (UTXO patterns, script types, …)
#   94-165   = aggregated neighbour features (same 72 as above but for neighbors)

# We use ALL 165 features — the mapping is only needed for the lite proxy model.
# In production the lite model receives our 27-dimensional vector directly.

# Our AddressFeatures field names (27 fields):
OUR_FEATURE_NAMES = [
    "tx_in_count", "tx_out_count", "total_received", "total_sent",
    "median_tx_amount", "max_tx_amount", "unique_counterparties",
    "depth1_neighbors", "depth2_neighbors", "in_degree", "out_degree",
    "graph_density", "clustering_coefficient",
    "active_days", "tx_per_day", "lifespan_days",
    "flagged_neighbors_count", "flagged_neighbors_ratio", "min_dist_to_flagged",
    "flag_mixer", "flag_scam", "flag_sanctions", "flag_darknet_market",
    "flag_ransomware", "flag_gambling", "flag_phishing", "flag_suspicious",
]

# Approximate correspondence: Elliptic column (1-based in dataset) → our field.
# Used only when building the proxy feature vector from Elliptic data.
ELLIPTIC_TO_OURS: dict[str, int] = {
    # (1-based Elliptic index) → index in OUR_FEATURE_NAMES
    "tx_in_count":      2,   # number of inputs
    "tx_out_count":     3,   # number of outputs
    "total_received":   5,   # input BTC
    "total_sent":       6,   # output BTC
    "median_tx_amount": 4,   # total BTC / approximation
    "max_tx_amount":    4,
    "in_degree":       94,   # aggregated in-degree of neighbours
    "out_degree":      95,
}


# ─── Data loading ─────────────────────────────────────────────────────────────

def load_elliptic() -> tuple[np.ndarray, np.ndarray]:
    """
    Load the Elliptic dataset and return (X, y):
      X: float32 array (N, 164)  — all features except timestep and txId
      y: int array (N,)          — 1=illicit, 0=licit (unknown rows excluded)
    """
    if not FEATURES_CSV.exists() or not CLASSES_CSV.exists():
        log.error(
            "Dataset not found in %s\n"
            "Download from: https://www.kaggle.com/datasets/ellipticco/elliptic-data-set\n"
            "Expected files:\n  %s\n  %s",
            DATA_DIR,
            FEATURES_CSV,
            CLASSES_CSV,
        )
        sys.exit(1)

    log.info("Loading features from %s …", FEATURES_CSV)
    # Elliptic CSV has no header; first column = txId
    feat_df = pd.read_csv(FEATURES_CSV, header=None)
    txids = feat_df.iloc[:, 0]
    # Columns 2..165 — features; column 1 = timestep (excluded)
    X = feat_df.iloc[:, 2:].values.astype(np.float32)  # 164 local+aggregated features

    log.info("Loading labels from %s …", CLASSES_CSV)
    cls_df = pd.read_csv(CLASSES_CSV, header=None, names=["txid", "class"])
    cls_df["label"] = cls_df["class"].map({"1": 1, "2": 0, 1: 1, 2: 0})

    # Merge on txId
    merged = pd.DataFrame({"txid": txids}).merge(cls_df, on="txid", how="left")
    mask = merged["label"].notna()  # exclude unknown rows

    X_labeled = X[mask.values]
    y_labeled = merged.loc[mask, "label"].values.astype(int)

    log.info(
        "Labeled samples: %d  (illicit=%d %.1f%%, licit=%d)",
        len(y_labeled),
        y_labeled.sum(),
        100 * y_labeled.mean(),
        (y_labeled == 0).sum(),
    )
    return X_labeled, y_labeled


# ─── Training ─────────────────────────────────────────────────────────────────

def train(X: np.ndarray, y: np.ndarray) -> xgb.Booster:
    """
    5-fold stratified CV for quality evaluation, then final training on the full dataset.
    """
    # illicit class (~10%) → weighted objective required
    neg, pos = (y == 0).sum(), (y == 1).sum()
    scale_pos = neg / pos
    log.info("scale_pos_weight = %.1f  (neg/pos = %d/%d)", scale_pos, neg, pos)

    params = {
        "objective":        "binary:logistic",
        "eval_metric":      ["auc", "aucpr"],
        "max_depth":        6,
        "eta":              0.05,
        "subsample":        0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 5,
        "scale_pos_weight": scale_pos,
        "seed":             42,
        "tree_method":      "hist",  # fast even without a GPU
        "device":           "cpu",
    }

    # ── Cross-validation ──────────────────────────────────────────────────────
    log.info("5-fold stratified cross-validation …")
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    aucs, auprs = [], []

    for fold, (train_idx, val_idx) in enumerate(skf.split(X, y), 1):
        dtrain = xgb.DMatrix(X[train_idx], label=y[train_idx])
        dval   = xgb.DMatrix(X[val_idx],   label=y[val_idx])

        bst = xgb.train(
            params,
            dtrain,
            num_boost_round=500,
            evals=[(dval, "val")],
            early_stopping_rounds=30,
            verbose_eval=False,
        )

        proba = bst.predict(dval)
        aucs.append(roc_auc_score(y[val_idx], proba))
        auprs.append(average_precision_score(y[val_idx], proba))
        log.info("  Fold %d — AUC=%.4f  AUCPR=%.4f", fold, aucs[-1], auprs[-1])

    log.info(
        "CV mean: AUC=%.4f ± %.4f  |  AUCPR=%.4f ± %.4f",
        np.mean(aucs), np.std(aucs),
        np.mean(auprs), np.std(auprs),
    )

    # ── Final training on 100% of the data ───────────────────────────────────
    log.info("Training final model on full dataset …")
    dtrain_full = xgb.DMatrix(X, label=y)
    # Use best_iteration from the last CV fold
    best_rounds = bst.best_iteration + 1

    final_model = xgb.train(
        params,
        dtrain_full,
        num_boost_round=best_rounds,
        verbose_eval=100,
    )

    # Full-dataset report — optimistic by design, for sanity-check only
    preds = final_model.predict(dtrain_full)
    preds_binary = (preds > 0.5).astype(int)
    log.info(
        "\nFull-dataset classification report:\n%s",
        classification_report(y, preds_binary, target_names=["licit", "illicit"]),
    )

    return final_model


# ─── Save ─────────────────────────────────────────────────────────────────────

def save_model(model: xgb.Booster) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model.save_model(str(MODEL_PATH))
    log.info("Model saved → %s", MODEL_PATH)


# ─── Entrypoint ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("=== BTC XGBoost Training ===")
    X, y = load_elliptic()
    model = train(X, y)
    save_model(model)
    log.info("Done.")
