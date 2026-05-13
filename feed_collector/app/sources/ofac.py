import logging
import re
import defusedxml.ElementTree as ET
from datetime import datetime
from typing import Any

import httpx

from ..config import FeedCollectorSettings
from ..error_sanitizer import sanitize_error
from ..models import RawFeedRecord
from ..source_base import FeedSource

logger = logging.getLogger(__name__)


class OfacSourceError(RuntimeError):
    """Raised when OFAC SLS cannot return usable sanctions XML."""


_DIGITAL_CURRENCY_RE = re.compile(
    r"digital\s+currency\s+address\s*-\s*(?P<asset>[A-Za-z0-9]+)",
    re.IGNORECASE,
)
_EVM_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_TRON_ADDRESS_RE = re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$")
_TOKEN_ASSETS: frozenset[str] = frozenset({"USDT", "USDC"})
_NOTE = "OFAC digital currency listings are not exhaustive."


class OfacSource(FeedSource):
    def __init__(
        self,
        settings: FeedCollectorSettings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport
        self._base_url = settings.ofac_base_url.rstrip("/")

    @property
    def source_code(self) -> str:
        return "ofac"

    @property
    def supports_time_filter(self) -> bool:
        return False

    async def check_availability(self) -> bool:
        try:
            async with httpx.AsyncClient(
                timeout=self._settings.ofac_timeout_seconds,
                transport=self._transport,
            ) as client:
                if self._settings.ofac_use_alive_check:
                    response = await client.get(f"{self._base_url}/alive")
                    result = response.status_code == 200
                else:
                    response = await client.head(self._download_url)
                    result = response.status_code >= 200 and response.status_code < 300
        except httpx.RequestError as exc:
            logger.debug("ofac: availability check → False (%s)", sanitize_error(exc))
            return False
        logger.debug("ofac: availability check → %s", result)
        return result

    async def fetch_initial(self, limit: int) -> list[RawFeedRecord]:
        logger.info("ofac: fetch_initial start limit=%d", limit)
        if limit <= 0:
            logger.info("ofac: fetch_initial complete records=0")
            return []

        xml_bytes = await self._download_xml()
        records = _records_from_xml(xml_bytes, self._download_url, limit)
        logger.info("ofac: fetch_initial complete records=%d", len(records))
        return records

    async def fetch_since(self, since: datetime, limit: int) -> list[RawFeedRecord]:
        logger.info("ofac: fetch_since start since=%s limit=%d", since.isoformat(), limit)
        logger.info("ofac: fetch_since complete records=0")
        return []

    @property
    def _download_url(self) -> str:
        filename = self._settings.ofac_sdn_filename.lstrip("/")
        return f"{self._base_url}/api/download/{filename}"

    async def _download_xml(self) -> bytes:
        try:
            async with httpx.AsyncClient(
                timeout=self._settings.ofac_timeout_seconds,
                transport=self._transport,
                follow_redirects=True,
            ) as client:
                response = await client.get(self._download_url)
        except httpx.TimeoutException as exc:
            logger.warning("ofac: download timed out: %s", sanitize_error(exc))
            raise OfacSourceError("OFAC SLS request timed out.") from exc
        except httpx.RequestError as exc:
            logger.warning("ofac: download request error: %s", sanitize_error(exc))
            raise OfacSourceError("OFAC SLS request failed.") from exc

        if response.status_code < 200 or response.status_code >= 300:
            logger.warning("ofac: HTTP %d from SLS download endpoint", response.status_code)
            raise OfacSourceError(
                f"OFAC SLS download failed with status {response.status_code}."
            )

        return response.content


def _build_feature_type_map(root: ET.Element) -> dict[str, str]:
    """Build FeatureTypeID → type text map from ReferenceValueSets."""
    result: dict[str, str] = {}
    for el in root.iter():
        if _local_name(el.tag) == "FeatureType":
            ftype_id = el.attrib.get("ID")
            text = "".join(t for t in el.itertext()).strip()
            if ftype_id and text:
                result[ftype_id] = text
    return result


def _records_from_xml(
    xml_bytes: bytes,
    source_url: str,
    limit: int,
) -> list[RawFeedRecord]:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        logger.warning("ofac: XML parse error: %s", sanitize_error(exc))
        raise OfacSourceError("OFAC SLS XML was malformed.") from exc

    feature_type_map = _build_feature_type_map(root)

    records: list[RawFeedRecord] = []
    for entity in _candidate_entity_elements(root):
        context = _entity_context(entity)
        seen_pairs: set[tuple[str, str]] = set()
        for id_type, address in _digital_currency_pairs(entity, feature_type_map):
            pair_key = (id_type.strip().upper(), address.strip())
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)

            if len(records) >= limit:
                return records

            record = _record_from_pair(
                id_type=id_type,
                address=address,
                context=context,
                source_url=source_url,
            )
            if record is not None:
                records.append(record)

    return records


def _candidate_entity_elements(root: ET.Element) -> list[ET.Element]:
    entity_names = {"distinctparty", "entity", "sdnentry", "profile"}
    preferred = [
        element
        for element in root.iter()
        if _normalize_name(_local_name(element.tag)) in entity_names
    ]
    if preferred:
        return preferred
    return [root]


def _entity_context(entity: ET.Element) -> dict[str, Any]:
    program_tags = _program_tags(entity)
    return {
        "entity_id": _first_text_for_names(
            entity,
            {
                "entityId",
                "entity-id",
                "uid",
                "fixedRef",
                "fixedRefNo",
                "profileId",
                "id",
            },
        )
        or _attr_for_names(entity, {"id", "uid", "fixedRef", "profileId"}),
        "entity_name": _entity_name(entity),
        "sanctions_list": _sanctions_list(entity),
        "program_tags": program_tags,
        "program_categories": _program_categories(program_tags),
    }


def _digital_currency_pairs(
    entity: ET.Element,
    feature_type_map: dict[str, str] | None = None,
) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for element in entity.iter():
        # For Feature elements in Advanced XML: resolve type via FeatureTypeID attribute
        if _normalize_name(_local_name(element.tag)) == "feature" and feature_type_map:
            ftype_id = element.attrib.get("FeatureTypeID")
            if ftype_id:
                type_text = feature_type_map.get(ftype_id)
                if type_text and _asset_from_type(type_text) is not None:
                    value = _value_text(element)
                    if value is not None:
                        pairs.append((type_text, value))
                    continue

        if not _could_hold_digital_identifier(element):
            continue

        type_text = _type_text(element)
        if type_text is None or _asset_from_type(type_text) is None:
            continue

        value = _value_text(element)
        if value is not None:
            pairs.append((type_text, value))

    return pairs


def _could_hold_digital_identifier(element: ET.Element) -> bool:
    container_names = {
        "feature",
        "featureversion",
        "featureversiondetail",
        "identifier",
        "id",
        "idregistration",
        "idregistrationdocument",
        "document",
        "versiondetail",
    }
    if _normalize_name(_local_name(element.tag)) in container_names:
        return True

    type_child_names = {
        "type",
        "idType",
        "idTypeText",
        "featureType",
        "featureTypeText",
        "featureTypeValue",
        "featureTypeValueText",
        "typeText",
    }
    normalized_type_names = {_normalize_name(name) for name in type_child_names}
    return any(
        _normalize_name(_local_name(child.tag)) in normalized_type_names
        for child in list(element)
    )


def _record_from_pair(
    id_type: str,
    address: str,
    context: dict[str, Any],
    source_url: str,
) -> RawFeedRecord | None:
    asset = _asset_from_type(id_type)
    if asset is None:
        return None

    source_chain, token_inferred = _source_chain_for_asset(asset, address)
    if source_chain is None:
        return None

    program_tags = context["program_tags"]
    source_category = ",".join(program_tags) if program_tags else "SANCTIONS"
    entity_id = context["entity_id"] or "unknown"
    external_id = f"ofac:{entity_id}:{source_chain}:{_external_address(address)}"

    return RawFeedRecord(
        address=address,
        source_chain=source_chain,
        source_category=source_category,
        external_id=external_id,
        confidence=None,
        trusted=True,
        checked=True,
        first_seen=None,
        last_seen=None,
        raw_payload={
            "source": "OFAC SLS",
            "entity_id": context["entity_id"],
            "entity_name": context["entity_name"],
            "sanctions_list": context["sanctions_list"],
            "program_tags": program_tags,
            "program_categories": context["program_categories"],
            "id_type": id_type,
            "asset": asset,
            "source_url": source_url,
            "note": _NOTE,
            "token_network_inferred": token_inferred,
        },
    )


def _source_chain_for_asset(asset: str, address: str) -> tuple[str | None, bool]:
    normalized_asset = asset.strip().upper()
    cleaned_address = address.strip()

    if normalized_asset in _TOKEN_ASSETS:
        if _TRON_ADDRESS_RE.fullmatch(cleaned_address):
            return f"OFAC_TOKEN_{normalized_asset}_TRX_INFERRED", True
        if _EVM_ADDRESS_RE.fullmatch(cleaned_address):
            return f"OFAC_TOKEN_{normalized_asset}_ETH_INFERRED", True
        return None, False

    return normalized_asset, False


def _program_categories(program_tags: list[str]) -> list[str]:
    categories: list[str] = []
    for tag in program_tags:
        category = _program_category(tag)
        if category not in categories:
            categories.append(category)
    return categories


def _program_category(tag: str) -> str:
    cleaned = " ".join(tag.strip().upper().split())
    if cleaned.startswith("CYBER") or cleaned == "ELECTION-EO13848":
        return "cyber"
    if cleaned in {"SDNT", "SDNTK", "ILLICIT-DRUGS-EO14059"}:
        return "narcotics"
    if cleaned in {"FTO", "SDGT"}:
        return "terrorism"
    if cleaned.startswith("DPRK"):
        return "north_korea"
    if cleaned.startswith("IRAN"):
        return "iran"
    if (
        cleaned.startswith("RUSSIA")
        or cleaned.startswith("UKRAINE-EO")
        or cleaned in {"CAATSA - RUSSIA", "BPI-RUSSIA-EO14024"}
    ):
        return "russia"
    if cleaned == "NPWMD" or "WMD" in cleaned:
        return "wmd_proliferation"
    if cleaned.startswith("BELARUS"):
        return "belarus"
    if cleaned.startswith("VENEZUELA"):
        return "venezuela"
    return "other"


def _type_text(element: ET.Element) -> str | None:
    type_names = {
        "type",
        "idType",
        "idTypeText",
        "featureType",
        "featureTypeText",
        "featureTypeValue",
        "featureTypeValueText",
        "typeText",
    }
    own_text = _own_text(element)
    if own_text is not None and _asset_from_type(own_text) is not None:
        return own_text
    return _first_text_for_names(element, type_names)


def _value_text(element: ET.Element) -> str | None:
    value_names = {
        "value",
        "idNumber",
        "idRegistrationNo",
        "idRegistrationNumber",
        "number",
        "featureValue",
        "featureValueText",
        "versionDetail",
        "versionDetailValue",
        "detail",
        "address",
    }
    direct = _direct_child_text_for_names(element, value_names)
    if direct is not None and _asset_from_type(direct) is None:
        return direct

    all_texts = [
        text
        for child in element.iter()
        if (text := _text(child)) is not None and _asset_from_type(text) is None
    ]
    if all_texts:
        return all_texts[-1]
    return None


def _asset_from_type(value: str) -> str | None:
    match = _DIGITAL_CURRENCY_RE.search(value)
    if match is None:
        return None
    return match.group("asset").upper()


def _program_tags(entity: ET.Element) -> list[str]:
    tags: list[str] = []
    for element in entity.iter():
        name = _local_name(element.tag).lower()
        text = _text(element)
        if text is None:
            continue
        if name in {
            "program",
            "programtag",
            "programtags",
            "sanctionsprogram",
            "sanctionsprogramvalue",
        }:
            _append_program_tag(tags, text)
            continue
        if name in {"comment", "comments"} and _looks_like_program_tag(text):
            _append_program_tag(tags, text)
    return tags


def _append_program_tag(tags: list[str], value: str) -> None:
    for part in value.split(","):
        cleaned = part.strip()
        if cleaned and cleaned not in tags:
            tags.append(cleaned)


def _looks_like_program_tag(value: str) -> bool:
    cleaned = value.strip().upper()
    if len(cleaned) > 64:
        return False
    return bool(re.fullmatch(r"[A-Z0-9][A-Z0-9 -]*", cleaned))


def _entity_name(entity: ET.Element) -> str | None:
    for names in (
        {"primaryName", "name", "entityName", "sdnName"},
        {"lastName"},
    ):
        value = _first_text_for_names(entity, names)
        if value is not None and _asset_from_type(value) is None:
            return value

    parts: list[str] = []
    for element in entity.iter():
        if _local_name(element.tag) in {"namePartValue", "namePart"}:
            value = _text(element)
            if value is not None and _asset_from_type(value) is None:
                parts.append(value)
    return " ".join(parts) if parts else None


def _sanctions_list(entity: ET.Element) -> str | None:
    return _first_text_for_names(
        entity,
        {"sanctionsList", "sanctionsListName", "list", "listName", "listId"},
    )


def _first_text_for_names(element: ET.Element, names: set[str]) -> str | None:
    normalized_names = {_normalize_name(name) for name in names}
    for child in element.iter():
        if _normalize_name(_local_name(child.tag)) in normalized_names:
            text = _text(child)
            if text is not None:
                return text
    return None


def _direct_child_text_for_names(element: ET.Element, names: set[str]) -> str | None:
    normalized_names = {_normalize_name(name) for name in names}
    for child in list(element):
        if _normalize_name(_local_name(child.tag)) in normalized_names:
            text = _text(child)
            if text is not None:
                return text
    return None


def _attr_for_names(element: ET.Element, names: set[str]) -> str | None:
    normalized_names = {_normalize_name(name) for name in names}
    for key, value in element.attrib.items():
        if _normalize_name(_local_name(key)) in normalized_names:
            cleaned = value.strip()
            if cleaned:
                return cleaned
    return None


def _text(element: ET.Element) -> str | None:
    text = "".join(element.itertext()).strip()
    return text or None


def _own_text(element: ET.Element) -> str | None:
    if element.text is None:
        return None
    text = element.text.strip()
    return text or None


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[1]
    return tag


def _normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _external_address(address: str) -> str:
    cleaned = address.strip()
    if _EVM_ADDRESS_RE.fullmatch(cleaned):
        return cleaned.lower()
    return cleaned
