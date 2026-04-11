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
            List of normalized transactions.
            Raises an exception if the address is not found or the API is unavailable.
        """
        ...
