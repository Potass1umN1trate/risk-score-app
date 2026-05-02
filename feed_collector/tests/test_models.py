from datetime import datetime, timezone

from app.models import (
    FeedRunResult,
    FeedSourceConfig,
    NormalizedFlaggedAddress,
    RawFeedRecord,
)


def test_feed_source_config_construction():
    cfg = FeedSourceConfig(
        id="a1b2c3d4-0001-0001-0001-000000000001",
        code="chainabuse",
        name="Chainabuse",
        base_url="https://api.chainabuse.com/v0",
        last_success_at=None,
        config_json=None,
    )
    assert cfg.code == "chainabuse"
    assert cfg.base_url == "https://api.chainabuse.com/v0"
    assert cfg.last_success_at is None


def test_feed_source_config_with_timestamps():
    ts = datetime(2026, 1, 1, tzinfo=timezone.utc)
    cfg = FeedSourceConfig(
        id="test-id",
        code="ofac",
        name="OFAC SDN",
        base_url=None,
        last_success_at=ts,
        config_json={"key_ref": "OFAC_API_KEY"},
    )
    assert cfg.last_success_at == ts
    assert cfg.config_json == {"key_ref": "OFAC_API_KEY"}


def test_raw_feed_record_required_fields():
    rec = RawFeedRecord(
        address="12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y",
        network_code="BTC",
        risk_category_code="scam",
    )
    assert rec.address == "12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y"
    assert rec.network_code == "BTC"
    assert rec.risk_category_code == "scam"


def test_raw_feed_record_optional_fields_default_to_none():
    rec = RawFeedRecord(
        address="12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y",
        network_code="BTC",
        risk_category_code="scam",
    )
    assert rec.external_id is None
    assert rec.source_category is None
    assert rec.confidence is None
    assert rec.raw_payload is None


def test_raw_feed_record_all_fields():
    rec = RawFeedRecord(
        address="0x742d35cc6634c0532925a3b844bc454e4438f44e",
        network_code="ETH",
        risk_category_code="phishing",
        external_id="ext-001",
        source_category="phishing_site",
        confidence=0.85,
        raw_payload={"note": "test"},
    )
    assert rec.external_id == "ext-001"
    assert rec.confidence == 0.85


def test_normalized_flagged_address_required_fields():
    nfa = NormalizedFlaggedAddress(
        address="12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y",
        network_code="BTC",
        risk_category_code="scam",
    )
    assert nfa.address == "12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y"
    assert nfa.network_code == "BTC"
    assert nfa.risk_category_code == "scam"


def test_normalized_flagged_address_optional_fields_default_to_none():
    nfa = NormalizedFlaggedAddress(
        address="12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y",
        network_code="BTC",
        risk_category_code="scam",
    )
    assert nfa.comment is None
    assert nfa.external_id is None
    assert nfa.source_category is None
    assert nfa.confidence is None


def test_feed_run_result_defaults():
    result = FeedRunResult(
        source_code="dummy",
        fetched_count=3,
        normalized_count=2,
        skipped_count=1,
    )
    assert result.errors == []
    assert result.dry_run is True


def test_feed_run_result_with_errors():
    result = FeedRunResult(
        source_code="dummy",
        fetched_count=1,
        normalized_count=0,
        skipped_count=1,
        errors=["unsupported network 'FAKECHAIN'"],
        dry_run=True,
    )
    assert len(result.errors) == 1
    assert "FAKECHAIN" in result.errors[0]


def test_feed_run_result_dry_run_false():
    result = FeedRunResult(
        source_code="chainabuse",
        fetched_count=10,
        normalized_count=10,
        skipped_count=0,
        dry_run=False,
    )
    assert result.dry_run is False
