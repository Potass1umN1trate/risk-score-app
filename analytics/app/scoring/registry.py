"""
Scorer registry: network_code → BaseScorer instance.

Mirrors blockchain/registry.py — one file, one line to add a new network.
"""

from app.config import settings
from app.scoring.base import BaseScorer
from app.scoring.xgboost_scorer import XGBoostBitcoinScorer

_REGISTRY: dict[str, BaseScorer] = {
    scorer.network_code: scorer
    for scorer in [
        XGBoostBitcoinScorer(model_path=settings.btc_model_path),
        # EthereumScorer(),
        # TronScorer(),
    ]
}


def get_scorer(network_code: str) -> BaseScorer:
    scorer = _REGISTRY.get(network_code.upper())
    if scorer is None:
        supported = ", ".join(_REGISTRY.keys())
        raise ValueError(
            f"No scorer for network: '{network_code}'. "
            f"Supported: {supported}"
        )
    return scorer


def supported_networks() -> list[str]:
    return list(_REGISTRY.keys())
