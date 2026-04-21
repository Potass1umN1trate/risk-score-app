import httpx
import asyncio
from .base import BlockchainFetcher, Transaction

# Ankr public RPC — free, no API key required
_BASE_URL = "https://rpc.ankr.com/multichain"
# Etherscan-compatible public API (no key needed for basic usage)
_ETHERSCAN_URL = "https://api.etherscan.io/api"
_TIMEOUT = httpx.Timeout(15.0)


class EthereumFetcher(BlockchainFetcher):
    """
    Fetches Ethereum transactions via Etherscan public API.
    Amount in wei (native Ethereum unit, 1 ETH = 1e18 wei).
    """

    @property
    def network_code(self) -> str:
        return "ETH"

    async def fetch(self, address: str, limit: int = 50) -> list[Transaction]:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            return await self._fetch_normal(client, address, limit)

    async def _fetch_normal(
        self,
        client: httpx.AsyncClient,
        address: str,
        limit: int,
    ) -> list[Transaction]:
        params = {
            "module": "account",
            "action": "txlist",
            "address": address,
            "startblock": 0,
            "endblock": 99999999,
            "page": 1,
            "offset": min(limit, 200),
            "sort": "desc",
        }
        response = await client.get(_ETHERSCAN_URL, params=params)
        response.raise_for_status()
        data = response.json()

        txs = data.get("result") or []
        if not isinstance(txs, list):
            return []

        result: list[Transaction] = []
        for tx in txs[:limit]:
            amount = int(tx.get("value") or 0)  # wei
            if amount == 0:
                continue
            result.append(Transaction(
                tx_hash=tx.get("hash", ""),
                from_address=tx.get("from", "").lower(),
                to_address=(tx.get("to") or "").lower(),
                amount=float(amount),
                timestamp=int(tx.get("timeStamp") or 0),
            ))
        return result
