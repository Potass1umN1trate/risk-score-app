from datetime import datetime, timezone

import pytest

import app.repository as repo
from app.config import FeedCollectorSettings
from app.models import FeedSourceConfig, RawFeedRecord
from app.pipeline import run_pipeline


class _FakeSource:
    def __init__(
        self,
        *,
        supports_time_filter: bool,
        fetch_since_error: Exception | None = None,
    ) -> None:
        self._supports_time_filter = supports_time_filter
        self._fetch_since_error = fetch_since_error
        self.initial_calls = 0
        self.fetch_since_calls: list[datetime] = []

    @property
    def source_code(self) -> str:
        return "dummy"

    @property
    def supports_time_filter(self) -> bool:
        return self._supports_time_filter

    async def check_availability(self) -> bool:
        return True

    async def fetch_initial(self, limit: int) -> list[RawFeedRecord]:
        self.initial_calls += 1
        return _records(limit)

    async def fetch_since(self, since: datetime, limit: int) -> list[RawFeedRecord]:
        self.fetch_since_calls.append(since)
        if self._fetch_since_error is not None:
            raise self._fetch_since_error
        return _records(limit)


class _Pool:
    pass


def _records(limit: int) -> list[RawFeedRecord]:
    records = [
        RawFeedRecord(
            address="12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y",
            source_chain="BTC",
            source_category="scam",
            external_id="fake-001",
        )
    ]
    return records[:limit]


def _db_settings() -> FeedCollectorSettings:
    return FeedCollectorSettings(
        dry_run=False,
        database_url="postgresql://test:test@localhost:5432/test",
        dummy_initial_limit=10,
    )


def _feed_source_config(last_success_at: datetime | None) -> FeedSourceConfig:
    return FeedSourceConfig(
        id="ffffffff-dead-beef-cafe-000000000001",
        code="dummy",
        name="Dummy Test Source",
        base_url=None,
        last_success_at=last_success_at,
        config_json=None,
    )


def _patch_successful_repo(monkeypatch, last_success_at: datetime | None) -> dict[str, list]:
    calls: dict[str, list] = {
        "attempt": [],
        "success": [],
        "failure": [],
        "audit": [],
    }
    feed_source = _feed_source_config(last_success_at)

    async def get_feed_source_by_code(pool, code):
        return feed_source

    async def mark_feed_attempt(pool, feed_source_id):
        calls["attempt"].append(feed_source_id)

    async def mark_feed_success(pool, feed_source_id):
        calls["success"].append(feed_source_id)

    async def mark_feed_failure(pool, feed_source_id, error_message):
        calls["failure"].append((feed_source_id, error_message))

    async def resolve_network_id(pool, network_code):
        return 1

    async def resolve_risk_category_id(pool, risk_category_code):
        return 1

    async def upsert_flagged_address(pool, network_id, address, risk_category_id, comment):
        return "flagged-address-id"

    async def insert_flagged_address_source(pool, flagged_address_id, feed_source_id, record):
        return True

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
async def test_dry_run_uses_initial_fetch_without_db():
    settings = FeedCollectorSettings(dry_run=True, dummy_initial_limit=10)
    source = _FakeSource(supports_time_filter=True)

    result = await run_pipeline(source, settings)

    assert source.initial_calls == 1
    assert source.fetch_since_calls == []
    assert result.fetch_mode == "initial"
    assert result.fetch_since is None
    assert result.dry_run is True


@pytest.mark.asyncio
async def test_db_first_run_uses_initial_fetch(monkeypatch):
    calls = _patch_successful_repo(monkeypatch, last_success_at=None)
    source = _FakeSource(supports_time_filter=True)

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert source.initial_calls == 1
    assert source.fetch_since_calls == []
    assert result.fetch_mode == "initial"
    assert result.fetch_since is None
    assert calls["attempt"] == ["ffffffff-dead-beef-cafe-000000000001"]
    assert calls["success"] == ["ffffffff-dead-beef-cafe-000000000001"]


@pytest.mark.asyncio
async def test_db_repeat_time_filter_source_uses_fetch_since(monkeypatch):
    since = datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)
    _patch_successful_repo(monkeypatch, last_success_at=since)
    source = _FakeSource(supports_time_filter=True)

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert source.initial_calls == 0
    assert source.fetch_since_calls == [since]
    assert result.fetch_mode == "incremental"
    assert result.fetch_since == since


@pytest.mark.asyncio
async def test_db_repeat_non_time_filter_source_uses_repeat_full(monkeypatch):
    since = datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)
    _patch_successful_repo(monkeypatch, last_success_at=since)
    source = _FakeSource(supports_time_filter=False)

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert source.initial_calls == 1
    assert source.fetch_since_calls == []
    assert result.fetch_mode == "repeat_full"
    assert result.fetch_since is None


@pytest.mark.asyncio
async def test_fetch_since_failure_does_not_fallback_to_initial(monkeypatch):
    since = datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)
    calls = _patch_successful_repo(monkeypatch, last_success_at=since)
    source = _FakeSource(
        supports_time_filter=True,
        fetch_since_error=RuntimeError("source rejected since"),
    )

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert source.initial_calls == 0
    assert source.fetch_since_calls == [since]
    assert result.fetch_mode == "incremental"
    assert result.fetch_since == since
    assert result.fetched_count == 0
    assert result.normalized_count == 0
    assert len(result.errors) == 1
    assert "RuntimeError" in result.errors[0]
    assert result.source_error_count == 1
    assert calls["failure"] == [
        (
            "ffffffff-dead-beef-cafe-000000000001",
            "Fetch failed for source 'dummy': RuntimeError: source rejected since",
        )
    ]
    assert calls["success"] == []
    assert calls["audit"] == []


@pytest.mark.asyncio
async def test_missing_feed_source_remains_graceful_and_does_not_fetch(monkeypatch):
    async def get_feed_source_by_code(pool, code):
        return None

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("repository state mutation should not be called")

    monkeypatch.setattr(repo, "get_feed_source_by_code", get_feed_source_by_code)
    monkeypatch.setattr(repo, "mark_feed_attempt", fail_if_called)

    source = _FakeSource(supports_time_filter=True)

    result = await run_pipeline(source, _db_settings(), db_pool=_Pool())

    assert source.initial_calls == 0
    assert source.fetch_since_calls == []
    assert result.fetched_count == 0
    assert len(result.errors) == 1
    assert "not configured" in result.errors[0].lower()
