from datetime import datetime, timezone

import httpx
import pytest

from app.config import FeedCollectorSettings
from app.sources.scamsniffer import ScamSnifferSource, ScamSnifferSourceError


_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
_ADDRESS_LOWER = _ADDRESS.lower()


def _settings(**overrides) -> FeedCollectorSettings:
    values = {
        "dry_run": True,
        "scamsniffer_address_blacklist_url": "https://example.test/address.json",
        "scamsniffer_timeout_seconds": 10.0,
        "scamsniffer_evm_networks": "ETH,BNB",
    }
    values.update(overrides)
    return FeedCollectorSettings(**values)


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _source_for_json(payload, status_code: int = 200) -> ScamSnifferSource:
    return ScamSnifferSource(
        _settings(),
        transport=_transport(lambda request: httpx.Response(status_code, json=payload)),
    )


@pytest.mark.asyncio
async def test_check_availability_true_for_valid_list_json():
    source = _source_for_json([_ADDRESS])

    assert await source.check_availability() is True


@pytest.mark.asyncio
async def test_check_availability_false_for_invalid_json():
    source = ScamSnifferSource(
        _settings(),
        transport=_transport(lambda request: httpx.Response(200, content=b"nope")),
    )

    assert await source.check_availability() is False


@pytest.mark.asyncio
async def test_check_availability_false_for_unsupported_shape():
    source = _source_for_json("not-a-supported-shape")

    assert await source.check_availability() is False


@pytest.mark.asyncio
async def test_check_availability_false_for_non_2xx():
    source = _source_for_json([_ADDRESS], status_code=404)

    assert await source.check_availability() is False


@pytest.mark.asyncio
async def test_fetch_initial_supports_list_of_strings():
    source = _source_for_json([_ADDRESS])

    records = await source.fetch_initial(limit=10)

    assert len(records) == 2
    assert {record.address for record in records} == {_ADDRESS}


@pytest.mark.asyncio
async def test_fetch_initial_supports_addresses_array():
    source = _source_for_json({"addresses": [_ADDRESS]})

    records = await source.fetch_initial(limit=10)

    assert len(records) == 2
    assert {record.address for record in records} == {_ADDRESS}


@pytest.mark.asyncio
async def test_fetch_initial_supports_dict_keys_as_addresses():
    source = _source_for_json({_ADDRESS: {"note": "ignored"}})

    records = await source.fetch_initial(limit=10)

    assert len(records) == 2
    assert {record.address for record in records} == {_ADDRESS}


@pytest.mark.asyncio
async def test_invalid_and_non_evm_strings_are_ignored():
    source = _source_for_json(
        [
            "example.test",
            "0xnothex",
            "0x742d35cc6634c0532925a3b844bc454e4438f44",
            _ADDRESS,
        ]
    )

    records = await source.fetch_initial(limit=10)

    assert len(records) == 2
    assert {record.address for record in records} == {_ADDRESS}


@pytest.mark.asyncio
async def test_one_valid_evm_address_fans_out_to_eth_and_bnb():
    source = _source_for_json([_ADDRESS])

    records = await source.fetch_initial(limit=10)

    assert [record.source_chain for record in records] == [
        "EVM_UNSPECIFIED_EXPANDED_ETH",
        "EVM_UNSPECIFIED_EXPANDED_BNB",
    ]
    assert [record.source_category for record in records] == ["PHISHING", "PHISHING"]


@pytest.mark.asyncio
async def test_external_id_includes_lowercase_address_and_network():
    source = _source_for_json([_ADDRESS])

    records = await source.fetch_initial(limit=10)

    assert [record.external_id for record in records] == [
        f"scamsniffer:address:{_ADDRESS_LOWER}:ETH",
        f"scamsniffer:address:{_ADDRESS_LOWER}:BNB",
    ]


@pytest.mark.asyncio
async def test_raw_payload_includes_chain_scope_and_expanded_network():
    source = _source_for_json([_ADDRESS])

    records = await source.fetch_initial(limit=10)

    assert records[0].raw_payload == {
        "source_file": "blacklist/address.json",
        "original_address": _ADDRESS,
        "chain_scope": "EVM_UNSPECIFIED_EXPANDED",
        "expanded_to_network": "ETH",
        "source_url": "https://example.test/address.json",
    }
    assert records[1].raw_payload["chain_scope"] == "EVM_UNSPECIFIED_EXPANDED"
    assert records[1].raw_payload["expanded_to_network"] == "BNB"


@pytest.mark.asyncio
async def test_limit_is_respected_across_fanout_records():
    source = _source_for_json([_ADDRESS])

    records = await source.fetch_initial(limit=1)

    assert len(records) == 1
    assert records[0].source_chain == "EVM_UNSPECIFIED_EXPANDED_ETH"


@pytest.mark.asyncio
async def test_unknown_configured_evm_networks_are_ignored():
    source = ScamSnifferSource(
        _settings(scamsniffer_evm_networks="ETH,POLYGON,BNB,BASE"),
        transport=_transport(lambda request: httpx.Response(200, json=[_ADDRESS])),
    )

    records = await source.fetch_initial(limit=10)

    assert [record.source_chain for record in records] == [
        "EVM_UNSPECIFIED_EXPANDED_ETH",
        "EVM_UNSPECIFIED_EXPANDED_BNB",
    ]


@pytest.mark.asyncio
async def test_fetch_since_returns_empty_list():
    source = _source_for_json([_ADDRESS])
    since = datetime(2026, 1, 1, tzinfo=timezone.utc)

    assert await source.fetch_since(since=since, limit=10) == []


@pytest.mark.asyncio
async def test_unsupported_top_level_shape_raises_sanitized_error():
    source = _source_for_json("not-a-supported-shape")

    with pytest.raises(ScamSnifferSourceError) as exc_info:
        await source.fetch_initial(limit=10)

    msg = str(exc_info.value)
    assert "top-level JSON" in msg
    assert _ADDRESS not in msg


@pytest.mark.asyncio
async def test_non_2xx_raises_sanitized_error():
    source = _source_for_json([_ADDRESS], status_code=500)

    with pytest.raises(ScamSnifferSourceError) as exc_info:
        await source.fetch_initial(limit=10)

    assert "500" in str(exc_info.value)
