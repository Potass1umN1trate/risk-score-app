import logging

import httpx

from .base import BlockchainFetcher, Transaction

logger = logging.getLogger(__name__)

_BLOCKCYPHER_URL = "https://api.blockcypher.com/v1/doge/main/addrs"
_BLOCKCHAIR_URL = "https://api.blockchair.com/dogecoin/dashboards/address"
_TIMEOUT = httpx.Timeout(15.0)


class DogecoinFetcher(BlockchainFetcher):
    """
    Fetches Dogecoin transactions via BlockCypher public API.
    UTXO model — same normalization logic as Litecoin/Bitcoin.
    Amount in koinu (1 DOGE = 1e8 koinu).
    Fallback: Blockchair public API.
    """

    @property
    def network_code(self) -> str:
        return "DOGE"

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
            resp = await client.get(
                f"{_BLOCKCYPHER_URL}/{address}/full",
                params={"limit": min(limit, 50)},
            )
            resp.raise_for_status()
            data = resp.json()
            return (data.get("txs") or [])[:limit]
        except Exception as exc:
            logger.warning("BlockCypher DOGE failed for %s: %s — trying Blockchair", address, exc)

        try:
            resp = await client.get(f"{_BLOCKCHAIR_URL}/{address}")
            resp.raise_for_status()
            data = resp.json()
            txs = (data.get("data") or {}).get(address, {}).get("transactions") or []
            return [{"hash": t, "_blockchair": True} for t in txs[:limit]]
        except Exception as exc:
            logger.error("Blockchair DOGE also failed for %s: %s", address, exc)
            return []

    def _normalize(self, raw_txs: list[dict], address: str) -> list[Transaction]:
        result: list[Transaction] = []
        seen: set[tuple] = set()

        for tx in raw_txs:
            if tx.get("_blockchair"):
                continue

            tx_hash = tx.get("hash", "")
            raw_ts = tx.get("confirmed") or tx.get("received") or 0
            if isinstance(raw_ts, str):
                try:
                    from datetime import datetime, timezone
                    timestamp = int(datetime.fromisoformat(
                        raw_ts.rstrip("Z").split(".")[0]
                    ).replace(tzinfo=timezone.utc).timestamp())
                except Exception:
                    timestamp = 0
            else:
                timestamp = int(raw_ts)

            inputs = tx.get("inputs") or []
            outputs = tx.get("outputs") or []

            input_addresses = {
                addr
                for inp in inputs
                for addr in (inp.get("addresses") or [])
            }
            our_address_is_sender = address in input_addresses

            for out in outputs:
                out_addrs = out.get("addresses") or []
                if not out_addrs:
                    continue
                to_addr = out_addrs[0]
                amount_koinu = int(out.get("value") or 0)

                if amount_koinu == 0:
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
                    amount=float(amount_koinu) / 1e8,
                    timestamp=timestamp,
                ))

        return result
