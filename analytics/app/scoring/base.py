"""
Abstract base class for all scorers.

Mirrors the BlockchainFetcher pattern — every scorer implements this interface,
guaranteeing uniform output regardless of network or model type.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.graph.features import AddressFeatures


@dataclass
class ScoreResult:
    """Scoring result for a single address."""
    score: float          # 0.0 … 100.0
    risk_level: str       # LOW | MEDIUM | HIGH
    model_version: str    # for reproducibility (e.g. "btc_xgboost_v1")
    raw_probability: float  # raw P(illicit) from the model before scaling


def score_to_risk_level(score: float) -> str:
    """
    Map a numeric score to a risk level label.
    Thresholds are aligned with the thesis specification.
    LOW < 25 ≤ MEDIUM < 60 ≤ HIGH
    """
    if score < 25:
        return "LOW"
    elif score < 60:
        return "MEDIUM"
    else:
        return "HIGH"


class BaseScorer(ABC):
    """
    Base scorer class.

    Every implementation (XGBoost, rule-based, …) must:
      1. Return its network_code.
      2. Implement score() — takes AddressFeatures, returns ScoreResult.
    """

    @property
    @abstractmethod
    def network_code(self) -> str:
        """BTC, ETH, TRX, …"""
        ...

    @abstractmethod
    def score(self, features: AddressFeatures) -> ScoreResult:
        """
        Compute the risk score.

        Args:
            features: feature vector extracted from the transaction graph

        Returns:
            ScoreResult with the final score and risk level.
        """
        ...
