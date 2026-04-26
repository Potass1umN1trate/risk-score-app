import asyncio
import logging

import httpx

from app.config import settings
from .base import BlockchainFetcher, BlockchainRateLimitedError, BlockchainUnavailableError, Transaction

logger = logging.getLogger(__name__)

_ETHERSCAN_URL = "https://api.etherscan.io/v2/api"
_ETHERSCAN_CHAIN_ID = 1
_BLOCKCHAIR_URL = "https://api.blockchair.com/ethereum/dashboards/address"
_TIMEOUT = httpx.Timeout(15.0)


class EthereumFetcher(BlockchainFetcher):
    """
    Fetches Ethereum transactions via Etherscan API v2.
    Amount in wei (1 ETH = 1e18 wei).
    Fallback: Blockchair public API.
    """

    @property
    def network_code(self) -> str:
        return "ETH"

    async def fetch(self, address: str, limit: int = 50) -> list[Transaction]:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            raw_txs = await self._fetch_raw(client, address, limit)
        return self._normalize(raw_txs, address)

    async def _fetch_raw(
        self,
        client: httpx.AsyncClient,
        address: str,
        limit: int,
    ) -> list[dict]:
        try:
            params = {
                "chainid": _ETHERSCAN_CHAIN_ID,
                "module": "account",
                "action": "txlist",
                "address": address,
                "startblock": 0,
                "endblock": 99999999,
                "page": 1,
                "offset": min(limit, 200),
                "sort": "desc",
                "apikey": settings.etherscan_api_key or "freekey",
            }

            resp = await client.get(_ETHERSCAN_URL, params=params)
            if resp.status_code == 429:
                raise BlockchainRateLimitedError(f"Etherscan rate-limited (HTTP 429) for {address}")
            resp.raise_for_status()
            data = resp.json()
            result = data.get("result") or []
            if isinstance(result, list):
                return result[:limit]
        except BlockchainRateLimitedError:
            raise
        except Exception as exc:
            logger.warning("Etherscan failed for %s: %s — trying Blockchair", address, exc)

        try:
            resp = await client.get(f"{_BLOCKCHAIR_URL}/{address}")
            resp.raise_for_status()
            data = resp.json()
            txs = (data.get("data") or {}).get(address, {}).get("transactions") or []
            return [{"hash": t, "_blockchair": True} for t in txs[:limit]]
        except BlockchainRateLimitedError:
            raise
        except Exception as exc:
            logger.error("Blockchair ETH also failed for %s: %s", address, exc)
            raise BlockchainUnavailableError(f"All ETH providers failed for {address}") from exc

    def _normalize(self, raw_txs: list[dict], address: str) -> list[Transaction]:
        result: list[Transaction] = []
        seen: set[tuple] = set()

        for tx in raw_txs:
            if tx.get("_blockchair"):
                continue  # Blockchair fallback returns only hashes — skip normalization

            amount_wei = int(tx.get("value") or 0)
            if amount_wei == 0:
                continue

            from_addr = (tx.get("from") or "").lower()
            to_addr = (tx.get("to") or "").lower()
            if not from_addr or not to_addr:
                continue

            tx_hash = tx.get("hash", "")
            dedup_key = (tx_hash, from_addr, to_addr)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            result.append(Transaction(
                tx_hash=tx_hash,
                from_address=from_addr,
                to_address=to_addr,
                amount=float(amount_wei) / 1e18,
                timestamp=int(tx.get("timeStamp") or 0),
            ))

        return result
