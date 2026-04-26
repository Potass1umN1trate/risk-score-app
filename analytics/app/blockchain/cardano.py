import asyncio
import logging

import httpx

from app.config import settings
from .base import BlockchainFetcher, BlockchainRateLimitedError, BlockchainUnavailableError, Transaction

logger = logging.getLogger(__name__)

_BLOCKFROST_URL = "https://cardano-mainnet.blockfrost.io/api/v0"
_BLOCKCHAIR_URL = "https://api.blockchair.com/cardano/dashboards/address"
_TIMEOUT = httpx.Timeout(15.0)
_MAX_UTXO_FETCH = 10  # getTransaction/utxos is expensive — cap


class CardanoFetcher(BlockchainFetcher):
    """
    Fetches Cardano transactions via Blockfrost API.
    Amount in lovelace (1 ADA = 1e6 lovelace).
    Fallback: Blockchair public API.
    """

    @property
    def network_code(self) -> str:
        return "ADA"

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
        if not settings.blockfrost_api_key:
            logger.warning("Blockfrost API key not set — trying Blockchair for ADA")
            return await self._fetch_blockchair(client, address, limit)

        try:
            headers = {"project_id": settings.blockfrost_api_key}
            resp = await client.get(
                f"{_BLOCKFROST_URL}/addresses/{address}/transactions",
                headers=headers,
                params={"count": min(limit, 100), "order": "desc"},
            )
            if resp.status_code == 429:
                raise BlockchainRateLimitedError(f"Blockfrost rate-limited (HTTP 429) for {address}")
            resp.raise_for_status()
            tx_list = resp.json() or []

            # Fetch UTXO details for the first N transactions
            result = []
            for entry in tx_list[:_MAX_UTXO_FETCH]:
                tx_hash = entry.get("tx_hash", "")
                block_time = int(entry.get("block_time") or 0)
                try:
                    r = await client.get(
                        f"{_BLOCKFROST_URL}/txs/{tx_hash}/utxos",
                        headers=headers,
                    )
                    r.raise_for_status()
                    utxo = r.json()
                    utxo["_hash"] = tx_hash
                    utxo["_block_time"] = block_time
                    result.append(utxo)
                except Exception as exc:
                    logger.debug("Blockfrost UTXO fetch failed for %s: %s", tx_hash, exc)

            return result
        except BlockchainRateLimitedError:
            raise
        except Exception as exc:
            logger.warning("Blockfrost failed for %s: %s — trying Blockchair", address, exc)
            return await self._fetch_blockchair(client, address, limit)

    async def _fetch_blockchair(
        self,
        client: httpx.AsyncClient,
        address: str,
        limit: int,
    ) -> list[dict]:
        try:
            resp = await client.get(f"{_BLOCKCHAIR_URL}/{address}")
            resp.raise_for_status()
            data = resp.json()
            txs = (data.get("data") or {}).get(address, {}).get("transactions") or []
            return [{"hash": t, "_blockchair": True} for t in txs[:limit]]
        except BlockchainRateLimitedError:
            raise
        except Exception as exc:
            logger.error("Blockchair ADA also failed for %s: %s", address, exc)
            raise BlockchainUnavailableError(f"All ADA providers failed for {address}") from exc

    def _normalize(self, raw_txs: list[dict], address: str) -> list[Transaction]:
        result: list[Transaction] = []
        seen: set[tuple] = set()

        for tx in raw_txs:
            if tx.get("_blockchair"):
                continue

            tx_hash = tx.get("_hash", "")
            timestamp = int(tx.get("_block_time") or 0)
            inputs = tx.get("inputs") or []
            outputs = tx.get("outputs") or []

            input_addresses = {inp.get("address", "") for inp in inputs}
            our_address_is_sender = address in input_addresses

            for out in outputs:
                to_addr = out.get("address", "")
                amounts = out.get("amount") or []
                lovelace = next(
                    (int(a.get("quantity") or 0) for a in amounts if a.get("unit") == "lovelace"),
                    0,
                )

                if not to_addr or lovelace == 0:
                    continue

                if our_address_is_sender:
                    if to_addr == address:
                        continue  # change — skip
                    from_addr = address
                else:
                    if to_addr != address:
                        continue
                    from_addr = next(iter(input_addresses), "unknown")

                dedup_key = (tx_hash, from_addr, to_addr)
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)

                result.append(Transaction(
                    tx_hash=tx_hash,
                    from_address=from_addr,
                    to_address=to_addr,
                    amount=float(lovelace) / 1e6,
                    timestamp=timestamp,
                ))

        return result
