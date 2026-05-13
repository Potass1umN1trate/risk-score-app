import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from ..config import FeedCollectorSettings
from ..error_sanitizer import sanitize_error
from ..models import RawFeedRecord
from ..source_base import FeedSource

logger = logging.getLogger(__name__)


class ChainabuseSourceError(RuntimeError):
    """Raised when Chainabuse cannot return a usable reports response."""


class ChainabuseSource(FeedSource):
    def __init__(
        self,
        settings: FeedCollectorSettings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport
        self._base_url = settings.chainabuse_base_url.rstrip("/")

    @property
    def source_code(self) -> str:
        return "chainabuse"

    @property
    def supports_time_filter(self) -> bool:
        return True

    async def check_availability(self) -> bool:
        if not self._settings.chainabuse_api_key:
            logger.debug("chainabuse: availability check → False (no API key)")
            return False

        try:
            payload = await self._request_reports(page=1, per_page=1)
        except ChainabuseSourceError as exc:
            logger.debug("chainabuse: availability check → False (%s)", sanitize_error(exc))
            return False

        result = isinstance(payload, dict) and isinstance(payload.get("reports"), list)
        logger.debug("chainabuse: availability check → %s", result)
        return result

    async def fetch_initial(self, limit: int) -> list[RawFeedRecord]:
        logger.info("chainabuse: fetch_initial start limit=%d", limit)
        records = await self._fetch_paginated(limit=limit, since=None)
        logger.info("chainabuse: fetch_initial complete records=%d", len(records))
        return records

    async def fetch_since(self, since: datetime, limit: int) -> list[RawFeedRecord]:
        since_iso = _format_utc_iso(since)
        logger.info("chainabuse: fetch_since start since=%s limit=%d", since_iso, limit)
        records = await self._fetch_paginated(limit=limit, since=since_iso)
        logger.info("chainabuse: fetch_since complete records=%d", len(records))
        return records

    async def _fetch_paginated(
        self,
        limit: int,
        since: str | None,
    ) -> list[RawFeedRecord]:
        if limit <= 0:
            return []
        if not self._settings.chainabuse_api_key:
            raise ChainabuseSourceError("Chainabuse API key is not configured.")

        records: list[RawFeedRecord] = []
        page = 1
        max_pages = self._settings.chainabuse_initial_max_pages

        while page <= max_pages and len(records) < limit:
            remaining = limit - len(records)
            per_page = min(self._settings.chainabuse_per_page, 50, remaining)
            payload = await self._request_reports(
                page=page,
                per_page=per_page,
                since=since,
            )

            reports = payload.get("reports") if isinstance(payload, dict) else None
            if not isinstance(reports, list):
                logger.warning("chainabuse: response missing reports list on page %d", page)
                raise ChainabuseSourceError(
                    "Chainabuse response was malformed: reports must be a list."
                )

            records.extend(self._records_from_reports(reports, limit - len(records)))

            if len(reports) < per_page:
                break
            page += 1

        return records[:limit]

    async def _request_reports(
        self,
        page: int,
        per_page: int,
        since: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "page": page,
            "perPage": min(per_page, 50),
        }
        if self._settings.chainabuse_before is not None:
            params["before"] = self._settings.chainabuse_before
        if self._settings.chainabuse_checked is not None:
            params["checked"] = self._settings.chainabuse_checked
        if self._settings.chainabuse_trusted is not None:
            params["trusted"] = self._settings.chainabuse_trusted
        if self._settings.chainabuse_category is not None:
            params["category"] = self._settings.chainabuse_category
        if self._settings.chainabuse_chain is not None:
            params["chain"] = self._settings.chainabuse_chain
        if since is not None:
            params["since"] = since

        auth = httpx.BasicAuth(self._settings.chainabuse_api_key or "", "")

        try:
            async with httpx.AsyncClient(
                timeout=self._settings.chainabuse_timeout_seconds,
                transport=self._transport,
            ) as client:
                response = await client.get(
                    f"{self._base_url}/reports",
                    params=params,
                    auth=auth,
                )
        except httpx.TimeoutException as exc:
            logger.warning("chainabuse: request timed out: %s", sanitize_error(exc))
            raise ChainabuseSourceError("Chainabuse request timed out.") from exc
        except httpx.RequestError as exc:
            logger.warning("chainabuse: request error: %s", sanitize_error(exc))
            raise ChainabuseSourceError("Chainabuse request failed.") from exc

        if response.status_code < 200 or response.status_code >= 300:
            logger.warning("chainabuse: HTTP %d from reports endpoint", response.status_code)
            raise ChainabuseSourceError(
                f"Chainabuse request failed with status {response.status_code}."
            )

        try:
            payload = response.json()
        except ValueError as exc:
            logger.warning("chainabuse: response was not valid JSON: %s", sanitize_error(exc))
            raise ChainabuseSourceError(
                "Chainabuse response was not valid JSON."
            ) from exc

        if not isinstance(payload, dict):
            logger.warning("chainabuse: unexpected top-level response shape: %s", type(payload).__name__)
            raise ChainabuseSourceError(
                "Chainabuse response was malformed: top-level JSON must be an object."
            )

        return payload

    def _records_from_reports(
        self,
        reports: list[Any],
        remaining_limit: int,
    ) -> list[RawFeedRecord]:
        records: list[RawFeedRecord] = []

        for report in reports:
            if len(records) >= remaining_limit:
                break
            if not isinstance(report, dict):
                continue

            report_id = _clean_optional_str(report.get("id"))
            source_category = _clean_optional_str(report.get("scamCategory"))
            created_at_raw = _clean_optional_str(report.get("createdAt"))
            created_at = _parse_datetime(created_at_raw)
            trusted = report.get("trusted")
            checked = report.get("checked")
            addresses = report.get("addresses")
            if not isinstance(addresses, list):
                continue

            for entry in addresses:
                if len(records) >= remaining_limit:
                    break
                if not isinstance(entry, dict):
                    continue

                address = _clean_optional_str(entry.get("address"))
                if address is None:
                    continue

                records.append(
                    RawFeedRecord(
                        address=address,
                        source_chain=_clean_optional_str(entry.get("chain")),
                        source_category=source_category,
                        external_id=report_id,
                        confidence=None,
                        trusted=trusted if isinstance(trusted, bool) else None,
                        checked=checked if isinstance(checked, bool) else None,
                        first_seen=created_at,
                        last_seen=created_at,
                        raw_payload={
                            "report": {
                                "id": report_id,
                                "scamCategory": source_category,
                                "createdAt": created_at_raw,
                                "trusted": trusted if isinstance(trusted, bool) else None,
                                "checked": checked if isinstance(checked, bool) else None,
                            },
                            "address": {
                                "chain": entry.get("chain"),
                                "address": address,
                                "domain": entry.get("domain"),
                            },
                        },
                    )
                )

        return records


def _clean_optional_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    return cleaned


def _parse_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _format_utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
