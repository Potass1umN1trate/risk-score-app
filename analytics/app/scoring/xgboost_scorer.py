"""
XGBoost scorer for Bitcoin.

Loads the model from btc_xgboost.json (trained on the Elliptic dataset).
Falls back to a heuristic scorer if the file is missing, so the service
does not crash before the model has been trained.

Why a fallback instead of a hard failure?
  During development it is convenient to run the service without a trained model.
  In production the model file must always exist — a k8s readiness probe
  can verify this via the /model/status endpoint.
"""

import logging
from pathlib import Path

import numpy as np

from app.graph.features import AddressFeatures
from app.scoring.base import BaseScorer, ScoreResult, score_to_risk_level

logger = logging.getLogger(__name__)


class XGBoostBitcoinScorer(BaseScorer):
    """
    BTC scorer backed by XGBoost.

    Expects the model in XGBoost JSON format (Booster.save_model / load_model).
    Class 1 = illicit (suspicious), class 0 = licit.
    score = P(illicit) * 100.
    """

    MODEL_VERSION = "btc_xgboost_v1"

    def __init__(self, model_path: str) -> None:
        self._model = None
        self._load_model(model_path)

    def _load_model(self, model_path: str) -> None:
        path = Path(model_path)
        if not path.exists():
            logger.warning(
                "XGBoost model not found at '%s'. "
                "Using heuristic fallback scorer. "
                "Train the model with analytics/training/train_btc.py",
                model_path,
            )
            return

        try:
            import xgboost as xgb  # deferred import: avoids failure if xgb is unused
            booster = xgb.Booster()
            booster.load_model(str(path))
            self._model = booster
            logger.info("XGBoost BTC model loaded from '%s'", model_path)
        except Exception as exc:
            logger.error("Failed to load XGBoost model: %s", exc)

    @property
    def network_code(self) -> str:
        return "BTC"

    def score(self, features: AddressFeatures) -> ScoreResult:
        if self._model is not None:
            return self._score_with_model(features)
        return self._heuristic_score(features)

    def _score_with_model(self, features: AddressFeatures) -> ScoreResult:
        import xgboost as xgb

        vec = features.to_numpy().reshape(1, -1)
        dmatrix = xgb.DMatrix(vec)
        # predict returns P(illicit) in [0, 1]
        prob = float(self._model.predict(dmatrix)[0])
        score = round(prob * 100, 2)

        return ScoreResult(
            score=score,
            risk_level=score_to_risk_level(score),
            model_version=self.MODEL_VERSION,
            raw_probability=prob,
        )

    def _heuristic_score(self, features: AddressFeatures) -> ScoreResult:
        """
        Simple heuristic used when the model file is absent.
        Based on the most informative features (per SHAP analysis in the thesis).
        """
        score = 0.0

        # Proximity to flagged addresses — strongest signal
        if features.min_dist_to_flagged <= 1:
            score += 40
        elif features.min_dist_to_flagged <= 2:
            score += 20
        elif features.min_dist_to_flagged <= 3:
            score += 10

        # Sanctions and mixers — critical categories
        score += min(features.flag_sanctions * 30, 40)
        score += min(features.flag_mixer * 20, 30)
        score += min(features.flag_darknet_market * 15, 25)
        score += min((features.flag_scam + features.flag_ransomware + features.flag_phishing) * 10, 20)

        # Fraction of flagged addresses in the neighbourhood
        score += features.flagged_neighbors_ratio * 30

        # Very high transaction frequency — possible structuring?
        if features.tx_per_day > 50:
            score += 10
        elif features.tx_per_day > 20:
            score += 5

        score = min(score, 100.0)
        prob = score / 100.0

        return ScoreResult(
            score=round(score, 2),
            risk_level=score_to_risk_level(score),
            model_version=f"{self.MODEL_VERSION}_heuristic",
            raw_probability=round(prob, 4),
        )

    @property
    def is_model_loaded(self) -> bool:
        return self._model is not None
