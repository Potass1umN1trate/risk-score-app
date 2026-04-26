import asyncio
import logging

import httpx

from app.config import settings
from .base import BlockchainFetcher, BlockchainRateLimitedError, BlockchainUnavailableError, Transaction

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(20.0)
_MAX_TX_FETCH = 20  # getTransaction is expensive — cap at 20 per request


def _helius_url() -> str:
    key = settings.helius_api_key
    if key:
        return f"https://mainnet.helius-rpc.com/?api-key={key}"
    return "https://api.mainnet-beta.solana.com"


class SolanaFetcher(BlockchainFetcher):
    """
    Fetches Solana transactions via Helius JSON-RPC.
    Amount in lamports (1 SOL = 1e9 lamports).
    Fallback: public Solana mainnet RPC (rate-limited, slower).
    """

    @property
    def network_code(self) -> str:
        return "SOL"

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
        url = _helius_url()
        is_public = "mainnet-beta" in url
        delay = 1.0 if is_public else 0.1

        try:
            # Step 1: get signatures
            resp = await client.post(url, json={
                "jsonrpc": "2.0", "id": 1,
                "method": "getSignaturesForAddress",
                "params": [address, {"limit": min(limit, 100)}],
            })
            if resp.status_code == 429:
                raise BlockchainRateLimitedError(f"Solana RPC rate-limited (HTTP 429) for {address}")
            resp.raise_for_status()
            sigs = resp.json().get("result") or []
            signatures = [s["signature"] for s in sigs if "signature" in s]

            # Step 2: fetch each transaction (capped)
            txs = []
            for sig in signatures[:_MAX_TX_FETCH]:
                await asyncio.sleep(delay)
                try:
                    r = await client.post(url, json={
                        "jsonrpc": "2.0", "id": 1,
                        "method": "getTransaction",
                        "params": [sig, {"encoding": "json", "maxSupportedTransactionVersion": 0}],
                    })
                    r.raise_for_status()
                    tx = r.json().get("result")
                    if tx:
                        txs.append(tx)
                except Exception as exc:
                    logger.debug("getTransaction %s failed: %s", sig, exc)

            return txs
        except BlockchainRateLimitedError:
            raise
        except Exception as exc:
            logger.error("Solana RPC failed for %s: %s", address, exc)
            raise BlockchainUnavailableError(f"SOL RPC unavailable for {address}") from exc

    def _normalize(self, raw_txs: list[dict], address: str) -> list[Transaction]:
        result: list[Transaction] = []
        seen: set[tuple] = set()

        for tx in raw_txs:
            try:
                meta = tx.get("meta") or {}
                if meta.get("err"):
                    continue

                sig = (tx.get("transaction") or {}).get("signatures", [""])[0]
                timestamp = tx.get("blockTime") or 0
                keys = (tx.get("transaction") or {}).get("message", {}).get("accountKeys") or []
                pre = meta.get("preBalances") or []
                post = meta.get("postBalances") or []

                if len(keys) < 2 or len(pre) < 2 or len(post) < 2:
                    continue

                from_addr = keys[0]
                to_addr = keys[1]
                amount_lamports = abs(int(pre[0]) - int(post[0]))

                if amount_lamports == 0 or not from_addr or not to_addr:
                    continue

                dedup_key = (sig, from_addr, to_addr)
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)

                result.append(Transaction(
                    tx_hash=sig,
                    from_address=from_addr,
                    to_address=to_addr,
                    amount=float(amount_lamports) / 1e9,
                    timestamp=timestamp,
                ))
            except Exception as exc:
                logger.debug("Failed to normalize Solana tx: %s", exc)

        return result
