from datetime import datetime, timezone

import httpx
import pytest

from app.config import FeedCollectorSettings
from app.sources.ofac import OfacSource, OfacSourceError


_ETH_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
_TRX_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
_BTC_ADDRESS = "12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y"


def _settings(**overrides) -> FeedCollectorSettings:
    values = {
        "dry_run": True,
        "ofac_base_url": "https://sanctionslistservice.ofac.treas.gov",
        "ofac_sdn_filename": "SDN_ADVANCED.XML",
        "ofac_timeout_seconds": 20.0,
        "ofac_use_alive_check": True,
    }
    values.update(overrides)
    return FeedCollectorSettings(**values)


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _source_for_xml(xml: str, status_code: int = 200) -> OfacSource:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, content=xml.encode("utf-8"))

    return OfacSource(_settings(), transport=_transport(handler))


def _simple_xml(asset: str = "ETH", address: str = _ETH_ADDRESS) -> str:
    return f"""
    <sdnAdvanced xmlns="urn:test">
      <distinctParty fixedRef="12345">
        <primaryName>Example Entity LLC</primaryName>
        <sanctionsList>SDN List</sanctionsList>
        <sanctionsProgramValue>CYBER2</sanctionsProgramValue>
        <sanctionsProgramValue>DPRK3</sanctionsProgramValue>
        <feature>
          <featureType>Digital Currency Address - {asset}</featureType>
          <featureValue>{address}</featureValue>
        </feature>
      </distinctParty>
    </sdnAdvanced>
    """


@pytest.mark.asyncio
async def test_check_availability_true_on_alive_200():
    seen_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        return httpx.Response(200)

    source = OfacSource(_settings(), transport=_transport(handler))

    assert await source.check_availability() is True
    assert seen_paths == ["/alive"]


@pytest.mark.asyncio
async def test_check_availability_false_on_alive_non_200():
    source = OfacSource(
        _settings(),
        transport=_transport(lambda request: httpx.Response(503)),
    )

    assert await source.check_availability() is False


@pytest.mark.asyncio
async def test_check_availability_false_on_request_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("network unavailable", request=request)

    source = OfacSource(_settings(), transport=_transport(handler))

    assert await source.check_availability() is False


@pytest.mark.asyncio
async def test_check_availability_can_use_head_without_alive_check():
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        return httpx.Response(200)

    source = OfacSource(
        _settings(ofac_use_alive_check=False),
        transport=_transport(handler),
    )

    assert await source.check_availability() is True
    assert seen == [("HEAD", "/api/download/SDN_ADVANCED.XML")]


@pytest.mark.asyncio
async def test_fetch_initial_downloads_configured_sdn_advanced_xml():
    seen_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        return httpx.Response(200, content=_simple_xml().encode("utf-8"))

    source = OfacSource(_settings(), transport=_transport(handler))

    await source.fetch_initial(limit=10)

    assert seen_paths == ["/api/download/SDN_ADVANCED.XML"]


@pytest.mark.asyncio
async def test_fetch_initial_parses_eth_address_and_evidence_payload():
    source = _source_for_xml(_simple_xml())

    records = await source.fetch_initial(limit=10)

    assert len(records) == 1
    record = records[0]
    assert record.address == _ETH_ADDRESS
    assert record.source_chain == "ETH"
    assert record.source_category == "CYBER2,DPRK3"
    assert record.external_id == f"ofac:12345:ETH:{_ETH_ADDRESS.lower()}"
    assert record.confidence is None
    assert record.trusted is True
    assert record.checked is True
    assert record.first_seen is None
    assert record.last_seen is None
    assert record.raw_payload == {
        "source": "OFAC SLS",
        "entity_id": "12345",
        "entity_name": "Example Entity LLC",
        "sanctions_list": "SDN List",
        "program_tags": ["CYBER2", "DPRK3"],
        "program_categories": ["cyber", "north_korea"],
        "id_type": "Digital Currency Address - ETH",
        "asset": "ETH",
        "source_url": "https://sanctionslistservice.ofac.treas.gov/api/download/SDN_ADVANCED.XML",
        "note": "OFAC digital currency listings are not exhaustive.",
        "token_network_inferred": False,
    }


@pytest.mark.asyncio
async def test_fetch_initial_supports_identifier_fixture_shape():
    xml = f"""
    <root>
      <entity id="entity-9">
        <name>Fixture Entity</name>
        <listName>SDN List</listName>
        <program>FTO</program>
        <identifier>
          <idType>Digital Currency Address - XBT</idType>
          <idRegistrationNo>{_BTC_ADDRESS}</idRegistrationNo>
        </identifier>
      </entity>
    </root>
    """
    source = _source_for_xml(xml)

    records = await source.fetch_initial(limit=10)

    assert len(records) == 1
    assert records[0].source_chain == "XBT"
    assert records[0].source_category == "FTO"
    assert records[0].raw_payload["program_categories"] == ["terrorism"]


@pytest.mark.asyncio
async def test_missing_program_tags_uses_sanctions_source_category():
    xml = f"""
    <root>
      <entity id="entity-1">
        <name>Untyped Program Entity</name>
        <feature>
          <type>Digital Currency Address - LTC</type>
          <value>LaMT6cvTxD3jVkGoD5KQzEP3djYGWw8qHG</value>
        </feature>
      </entity>
    </root>
    """
    source = _source_for_xml(xml)

    records = await source.fetch_initial(limit=10)

    assert len(records) == 1
    assert records[0].source_category == "SANCTIONS"
    assert records[0].raw_payload["program_tags"] == []
    assert records[0].raw_payload["program_categories"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("asset", "address", "expected_chain"),
    [
        ("USDT", _TRX_ADDRESS, "OFAC_TOKEN_USDT_TRX_INFERRED"),
        ("USDC", _TRX_ADDRESS, "OFAC_TOKEN_USDC_TRX_INFERRED"),
        ("USDT", _ETH_ADDRESS, "OFAC_TOKEN_USDT_ETH_INFERRED"),
        ("USDC", _ETH_ADDRESS, "OFAC_TOKEN_USDC_ETH_INFERRED"),
    ],
)
async def test_usdt_usdc_token_network_inference(asset, address, expected_chain):
    source = _source_for_xml(_simple_xml(asset=asset, address=address))

    records = await source.fetch_initial(limit=10)

    assert len(records) == 1
    assert records[0].source_chain == expected_chain
    assert records[0].raw_payload["asset"] == asset
    assert records[0].raw_payload["token_network_inferred"] is True


@pytest.mark.asyncio
async def test_usdt_usdc_unsupported_address_format_is_skipped():
    source = _source_for_xml(_simple_xml(asset="USDT", address="not-a-chain-address"))

    records = await source.fetch_initial(limit=10)

    assert records == []


@pytest.mark.asyncio
async def test_fetch_initial_respects_limit():
    xml = f"""
    <root>
      <entity id="entity-1">
        <program>CYBER2</program>
        <feature>
          <featureType>Digital Currency Address - ETH</featureType>
          <featureValue>{_ETH_ADDRESS}</featureValue>
        </feature>
        <feature>
          <featureType>Digital Currency Address - TRX</featureType>
          <featureValue>{_TRX_ADDRESS}</featureValue>
        </feature>
      </entity>
    </root>
    """
    source = _source_for_xml(xml)

    records = await source.fetch_initial(limit=1)

    assert len(records) == 1
    assert records[0].source_chain == "ETH"


@pytest.mark.asyncio
async def test_multiple_crypto_features_do_not_create_mixed_parent_records():
    xml = f"""
    <root>
      <entity id="entity-1">
        <program>CYBER2</program>
        <feature>
          <featureType>Digital Currency Address - ETH</featureType>
          <featureValue>{_ETH_ADDRESS}</featureValue>
        </feature>
        <feature>
          <featureType>Digital Currency Address - TRX</featureType>
          <featureValue>{_TRX_ADDRESS}</featureValue>
        </feature>
      </entity>
    </root>
    """
    source = _source_for_xml(xml)

    records = await source.fetch_initial(limit=10)

    assert [(record.source_chain, record.address) for record in records] == [
        ("ETH", _ETH_ADDRESS),
        ("TRX", _TRX_ADDRESS),
    ]


@pytest.mark.asyncio
async def test_pascal_case_entities_keep_metadata_separate():
    xml = f"""
    <SdnAdvanced>
      <DistinctParty fixedRef="party-1">
        <PrimaryName>First Entity</PrimaryName>
        <SanctionsList>SDN List</SanctionsList>
        <SanctionsProgramValue>CYBER2</SanctionsProgramValue>
        <Feature>
          <FeatureType>Digital Currency Address - ETH</FeatureType>
          <FeatureValue>{_ETH_ADDRESS}</FeatureValue>
        </Feature>
      </DistinctParty>
      <SdnEntry uid="party-2">
        <PrimaryName>Second Entity</PrimaryName>
        <SanctionsList>SDN List</SanctionsList>
        <SanctionsProgramValue>FTO</SanctionsProgramValue>
        <Feature>
          <FeatureType>Digital Currency Address - TRX</FeatureType>
          <FeatureValue>{_TRX_ADDRESS}</FeatureValue>
        </Feature>
      </SdnEntry>
    </SdnAdvanced>
    """
    source = _source_for_xml(xml)

    records = await source.fetch_initial(limit=10)

    assert len(records) == 2
    assert records[0].address == _ETH_ADDRESS
    assert records[0].source_category == "CYBER2"
    assert records[0].raw_payload["entity_id"] == "party-1"
    assert records[0].raw_payload["entity_name"] == "First Entity"
    assert records[0].raw_payload["program_tags"] == ["CYBER2"]
    assert records[0].raw_payload["program_categories"] == ["cyber"]

    assert records[1].address == _TRX_ADDRESS
    assert records[1].source_category == "FTO"
    assert records[1].raw_payload["entity_id"] == "party-2"
    assert records[1].raw_payload["entity_name"] == "Second Entity"
    assert records[1].raw_payload["program_tags"] == ["FTO"]
    assert records[1].raw_payload["program_categories"] == ["terrorism"]


@pytest.mark.asyncio
async def test_malformed_xml_raises_sanitized_error():
    source = _source_for_xml("<root><not-closed>")

    with pytest.raises(OfacSourceError) as exc_info:
        await source.fetch_initial(limit=10)

    msg = str(exc_info.value)
    assert "malformed" in msg
    assert _ETH_ADDRESS not in msg


@pytest.mark.asyncio
async def test_non_2xx_download_raises_sanitized_error():
    source = _source_for_xml(_simple_xml(), status_code=500)

    with pytest.raises(OfacSourceError) as exc_info:
        await source.fetch_initial(limit=10)

    msg = str(exc_info.value)
    assert "500" in msg
    assert _ETH_ADDRESS not in msg


@pytest.mark.asyncio
async def test_timeout_raises_sanitized_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("too slow", request=request)

    source = OfacSource(_settings(), transport=_transport(handler))

    with pytest.raises(OfacSourceError) as exc_info:
        await source.fetch_initial(limit=10)

    assert "timed out" in str(exc_info.value)


@pytest.mark.asyncio
async def test_request_error_raises_sanitized_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connect failed", request=request)

    source = OfacSource(_settings(), transport=_transport(handler))

    with pytest.raises(OfacSourceError) as exc_info:
        await source.fetch_initial(limit=10)

    assert "request failed" in str(exc_info.value)


@pytest.mark.asyncio
async def test_fetch_since_returns_empty_list():
    source = _source_for_xml(_simple_xml())
    since = datetime(2026, 1, 1, tzinfo=timezone.utc)

    assert await source.fetch_since(since=since, limit=10) == []


@pytest.mark.asyncio
async def test_feature_type_id_lookup_extracts_address():
    """FeatureTypeID attribute path: live SDN_ADVANCED.XML encodes feature types
    as FeatureTypeID references into a ReferenceValueSets lookup table rather than
    inline featureType text. This test locks in _build_feature_type_map and the
    FeatureTypeID branch in _digital_currency_pairs."""
    # Mirrors live SDN_ADVANCED.XML structure: FeatureType is defined in
    # ReferenceValueSets and referenced by ID on the Feature element.
    # Profile is intentionally omitted so only DistinctParty is a candidate
    # entity, avoiding the duplicate that arises when both parent and nested
    # candidate elements produce separate seen_pairs sets.
    xml = f"""
    <Sanctions xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ADVANCED_XML">
      <ReferenceValueSets>
        <FeatureTypeValues>
          <FeatureType ID="345" FeatureTypeGroupID="1">Digital Currency Address - ETH</FeatureType>
          <FeatureType ID="344" FeatureTypeGroupID="1">Digital Currency Address - XBT</FeatureType>
        </FeatureTypeValues>
      </ReferenceValueSets>
      <DistinctParties>
        <DistinctParty FixedRef="99001">
          <Comment>CYBER2</Comment>
          <Feature ID="77001" FeatureTypeID="345">
            <FeatureVersion ID="88001" ReliabilityID="1">
              <VersionDetail DetailTypeID="1432">{_ETH_ADDRESS}</VersionDetail>
            </FeatureVersion>
          </Feature>
        </DistinctParty>
      </DistinctParties>
    </Sanctions>
    """
    source = _source_for_xml(xml)

    records = await source.fetch_initial(limit=10)

    assert len(records) == 1
    record = records[0]
    assert record.address == _ETH_ADDRESS
    assert record.source_chain == "ETH"
    assert record.raw_payload["id_type"] == "Digital Currency Address - ETH"
    assert record.raw_payload["asset"] == "ETH"
    assert record.source_category == "CYBER2"
