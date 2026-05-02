from datetime import datetime, timezone
import logging

import pytest

import app.repository as repo
from app.config import FeedCollectorSettings
from app.models import FeedRunResult, FeedSourceConfig, RawFeedRecord
from app.pipeline import run_pipeline


class _FakeSource:
    def __init__(
        self,
        records: list[RawFeedRecord] | None = None,
        *,
        available: bool = True,
        supports_time_filter: bool = False,
        fetch_error: Exception | None = None,
        last_success_at: datetime | None = None,
    ) -> None:
        self.records = records or []
        self.available = available
        self._supports_time_filter = supports_time_filter
        self.fetch_error = fetch_error
        self.last_success_at = last_success_at
        self.initial_calls = 0
        self.fetch_since_calls: list[datetime] = []

    @property
    def source_code(self) -> str:
        return "dummy"

    @property
    def supports_time_filter(self) -> bool:
        return self._supports_time_filter

    async def check_availability(self) -> bool:
        return self.available

    async def fetch_initial(self, limit: int) -> list[RawFeedRecord]:
        self.initial_calls += 1
        if self.fetch_error is not None:
            raise self.fetch_error
        return self.records[:limit]

    async def fetch_since(self, since: datetime, limit: int) -> list[RawFeedRecord]:
        self.fetch_since_calls.append(since)
        if self.fetch_error is not None:
            raise self.fetch_error
        return self.records[:limit]


class _Pool:
    pass


def _db_settings(limit: int = 10) -> FeedCollectorSettings:
    return FeedCollectorSettings(
        dry_run=False,
        database_url="postgresql://test:test@localhost:5432/test",
        dummy_initial_limit=limit,
    )


def _dry_settings(limit: int = 10) -> FeedCollectorSettings:
    return FeedCollectorSettings(dry_run=True, dummy_initial_limit=limit)


def _feed_source_config(last_success_at: datetime | None = None) -> FeedSourceConfig:
    return FeedSourceConfig(
        id="feed-source-id",
        code="dummy",
        name="Dummy",
        base_url=None,
        last_success_at=last_success_at,
        config_json=None,
    )


def _btc_record(external_id: str = "ext-btc") -> RawFeedRecord:
    return RawFeedRecord(
        address=f"btc-address-{external_id}",
        source_chain="BTC",
        source_category="scam",
        external_id=external_id,
    )


def _eth_record(external_id: str = "ext-eth") -> RawFeedRecord:
    return RawFeedRecord(
        address="0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        source_chain="ETH",
        source_category="phishing",
        external_id=external_id,
    )


def _unsupported_record() -> RawFeedRecord:
    return RawFeedRecord(
        address="unsupported-address",
        source_chain="FAKECHAIN",
        source_category="scam",
        external_id="ext-unsupported",
    )


def _patch_repo(
    monkeypatch,
    *,
    last_success_at: datetime | None = None,
    missing_networks: set[str] | None = None,
    missing_categories: set[str] | None = None,
    duplicate_external_ids: set[str] | None = None,
    raise_for_external_ids: set[str] | None = None,
) -> dict[str, list]:
    calls: dict[str, list] = {
        "attempt": [],
        "success": [],
        "failure": [],
        "audit": [],
        "upserted": [],
        "evidence": [],
    }
    missing_networks = missing_networks or set()
    missing_categories = missing_categories or set()
    duplicate_external_ids = duplicate_external_ids or set()
    raise_for_external_ids = raise_for_external_ids or set()

    async def get_feed_source_by_code(pool, code):
        return _feed_source_config(last_success_at)

    async def mark_feed_attempt(pool, feed_source_id):
        calls["attempt"].append(feed_source_id)

    async def mark_feed_success(pool, feed_source_id):
        calls["success"].append(feed_source_id)

    async def mark_feed_failure(pool, feed_source_id, error_message):
        calls["failure"].append((feed_source_id, error_message))

    async def resolve_network_id(pool, network_code):
        if network_code in missing_networks:
            return None
        return {"BTC": 1, "ETH": 2}.get(network_code, 99)

    async def resolve_risk_category_id(pool, risk_category_code):
        if risk_category_code in missing_categories:
            return None
        return {"scam": 1, "phishing": 2}.get(risk_category_code, 99)

    async def upsert_flagged_address(pool, network_id, address, risk_category_id, comment):
        calls["upserted"].append(address)
        return f"flagged-{address}"

    async def insert_flagged_address_source(pool, flagged_address_id, feed_source_id, record):
        if record.external_id in raise_for_external_ids:
            raise RuntimeError(
                "insert failed Authorization: Bearer abc api_key=secret password=secret "
                "postgresql://user:pass@localhost:5432/live"
            )
        calls["evidence"].append(record.external_id)
        return record.external_id not in duplicate_external_ids

    async def write_audit_log(pool, feed_source_id, feed_source_code, result):
        calls["audit"].append(result)

    monkeypatch.setattr(repo, "get_feed_source_by_code", get_feed_source_by_code)
    monkeypatch.setattr(repo, "mark_feed_attempt", mark_feed_attempt)
    monkeypatch.setattr(repo, "mark_feed_success", mark_feed_success)
    monkeypatch.setattr(repo, "mark_feed_failure", mark_feed_failure)
    monkeypatch.setattr(repo, "resolve_network_id", resolve_network_id)
    monkeypatch.setattr(repo, "resolve_risk_category_id", resolve_risk_category_id)
    monkeypatch.setattr(repo, "upsert_flagged_address", upsert_flagged_address)
    monkeypatch.setattr(repo, "insert_flagged_address_source", insert_flagged_address_source)
    monkeypatch.setattr(repo, "write_audit_log", write_audit_log)
    return calls


@pytest.mark.asyncio
async def test_valid_record_persists_while_unsupported_mapping_is_skipped(monkeypatch):
    calls = _patch_repo(monkeypatch)
    source = _FakeSource([_btc_record(), _unsupported_record()])

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert result.fetched_count == 2
    assert result.normalized_count == 1
    assert result.skipped_count == 1
    assert result.persisted_count == 1
    assert result.evidence_inserted_count == 1
    assert result.record_error_count == 0
    assert calls["success"] == ["feed-source-id"]
    assert calls["audit"] == [result]


@pytest.mark.asyncio
async def test_unknown_network_and_category_are_skipped_not_record_errors(monkeypatch):
    _patch_repo(
        monkeypatch,
        missing_networks={"BTC"},
        missing_categories={"phishing"},
    )
    source = _FakeSource([_btc_record(), _eth_record()])

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert result.skipped_count == 2
    assert result.persisted_count == 0
    assert result.record_error_count == 0
    assert result.source_error_count == 0


@pytest.mark.asyncio
async def test_evidence_conflict_counts_duplicate_not_error(monkeypatch):
    _patch_repo(monkeypatch, duplicate_external_ids={"ext-btc"})
    source = _FakeSource([_btc_record()])

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert result.persisted_count == 1
    assert result.evidence_inserted_count == 0
    assert result.duplicate_count == 1
    assert result.record_error_count == 0
    assert result.errors == []


@pytest.mark.asyncio
async def test_repository_exception_for_one_record_continues_to_next(monkeypatch):
    calls = _patch_repo(monkeypatch, raise_for_external_ids={"bad"})
    source = _FakeSource([_btc_record("bad"), _btc_record("good")])

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert result.normalized_count == 2
    assert result.persisted_count == 1
    assert result.evidence_inserted_count == 1
    assert result.record_error_count == 1
    assert result.source_error_count == 0
    assert calls["success"] == ["feed-source-id"]
    assert calls["failure"] == []
    assert "password=secret" not in result.errors[0]
    assert "Authorization: Bearer abc" not in result.errors[0]
    assert "api_key=secret" not in result.errors[0]
    assert "postgresql://user:pass" not in result.errors[0]
    assert "[REDACTED_AUTHORIZATION]" in result.errors[0]
    assert "[REDACTED_SECRET]" in result.errors[0]
    assert "[REDACTED_DATABASE_URL]" in result.errors[0]


@pytest.mark.asyncio
async def test_source_fetch_exception_sets_source_error_and_does_not_fallback(monkeypatch):
    since = datetime(2026, 5, 1, tzinfo=timezone.utc)
    calls = _patch_repo(monkeypatch, last_success_at=since)
    source = _FakeSource(
        supports_time_filter=True,
        fetch_error=RuntimeError("source rejected since token=abc"),
    )

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert source.initial_calls == 0
    assert source.fetch_since_calls == [since]
    assert result.source_error_count == 1
    assert result.record_error_count == 0
    assert calls["failure"]
    assert calls["success"] == []
    assert "token=abc" not in result.errors[0]


@pytest.mark.asyncio
async def test_source_unavailable_sets_source_error_and_does_not_fetch(monkeypatch):
    calls = _patch_repo(monkeypatch)
    source = _FakeSource(available=False)

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert source.initial_calls == 0
    assert result.source_error_count == 1
    assert result.fetched_count == 0
    assert calls["failure"]
    assert calls["success"] == []


@pytest.mark.asyncio
async def test_partial_record_errors_still_mark_feed_success(monkeypatch):
    calls = _patch_repo(monkeypatch, raise_for_external_ids={"bad"})
    source = _FakeSource([_btc_record("bad"), _btc_record("good")])

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert result.record_error_count == 1
    assert result.persisted_count == 1
    assert calls["success"] == ["feed-source-id"]
    assert calls["failure"] == []


@pytest.mark.asyncio
async def test_error_samples_are_bounded(monkeypatch):
    _patch_repo(monkeypatch, raise_for_external_ids={f"bad-{idx}" for idx in range(12)})
    source = _FakeSource([_btc_record(f"bad-{idx}") for idx in range(12)])

    result = await run_pipeline(source, _db_settings(limit=20), db_pool=_Pool())

    assert result.record_error_count == 12
    assert len(result.errors) == 10


@pytest.mark.asyncio
async def test_audit_details_include_counters_and_bounded_sanitized_errors():
    captured: dict[str, object] = {}

    class _AuditPool:
        async def execute(self, query, log_id, feed_source_id, details_json):
            captured["details_json"] = details_json

    result = FeedRunResult(
        source_code="dummy",
        fetched_count=12,
        normalized_count=12,
        skipped_count=1,
        persisted_count=1,
        evidence_inserted_count=0,
        duplicate_count=1,
        record_error_count=12,
        source_error_count=0,
        dry_run=False,
        errors=[
            "failure password=secret "
            "postgresql://user:pass@localhost:5432/live"
            for _ in range(12)
        ],
    )

    await repo.write_audit_log(_AuditPool(), "feed-source-id", "dummy", result)

    import json

    details = json.loads(captured["details_json"])
    assert details["persisted_count"] == 1
    assert details["evidence_inserted_count"] == 0
    assert details["duplicate_count"] == 1
    assert details["record_error_count"] == 12
    assert details["source_error_count"] == 0
    assert len(details["error_samples"]) == 10
    assert "password=secret" not in details["error_samples"][0]
    assert "postgresql://user:pass" not in details["error_samples"][0]


@pytest.mark.asyncio
async def test_dry_run_fetch_exception_is_source_failure():
    source = _FakeSource(fetch_error=RuntimeError("boom api_key=secret"))

    result = await run_pipeline(source, _dry_settings())

    assert result.source_error_count == 1
    assert result.fetched_count == 0
    assert result.errors
    assert "api_key=secret" not in result.errors[0]


@pytest.mark.asyncio
async def test_source_failure_logs_sanitized_message(caplog):
    source = _FakeSource(
        fetch_error=RuntimeError(
            "boom postgresql://user:pass@host/db "
            "Authorization: Bearer abc api_key=secret"
        )
    )
    caplog.set_level(logging.WARNING, logger="app.pipeline")

    await run_pipeline(source, _dry_settings())

    log_text = caplog.text
    assert "postgresql://user:pass@host/db" not in log_text
    assert "Authorization: Bearer abc" not in log_text
    assert "api_key=secret" not in log_text
    assert "[REDACTED_DATABASE_URL]" in log_text
    assert "[REDACTED_AUTHORIZATION]" in log_text
    assert "[REDACTED_SECRET]" in log_text
    assert "Traceback" not in log_text


@pytest.mark.asyncio
async def test_record_failure_logs_sanitized_message(monkeypatch, caplog):
    _patch_repo(monkeypatch, raise_for_external_ids={"bad"})
    source = _FakeSource([_btc_record("bad")])
    caplog.set_level(logging.WARNING, logger="app.pipeline")

    await run_pipeline(source, _db_settings(), db_pool=_Pool())

    log_text = caplog.text
    assert "postgresql://user:pass@localhost:5432/live" not in log_text
    assert "Authorization: Bearer abc" not in log_text
    assert "api_key=secret" not in log_text
    assert "password=secret" not in log_text
    assert "[REDACTED_DATABASE_URL]" in log_text
    assert "[REDACTED_AUTHORIZATION]" in log_text
    assert "[REDACTED_SECRET]" in log_text
    assert "Traceback" not in log_text
