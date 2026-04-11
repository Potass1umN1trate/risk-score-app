"""
XGBoost scorer for Bitcoin.

Architecture: hybrid scoring.
  1. FLAG SIGNAL  — heuristic weights applied to DB-sourced flag features.
                    This is the dominant signal (sanctions +35, mixer +25, …).
  2. VOLUME SIGNAL — XGBoost model trained on Real-CATS dataset adds a
                    continuous score based on volume/topology patterns.

Model files (produced by training/train_btc.py):
  models/btc_xgboost.json  — trained Booster
  models/btc_scaler.json   — log1p mean/std per feature (computed from Real-CATS)
"""

import json
import logging
from pathlib import Path

import numpy as np

from app.graph.features import AddressFeatures, OUR_FEATURE_NAMES
from app.scoring.base import BaseScorer, ScoreResult, score_to_risk_level

logger = logging.getLogger(__name__)

# Scaler stats are loaded from btc_scaler.json (produced by train_btc.py).
# Fallback hardcoded stats are used only if the file is missing.
_FALLBACK_RAW_STATS: dict[str, tuple[float, float]] = {
    "tx_in_count":           (0.7,  0.6),
    "tx_out_count":          (0.9,  0.7),
    "total_received":        (0.5,  1.5),
    "total_sent":            (0.5,  1.5),
    "median_tx_amount":      (0.1,  0.8),
    "max_tx_amount":         (0.3,  1.2),
    "unique_counterparties": (0.8,  0.7),
    "depth1_neighbors":      (0.7,  0.6),
    "depth2_neighbors":      (1.2,  0.8),
    "in_degree":             (0.7,  0.6),
    "out_degree":            (0.9,  0.7),
}

_RAW_STATS: dict[str, tuple[float, float]] = {}   # populated in _load()

# Features that get log1p + z-score normalization at inference
_LOG_FEATURES = set(_FALLBACK_RAW_STATS.keys())


class XGBoostBitcoinScorer(BaseScorer):
    """
    BTC scorer: heuristic flag signal + XGBoost volume/topology signal.
    """

    MODEL_VERSION = "btc_xgboost_v1"

    def __init__(self, model_path: str) -> None:
        self._model = None
        self._load(model_path)

    def _load(self, model_path: str) -> None:
        global _RAW_STATS

        # Load scaler stats from btc_scaler.json (same directory as model)
        scaler_file = Path(model_path).parent / "btc_scaler.json"
        if scaler_file.exists():
            try:
                with open(scaler_file) as f:
                    loaded = json.load(f)
                # btc_scaler.json stores {feature: [mean, std]}
                _RAW_STATS = {k: tuple(v) for k, v in loaded.items()}
                logger.info("Scaler loaded from '%s'", scaler_file)
            except Exception as exc:
                logger.warning("Could not load scaler: %s — using fallback stats", exc)
                _RAW_STATS = dict(_FALLBACK_RAW_STATS)
        else:
            logger.warning("btc_scaler.json not found — using fallback normalization stats")
            _RAW_STATS = dict(_FALLBACK_RAW_STATS)

        model_file = Path(model_path)
        if not model_file.exists():
            logger.warning(
                "XGBoost model not found at '%s'. "
                "Heuristic-only mode active. "
                "Run: cd analytics && python -m training.train_btc",
                model_path,
            )
            return
        try:
            import xgboost as xgb
            booster = xgb.Booster()
            booster.load_model(str(model_file))
            self._model = booster
            logger.info("XGBoost BTC model loaded from '%s'", model_file)
        except Exception as exc:
            logger.error("Failed to load XGBoost model: %s", exc)

    @property
    def network_code(self) -> str:
        return "BTC"

    def score(self, features: AddressFeatures) -> ScoreResult:
        flag_score = self._flag_score(features)
        ml_score   = self._ml_score(features) if self._model else 0.0

        # Combine: flags dominate, ML adds up to 40 extra points
        combined = flag_score + ml_score * (1.0 - flag_score / 100.0)
        combined = min(round(combined, 2), 100.0)

        version = self.MODEL_VERSION if self._model else f"{self.MODEL_VERSION}_heuristic"

        return ScoreResult(
            score=combined,
            risk_level=score_to_risk_level(combined),
            model_version=version,
            raw_probability=round(combined / 100.0, 4),
        )

    # ── Flag-based heuristic (always runs) ───────────────────────────────────

    def _flag_score(self, f: AddressFeatures) -> float:
        score = 0.0

        # Proximity to any flagged address
        if f.min_dist_to_flagged <= 1:
            score += 40
        elif f.min_dist_to_flagged <= 2:
            score += 20
        elif f.min_dist_to_flagged <= 3:
            score += 10

        # Category weights
        score += min(f.flag_sanctions     * 35, 45)
        score += min(f.flag_mixer         * 25, 35)
        score += min(f.flag_darknet_market* 20, 30)
        score += min(f.flag_ransomware    * 20, 30)
        score += min(f.flag_scam          * 15, 25)
        score += min(f.flag_phishing      * 15, 20)
        score += min(f.flag_suspicious    * 10, 15)
        score += min(f.flag_gambling      *  5, 10)

        # Ratio of flagged neighbours
        score += f.flagged_neighbors_ratio * 25

        # Very high transaction frequency → possible structuring
        if f.tx_per_day > 100:
            score += 15
        elif f.tx_per_day > 50:
            score += 10
        elif f.tx_per_day > 20:
            score += 5

        return min(score, 100.0)

    # ── XGBoost volume/topology signal (0-40 contribution) ───────────────────

    def _ml_score(self, features: AddressFeatures) -> float:
        """
        Returns 0-40 points based on volume/topology patterns.
        Raw features are log1p-transformed then approximately z-scored
        to match the Elliptic pre-normalized feature distribution.
        """
        import xgboost as xgb
        import pandas as pd

        raw = features.to_numpy().copy()
        norm = raw.copy()

        for i, name in enumerate(OUR_FEATURE_NAMES):
            if name in _LOG_FEATURES:
                # log1p compresses large values; then approximate z-score
                log_val = np.log1p(max(float(raw[i]), 0.0))
                mu, sigma = _RAW_STATS[name]
                norm[i] = (log_val - mu) / sigma

        df = pd.DataFrame([norm], columns=OUR_FEATURE_NAMES)
        prob = float(self._model.predict(xgb.DMatrix(df))[0])

        # Scale to 0-40 contribution range
        return round(prob * 40.0, 2)

    @property
    def is_model_loaded(self) -> bool:
        return self._model is not None
