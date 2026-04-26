import logging
from datetime import datetime, timezone

import httpx

from app.config import settings
from .base import BlockchainFetcher, BlockchainRateLimitedError, BlockchainUnavailableError, Transaction

logger = logging.getLogger(__name__)

_MORALIS_URL = "https://deep-index.moralis.io/api/v2.2"
_TIMEOUT = httpx.Timeout(15.0)


class BNBFetcher(BlockchainFetcher):
    """Fetches BNB Smart Chain transactions via Moralis API."""

    @property
    def network_code(self) -> str:
        return "BNB"

    async def fetch(self, address: str, limit: int = 50) -> list[Transaction]:
        if not settings.moralis_api_key:
            logger.warning("moralis_api_key is not set — skipping BNB fetch for %s", address)
            return []

        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.get(
                    f"{_MORALIS_URL}/{address}",
                    params={"chain": "bsc", "limit": limit},
                    headers={"X-API-Key": settings.moralis_api_key},
                )
                if resp.status_code == 429:
                    raise BlockchainRateLimitedError(f"Moralis BNB rate-limited (HTTP 429) for {address}")
                resp.raise_for_status()
                data = resp.json()
        except BlockchainRateLimitedError:
            raise
        except Exception as exc:
            logger.warning("Moralis BNB fetch failed for %s: %s", address, exc)
            raise BlockchainUnavailableError(f"BNB provider (Moralis) unavailable for {address}") from exc

        return self._normalize(data.get("result") or [])

    def _normalize(self, raw_txs: list[dict]) -> list[Transaction]:
        result: list[Transaction] = []
        seen: set[tuple] = set()

        for tx in raw_txs:
            try:
                amount_wei = int(tx.get("value") or 0)
            except (ValueError, TypeError):
                continue
            if amount_wei == 0:
                continue

            from_addr = (tx.get("from_address") or "").lower()
            to_addr = (tx.get("to_address") or "").lower()
            if not from_addr or not to_addr:
                continue

            tx_hash = tx.get("hash", "")
            dedup_key = (tx_hash, from_addr, to_addr)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            try:
                ts_str = tx.get("block_timestamp", "")
                timestamp = int(
                    datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    .astimezone(timezone.utc)
                    .timestamp()
                )
            except Exception:
                timestamp = 0

            result.append(Transaction(
                tx_hash=tx_hash,
                from_address=from_addr,
                to_address=to_addr,
                amount=float(amount_wei) / 1e18,
                timestamp=timestamp,
            ))

        return result
