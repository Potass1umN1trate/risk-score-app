import logging

import httpx

from app.config import settings
from app.validators.address import normalize_address_for_network
from .base import BlockchainFetcher, BlockchainRateLimitedError, BlockchainUnavailableError, Transaction

logger = logging.getLogger(__name__)

_TRONGRID_URL = "https://api.trongrid.io/v1/accounts"
_TRONSCAN_URL = "https://apilist.tronscanapi.com/api/transaction"
_TIMEOUT = httpx.Timeout(15.0)


class TronFetcher(BlockchainFetcher):
    """
    Fetches TRON TRX transactions via TronGrid API.
    Amount in sun (1 TRX = 1e6 sun).
    Fallback: TronScan public API.
    """

    @property
    def network_code(self) -> str:
        return "TRX"

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
            headers = {}
            if settings.trongrid_api_key:
                headers["TRON-PRO-API-KEY"] = settings.trongrid_api_key

            resp = await client.get(
                f"{_TRONGRID_URL}/{address}/transactions",
                headers=headers,
                params={"limit": min(limit, 200)},
            )
            if resp.status_code == 429:
                raise BlockchainRateLimitedError(f"TronGrid rate-limited (HTTP 429) for {address}")
            resp.raise_for_status()
            data = resp.json()
            return (data.get("data") or [])[:limit]
        except Exception as exc:
            logger.warning("TronGrid failed for %s: %s — trying TronScan", address, exc)

        try:
            headers = {}
            if settings.tronscan_api_key:
                headers["TRON-PRO-API-KEY"] = settings.tronscan_api_key

            resp = await client.get(
                _TRONSCAN_URL,
                headers=headers,
                params={"address": address, "limit": min(limit, 50)},
            )
            resp.raise_for_status()
            data = resp.json()
            return (data.get("data") or [])[:limit]
        except BlockchainRateLimitedError:
            raise
        except Exception as exc:
            logger.error("TronScan also failed for %s: %s", address, exc)
            raise BlockchainUnavailableError(f"All TRX providers failed for {address}") from exc

    def _normalize(self, raw_txs: list[dict]) -> list[Transaction]:
        result: list[Transaction] = []
        seen: set[tuple] = set()

        for tx in raw_txs:
            # TronGrid format
            if "raw_data" in tx:
                contracts = (tx.get("raw_data") or {}).get("contract") or []
                if not contracts:
                    continue
                val = (contracts[0].get("parameter") or {}).get("value") or {}
                from_addr = val.get("owner_address", "")
                to_addr = val.get("to_address", "")
                amount_sun = int(val.get("amount") or 0)
                timestamp = int((tx.get("block_timestamp") or 0)) // 1000
                tx_hash = tx.get("txID", "")
            else:
                # TronScan format
                from_addr = tx.get("ownerAddress", "")
                to_addr = tx.get("toAddress", "")
                amount_sun = int(tx.get("amount") or 0)
                timestamp = int((tx.get("timestamp") or 0)) // 1000
                tx_hash = tx.get("hash", "")

            if not from_addr or not to_addr or amount_sun == 0:
                continue

            from_addr = normalize_address_for_network("TRX", from_addr)
            to_addr = normalize_address_for_network("TRX", to_addr)

            dedup_key = (tx_hash, from_addr, to_addr)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            result.append(Transaction(
                tx_hash=tx_hash,
                from_address=from_addr,
                to_address=to_addr,
                amount=float(amount_sun) / 1e6,
                timestamp=timestamp,
            ))

        return result
