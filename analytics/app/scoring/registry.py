"""
Scorer registry: network_code → UniversalXGBoostScorer instance.

One model file, one scorer class, ten networks.
To add a new network: add its code to the list below.
"""

from app.config import settings
from app.scoring.base import BaseScorer
from app.scoring.xgboost_scorer import UniversalXGBoostScorer

_NETWORKS = ["BTC", "ETH", "TRX", "SOL", "BNB", "XRP", "LTC", "DOGE", "ADA", "TON"]

_REGISTRY: dict[str, BaseScorer] = {
    code: UniversalXGBoostScorer(network_code=code, model_path=settings.model_path)
    for code in _NETWORKS
}


def get_scorer(network_code: str) -> BaseScorer:
    scorer = _REGISTRY.get(network_code.upper())
    if scorer is None:
        supported = ", ".join(sorted(_REGISTRY.keys()))
        raise ValueError(
            f"No scorer for network: '{network_code}'. "
            f"Supported: {supported}"
        )
    return scorer


def supported_networks() -> list[str]:
    return list(_REGISTRY.keys())
