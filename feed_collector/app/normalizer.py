"""
Minimal address normalizer for the feed_collector skeleton.

Supported network codes match the 10 project networks.
Unsupported networks are rejected so the pipeline can skip those records.
Full regex validation is deferred to a later iteration.
"""

_SUPPORTED_NETWORKS: frozenset[str] = frozenset(
    {"BTC", "ETH", "TRX", "SOL", "BNB", "XRP", "LTC", "DOGE", "ADA", "TON"}
)

_EVM_NETWORKS: frozenset[str] = frozenset({"ETH", "BNB"})


def is_supported_network(network_code: str) -> bool:
    return network_code.upper() in _SUPPORTED_NETWORKS


def normalize_address(network_code: str, address: str) -> str:
    """
    Return the canonical address form for the given network.

    ETH/BNB: strip whitespace and lowercase.
    All other supported networks: strip whitespace only.
    Callers must check is_supported_network() before calling this function.
    """
    stripped = address.strip()
    if network_code.upper() in _EVM_NETWORKS:
        return stripped.lower()
    return stripped
