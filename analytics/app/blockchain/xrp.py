import logging

import httpx

from .base import BlockchainFetcher, Transaction

logger = logging.getLogger(__name__)

_RIPPLE_RPC = "https://s1.ripple.com:51234/"
_XRPSCAN_URL = "https://api.xrpscan.com/api/v1/account"
_TIMEOUT = httpx.Timeout(15.0)
# XRP epoch starts 2000-01-01 00:00:00 UTC; Unix epoch is 1970-01-01
_XRP_EPOCH_OFFSET = 946684800


class XRPFetcher(BlockchainFetcher):
    """
    Fetches XRP Ledger transactions via Ripple public JSON-RPC.
    Amount in drops (1 XRP = 1e6 drops).
    Fallback: XRPScan public API.
    """

    @property
    def network_code(self) -> str:
        return "XRP"

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
            resp = await client.post(_RIPPLE_RPC, json={
                "method": "account_tx",
                "params": [{"account": address, "limit": min(limit, 200)}],
            })
            resp.raise_for_status()
            data = resp.json()
            txs = (data.get("result") or {}).get("transactions") or []
            return [t.get("tx") or t for t in txs[:limit]]
        except Exception as exc:
            logger.warning("Ripple RPC failed for %s: %s — trying XRPScan", address, exc)

        try:
            resp = await client.get(
                f"{_XRPSCAN_URL}/{address}/transactions",
                params={"limit": min(limit, 200)},
            )
            resp.raise_for_status()
            return (resp.json() or [])[:limit]
        except Exception as exc:
            logger.error("XRPScan also failed for %s: %s", address, exc)
            return []

    def _normalize(self, raw_txs: list[dict]) -> list[Transaction]:
        result: list[Transaction] = []
        seen: set[tuple] = set()

        for tx in raw_txs:
            if tx.get("TransactionType") not in (None, "Payment"):
                # Only process Payment transactions
                if tx.get("TransactionType") and tx.get("TransactionType") != "Payment":
                    continue

            from_addr = tx.get("Account") or tx.get("source_account", "")
            to_addr = tx.get("Destination") or tx.get("destination_account", "")
            raw_amount = tx.get("Amount") or tx.get("amount", 0)

            # Amount can be a dict (IOU) or a string (drops of XRP)
            if isinstance(raw_amount, dict):
                continue  # skip IOU tokens, only native XRP
            amount_drops = int(raw_amount or 0)

            if not from_addr or not to_addr or amount_drops == 0:
                continue

            tx_hash = tx.get("hash", "")
            # XRP date is seconds since XRP epoch; convert to Unix
            xrp_date = int(tx.get("date") or tx.get("executed_time") or 0)
            timestamp = xrp_date + _XRP_EPOCH_OFFSET if xrp_date else 0

            dedup_key = (tx_hash, from_addr, to_addr)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            result.append(Transaction(
                tx_hash=tx_hash,
                from_address=from_addr,
                to_address=to_addr,
                amount=float(amount_drops) / 1e6,
                timestamp=timestamp,
            ))

        return result
