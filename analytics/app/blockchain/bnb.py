import logging

import httpx

from app.config import settings
from .base import BlockchainFetcher, Transaction

logger = logging.getLogger(__name__)

_BSCSCAN_URL = "https://api.bscscan.com/api"
_BLOCKCHAIR_URL = "https://api.blockchair.com/bnb/dashboards/address"
_TIMEOUT = httpx.Timeout(15.0)


class BNBFetcher(BlockchainFetcher):
    """
    Fetches BNB Smart Chain transactions via BscScan (Etherscan-compatible API v2, chainid=56).
    Amount in wei (1 BNB = 1e18 wei).
    Fallback: Blockchair public API.
    """

    @property
    def network_code(self) -> str:
        return "BNB"

    async def fetch(self, address: str, limit: int = 50) -> list[Transaction]:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            raw_txs = await self._fetch_raw(client, address, limit)
        return self._normalize(raw_txs)

    async def _fetch_raw(
        self,
        client: httpx.AsyncClient,
        address: str,
        limit: int,
    ) -> list[dict]:
        try:
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
            if settings.etherscan_api_key:
                params["apikey"] = settings.etherscan_api_key

            resp = await client.get(_BSCSCAN_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
            result = data.get("result") or []
            if isinstance(result, list):
                return result[:limit]
        except Exception as exc:
            logger.warning("BscScan failed for %s: %s — trying Blockchair", address, exc)

        try:
            resp = await client.get(f"{_BLOCKCHAIR_URL}/{address}")
            resp.raise_for_status()
            data = resp.json()
            txs = (data.get("data") or {}).get(address, {}).get("transactions") or []
            return [{"hash": t, "_blockchair": True} for t in txs[:limit]]
        except Exception as exc:
            logger.error("Blockchair BNB also failed for %s: %s", address, exc)
            return []

    def _normalize(self, raw_txs: list[dict]) -> list[Transaction]:
        result: list[Transaction] = []
        seen: set[tuple] = set()

        for tx in raw_txs:
            if tx.get("_blockchair"):
                continue

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
