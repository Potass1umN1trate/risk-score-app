import logging

import httpx

from app.config import settings
from .base import BlockchainFetcher, BlockchainRateLimitedError, BlockchainUnavailableError, Transaction

logger = logging.getLogger(__name__)

_TONCENTER_URL = "https://toncenter.com/api/v3/transactions"
_ORBS_URL = "https://ton.access.orbs.network/MT/api/v1/mainnet/toncenter/v3/transactions"
_TIMEOUT = httpx.Timeout(15.0)


class TonFetcher(BlockchainFetcher):
    """
    Fetches TON transactions via TonCenter API v3.
    Amount in nanoTON (1 TON = 1e9 nanoTON).
    Fallback: Orbs TON Access (TonCenter-compatible, no key required).
    """

    @property
    def network_code(self) -> str:
        return "TON"

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
        params = {"account": address, "limit": min(limit, 100), "sort": "desc"}

        try:
            headers = {}
            if settings.toncenter_api_key:
                headers["X-API-Key"] = settings.toncenter_api_key

            resp = await client.get(_TONCENTER_URL, headers=headers, params=params)
            if resp.status_code == 429:
                raise BlockchainRateLimitedError(f"TonCenter rate-limited (HTTP 429) for {address}")
            resp.raise_for_status()
            data = resp.json()
            return (data.get("transactions") or [])[:limit]
        except Exception as exc:
            logger.warning("TonCenter failed for %s: %s — trying Orbs", address, exc)

        try:
            resp = await client.get(_ORBS_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
            return (data.get("transactions") or [])[:limit]
        except BlockchainRateLimitedError:
            raise
        except Exception as exc:
            logger.error("Orbs TON also failed for %s: %s", address, exc)
            raise BlockchainUnavailableError(f"All TON providers failed for {address}") from exc

    def _normalize(self, raw_txs: list[dict], address: str) -> list[Transaction]:
        result: list[Transaction] = []
        seen: set[tuple] = set()

        for tx in raw_txs:
            tx_hash = tx.get("hash", "")
            timestamp = int(tx.get("now") or 0)

            in_msg = tx.get("in_msg") or {}
            out_msgs = tx.get("out_msgs") or []

            # Incoming message → address received funds
            if in_msg.get("source") and in_msg.get("destination") == address:
                from_addr = in_msg["source"]
                to_addr = address
                amount_nano = int(in_msg.get("value") or 0)

                if amount_nano > 0:
                    dedup_key = (tx_hash, from_addr, to_addr)
                    if dedup_key not in seen:
                        seen.add(dedup_key)
                        result.append(Transaction(
                            tx_hash=tx_hash,
                            from_address=from_addr,
                            to_address=to_addr,
                            amount=float(amount_nano) / 1e9,
                            timestamp=timestamp,
                        ))

            # Outgoing messages → address sent funds
            for msg in out_msgs:
                to_addr = msg.get("destination", "")
                amount_nano = int(msg.get("value") or 0)

                if not to_addr or amount_nano == 0:
                    continue

                dedup_key = (tx_hash, address, to_addr)
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)

                result.append(Transaction(
                    tx_hash=tx_hash,
                    from_address=address,
                    to_address=to_addr,
                    amount=float(amount_nano) / 1e9,
                    timestamp=timestamp,
                ))

        return result
