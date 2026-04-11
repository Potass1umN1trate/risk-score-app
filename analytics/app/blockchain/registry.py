from .base import BlockchainFetcher
from .bitcoin import BitcoinFetcher

# Registry: network_code → fetcher instance.
# To add a new network, implement a BlockchainFetcher subclass
# and register it here with a single line.
_REGISTRY: dict[str, BlockchainFetcher] = {
    fetcher.network_code: fetcher
    for fetcher in [
        BitcoinFetcher(),
        # EthereumFetcher(),  ← add here
        # TronFetcher(),
        # SolanaFetcher(),
    ]
}


def get_fetcher(network_code: str) -> BlockchainFetcher:
    fetcher = _REGISTRY.get(network_code.upper())
    if fetcher is None:
        supported = ", ".join(_REGISTRY.keys())
        raise ValueError(
            f"Unsupported network: '{network_code}'. "
            f"Supported: {supported}"
        )
    return fetcher


def supported_networks() -> list[str]:
    return list(_REGISTRY.keys())
