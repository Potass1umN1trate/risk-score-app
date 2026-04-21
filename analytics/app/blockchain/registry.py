from .base import BlockchainFetcher
from .bitcoin import BitcoinFetcher
from .ethereum import EthereumFetcher
from .tron import TronFetcher
from .solana import SolanaFetcher
from .bnb import BNBFetcher
from .xrp import XRPFetcher
from .litecoin import LitecoinFetcher
from .dogecoin import DogecoinFetcher
from .cardano import CardanoFetcher
from .ton import TonFetcher

# Registry: network_code → fetcher instance.
# To add a new network, implement a BlockchainFetcher subclass and add it here.
_REGISTRY: dict[str, BlockchainFetcher] = {
    fetcher.network_code: fetcher
    for fetcher in [
        BitcoinFetcher(),
        EthereumFetcher(),
        TronFetcher(),
        SolanaFetcher(),
        BNBFetcher(),
        XRPFetcher(),
        LitecoinFetcher(),
        DogecoinFetcher(),
        CardanoFetcher(),
        TonFetcher(),
    ]
}


def get_fetcher(network_code: str) -> BlockchainFetcher:
    fetcher = _REGISTRY.get(network_code.upper())
    if fetcher is None:
        supported = ", ".join(sorted(_REGISTRY.keys()))
        raise ValueError(
            f"Unsupported network: '{network_code}'. "
            f"Supported: {supported}"
        )
    return fetcher


def supported_networks() -> list[str]:
    return list(_REGISTRY.keys())
