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
        source_chain="BTC",
        source_category="scam",
    )
    assert rec.address == "12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y"
    assert rec.source_chain == "BTC"
    assert rec.source_category == "scam"


def test_raw_feed_record_optional_fields_default_to_none():
    rec = RawFeedRecord(
        address="12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y",
        source_chain="BTC",
        source_category="scam",
    )
    assert rec.external_id is None
    assert rec.confidence is None
    assert rec.trusted is None
    assert rec.checked is None
    assert rec.first_seen is None
    assert rec.last_seen is None
    assert rec.raw_payload is None


def test_raw_feed_record_all_fields():
    ts = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rec = RawFeedRecord(
        address="0x742d35cc6634c0532925a3b844bc454e4438f44e",
        source_chain="Ethereum",
        source_category="phishing_site",
        external_id="ext-001",
        confidence=0.85,
        trusted=True,
        checked=False,
        first_seen=ts,
        last_seen=ts,
        raw_payload={"note": "test"},
    )
    assert rec.external_id == "ext-001"
    assert rec.confidence == 0.85
    assert rec.trusted is True
    assert rec.checked is False
    assert rec.first_seen == ts
    assert rec.last_seen == ts


def test_normalized_flagged_address_required_fields():
    nfa = NormalizedFlaggedAddress(
        address="12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y",
        network_code="BTC",
        risk_category_code="scam",
        source_chain="Bitcoin",
        source_category="fraud",
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
    assert nfa.source_chain is None
    assert nfa.source_category is None
    assert nfa.confidence is None
    assert nfa.trusted is None
    assert nfa.checked is None
    assert nfa.first_seen is None
    assert nfa.last_seen is None


def test_feed_run_result_defaults():
    result = FeedRunResult(
        source_code="dummy",
        fetched_count=3,
        normalized_count=2,
        skipped_count=1,
    )
    assert result.errors == []
    assert result.dry_run is True
    assert result.fetch_mode is None
    assert result.fetch_since is None
    assert result.persisted_count == 0
    assert result.evidence_inserted_count == 0
    assert result.duplicate_count == 0
    assert result.record_error_count == 0
    assert result.source_error_count == 0


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
        fetch_mode="incremental",
        fetch_since=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    assert result.dry_run is False
    assert result.fetch_mode == "incremental"
    assert result.fetch_since == datetime(2026, 1, 1, tzinfo=timezone.utc)
