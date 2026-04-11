import httpx
import asyncio
from .base import BlockchainFetcher, Transaction

# mempool.space — public Esplora API, free, no API key required
_BASE_URL = "https://mempool.space/api"
# Timeout per request
_TIMEOUT = httpx.Timeout(15.0)


class BitcoinFetcher(BlockchainFetcher):
    """
    Fetches Bitcoin transactions via mempool.space (Esplora API).

    Bitcoin uses the UTXO model: a single transaction may have
    multiple inputs (from) and multiple outputs (to).
    We split it into individual from→to pairs to match the
    account-based model used by ETH, TRX, etc.
    """

    @property
    def network_code(self) -> str:
        return "BTC"

    async def fetch(self, address: str, limit: int = 50) -> list[Transaction]:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            raw_txs = await self._fetch_raw(client, address, limit)

        return self._normalize(address, raw_txs)

    async def _fetch_raw(
        self,
        client: httpx.AsyncClient,
        address: str,
        limit: int,
    ) -> list[dict]:
        """
        mempool.space returns at most 25 transactions per page.
        We issue multiple requests using after_txid pagination
        until we reach `limit` or run out of data.
        """
        collected: list[dict] = []
        after_txid: str | None = None

        while len(collected) < limit:
            url = f"{_BASE_URL}/address/{address}/txs"
            if after_txid:
                url += f"/chain/{after_txid}"

            response = await client.get(url)
            response.raise_for_status()
            page: list[dict] = response.json()

            if not page:
                break

            collected.extend(page)
            after_txid = page[-1]["txid"]

            # API returns pages of 25; fewer means no more data
            if len(page) < 25:
                break

            # Small delay to avoid rate-limiting
            await asyncio.sleep(0.2)

        return collected[:limit]

    def _normalize(self, address: str, raw_txs: list[dict]) -> list[Transaction]:
        """
        Converts raw Esplora format into a list of Transaction objects.

        For each tx we determine:
          - whether our address appears in inputs  → sender side
          - whether our address appears in outputs → receiver side
        Then we build (from, to, amount) pairs for each output.
        """
        result: list[Transaction] = []
        seen: set[tuple] = set()  # deduplication

        for tx in raw_txs:
            txid: str = tx.get("txid", "")
            timestamp: int = (tx.get("status") or {}).get("block_time") or 0
            inputs: list[dict] = tx.get("vin", [])
            outputs: list[dict] = tx.get("vout", [])

            input_addresses = {
                inp["prevout"]["scriptpubkey_address"]
                for inp in inputs
                if inp.get("prevout") and inp["prevout"].get("scriptpubkey_address")
            }
            output_map = [
                (
                    out.get("scriptpubkey_address"),
                    (out.get("value") or 0) / 1e8,  # satoshi → BTC
                )
                for out in outputs
                if out.get("scriptpubkey_address")
            ]

            our_address_is_sender = address in input_addresses

            for to_addr, btc_amount in output_map:
                if not to_addr or btc_amount == 0:
                    continue

                if our_address_is_sender:
                    # Our address is the sender — recipients are all outputs except ourselves
                    if to_addr == address:
                        continue  # change back to self — skip
                    from_addr = address
                else:
                    # Our address is the receiver — look for the sender in inputs
                    if to_addr != address:
                        continue
                    # Use the first known input address as the sender
                    from_addr = next(iter(input_addresses), "unknown")

                dedup_key = (txid, from_addr, to_addr)
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)

                result.append(Transaction(
                    tx_hash=txid,
                    from_address=from_addr,
                    to_address=to_addr,
                    amount=round(btc_amount, 8),
                    timestamp=timestamp,
                ))

        return result
