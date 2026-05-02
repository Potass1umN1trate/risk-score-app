import re
from datetime import datetime
from typing import Any

import httpx

from ..config import FeedCollectorSettings
from ..models import RawFeedRecord
from ..source_base import FeedSource


class ScamSnifferSourceError(RuntimeError):
    """Raised when ScamSniffer cannot return a usable address blacklist."""


_EVM_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_SUPPORTED_EVM_NETWORKS: frozenset[str] = frozenset({"ETH", "BNB"})


class ScamSnifferSource(FeedSource):
    def __init__(
        self,
        settings: FeedCollectorSettings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport

    @property
    def source_code(self) -> str:
        return "scamsniffer"

    @property
    def supports_time_filter(self) -> bool:
        return False

    async def check_availability(self) -> bool:
        try:
            payload = await self._request_json()
            _candidate_addresses(payload)
        except ScamSnifferSourceError:
            return False
        return True

    async def fetch_initial(self, limit: int) -> list[RawFeedRecord]:
        if limit <= 0:
            return []

        payload = await self._request_json()
        candidates = _candidate_addresses(payload)
        networks = _configured_evm_networks(self._settings.scamsniffer_evm_networks)
        records: list[RawFeedRecord] = []

        for candidate in candidates:
            address = _clean_evm_address(candidate)
            if address is None:
                continue

            for network in networks:
                if len(records) >= limit:
                    return records
                records.append(
                    RawFeedRecord(
                        address=address,
                        source_chain=f"EVM_UNSPECIFIED_EXPANDED_{network}",
                        source_category="PHISHING",
                        external_id=f"scamsniffer:address:{address.lower()}:{network}",
                        confidence=None,
                        trusted=None,
                        checked=None,
                        first_seen=None,
                        last_seen=None,
                        raw_payload={
                            "source_file": "blacklist/address.json",
                            "original_address": address,
                            "chain_scope": "EVM_UNSPECIFIED_EXPANDED",
                            "expanded_to_network": network,
                            "source_url": self._settings.scamsniffer_address_blacklist_url,
                        },
                    )
                )

        return records

    async def fetch_since(self, since: datetime, limit: int) -> list[RawFeedRecord]:
        return []

    async def _request_json(self) -> Any:
        try:
            async with httpx.AsyncClient(
                timeout=self._settings.scamsniffer_timeout_seconds,
                transport=self._transport,
            ) as client:
                response = await client.get(
                    self._settings.scamsniffer_address_blacklist_url
                )
        except httpx.TimeoutException as exc:
            raise ScamSnifferSourceError("ScamSniffer request timed out.") from exc
        except httpx.RequestError as exc:
            raise ScamSnifferSourceError("ScamSniffer request failed.") from exc

        if response.status_code < 200 or response.status_code >= 300:
            raise ScamSnifferSourceError(
                f"ScamSniffer request failed with status {response.status_code}."
            )

        try:
            return response.json()
        except ValueError as exc:
            raise ScamSnifferSourceError(
                "ScamSniffer response was not valid JSON."
            ) from exc


def _candidate_addresses(payload: Any) -> list[str]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, str)]

    if isinstance(payload, dict):
        if "addresses" in payload:
            addresses = payload["addresses"]
            if not isinstance(addresses, list):
                raise ScamSnifferSourceError(
                    "ScamSniffer response was malformed: addresses must be a list."
                )
            return [item for item in addresses if isinstance(item, str)]

        return [key for key in payload.keys() if isinstance(key, str)]

    raise ScamSnifferSourceError(
        "ScamSniffer response was malformed: top-level JSON must be a list or object."
    )


def _clean_evm_address(value: str) -> str | None:
    cleaned = value.strip()
    if not _EVM_ADDRESS_RE.fullmatch(cleaned):
        return None
    return cleaned


def _configured_evm_networks(value: str) -> list[str]:
    networks: list[str] = []
    for item in value.split(","):
        network = item.strip().upper()
        if network in _SUPPORTED_EVM_NETWORKS and network not in networks:
            networks.append(network)
    return networks
