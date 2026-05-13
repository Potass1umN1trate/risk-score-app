"""
Source-aware feed normalizer.

Supported network codes match the 10 project networks. Source-native chain and
category values are mapped before canonical address formatting is applied.
Full regex validation is deferred to a later iteration.
"""

from .mappings import map_source_category, map_source_chain
from .models import NormalizedFlaggedAddress, RawFeedRecord

_SUPPORTED_NETWORKS: frozenset[str] = frozenset(
    {"BTC", "ETH", "TRX", "SOL", "BNB", "XRP", "LTC", "DOGE", "ADA", "TON"}
)

_EVM_NETWORKS: frozenset[str] = frozenset({"ETH", "BNB"})


def is_supported_network(network_code: str) -> bool:
    return network_code.upper() in _SUPPORTED_NETWORKS


def normalize_address(network_code: str, address: str) -> str:
    """
    Return the canonical address form for the given network.

    ETH/BNB: strip whitespace and lowercase.
    All other supported networks: strip whitespace only.
    Callers must check is_supported_network() before calling this function.
    """
    stripped = address.strip()
    if network_code.upper() in _EVM_NETWORKS:
        return stripped.lower()
    return stripped


def normalize_feed_record(
    source_code: str, record: RawFeedRecord
) -> tuple[NormalizedFlaggedAddress | None, str | None]:
    if record.address is None or not record.address.strip():
        return None, "Skipped record: missing address."

    network_code = map_source_chain(source_code, record.source_chain)
    if network_code is None:
        return (
            None,
            "Skipped record with address "
            f"'{record.address}': unsupported source chain '{record.source_chain}'.",
        )

    network_code = network_code.upper()
    if not is_supported_network(network_code):
        return (
            None,
            "Skipped record with address "
            f"'{record.address}': mapped network '{network_code}' is not supported.",
        )

    risk_category_code = map_source_category(source_code, record.source_category)
    if risk_category_code is None:
        return (
            None,
            "Skipped record with address "
            f"'{record.address}': unsupported source category "
            f"'{record.source_category}'.",
        )

    return (
        NormalizedFlaggedAddress(
            address=normalize_address(network_code, record.address),
            network_code=network_code,
            risk_category_code=risk_category_code,
            external_id=record.external_id,
            source_chain=record.source_chain,
            source_category=record.source_category,
            confidence=record.confidence,
            trusted=record.trusted,
            checked=record.checked,
            first_seen=record.first_seen,
            last_seen=record.last_seen,
            raw_payload=record.raw_payload,
        ),
        None,
    )
