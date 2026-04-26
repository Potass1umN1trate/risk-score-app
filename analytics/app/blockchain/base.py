from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class Transaction:
    """Unified normalized transaction format for all networks."""
    tx_hash: str
    from_address: str
    to_address: str
    amount: float        # in native currency (BTC, ETH, …)
    timestamp: int       # unix timestamp (seconds)


class BlockchainError(Exception):
    """Base class for blockchain fetch errors surfaced to the caller."""


class BlockchainUnavailableError(BlockchainError):
    """All upstream providers for this network are unreachable or returned a server error."""


class BlockchainRateLimitedError(BlockchainError):
    """Upstream provider returned HTTP 429 or an equivalent rate-limit signal."""


class BlockchainFetcher(ABC):
    """
    Base class for fetching transactions from a blockchain.

    Each new network (ETH, TRX, SOL, …) implements this interface.
    This ensures that the graph builder and feature extractor work
    identically regardless of the data source.
    """

    @property
    @abstractmethod
    def network_code(self) -> str:
        """Network code: BTC, ETH, TRX, …"""
        ...

    @abstractmethod
    async def fetch(self, address: str, limit: int = 50) -> list[Transaction]:
        """
        Fetch the list of transactions for an address.

        Args:
            address: wallet address
            limit:   maximum number of transactions to return

        Returns:
            List of normalized transactions (empty list = address has no transactions).

        Raises:
            BlockchainRateLimitedError: upstream returned HTTP 429 or rate-limit signal.
            BlockchainUnavailableError: all upstream providers failed (timeout, 5xx, etc.).
        """
        ...
