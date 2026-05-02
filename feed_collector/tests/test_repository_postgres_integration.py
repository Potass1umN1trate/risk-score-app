"""
Postgres integration tests for the feed_collector repository layer.

Skipped unless TEST_DATABASE_URL is set. Never reads DATABASE_URL.
No Docker, k3s, external API, or blockchain dependency.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.models import NormalizedFlaggedAddress
from app.pipeline import run_pipeline
from app.config import FeedCollectorSettings
from app.sources.dummy import DummySource
import app.repository as repo


pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"),
    reason="TEST_DATABASE_URL is not set; skipping Postgres integration tests",
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCHEMA_CONFIGMAP = _REPO_ROOT / "k8s" / "postgres" / "initdb-configmap.yaml"

# Deterministic UUID for the temporary dummy feed_source row.
_DUMMY_FEED_SOURCE_ID = "ffffffff-dead-beef-cafe-000000000001"


def _load_initdb_schema_sql() -> str:
    lines = _SCHEMA_CONFIGMAP.read_text(encoding="utf-8").splitlines()
    for idx, line in enumerate(lines):
        if line.strip() == "01_schema.sql: |":
            block = []
            for raw in lines[idx + 1 :]:
                if raw and not raw.startswith("    "):
                    break
                block.append(raw[4:] if raw.startswith("    ") else "")
            sql = "\n".join(block).strip()
            if not sql:
                raise AssertionError("01_schema.sql block is empty")
            return sql
    raise AssertionError("01_schema.sql block not found in initdb configmap")


@pytest_asyncio.fixture
async def pg_pool():
    pool = await asyncpg.create_pool(
        os.environ["TEST_DATABASE_URL"], min_size=1, max_size=2
    )
    try:
        await pool.execute(_load_initdb_schema_sql())
        yield pool
    finally:
        await pool.close()


@pytest_asyncio.fixture
async def dummy_feed_source(pg_pool):
    """Insert a temporary active 'dummy' row into feed_sources, clean up after."""
    await pg_pool.execute(
        """
        INSERT INTO feed_sources (id, code, name, is_active)
        VALUES ($1, 'dummy', 'Dummy Test Source', TRUE)
        ON CONFLICT (code) DO UPDATE SET is_active = TRUE
        """,
        _DUMMY_FEED_SOURCE_ID,
    )
    yield _DUMMY_FEED_SOURCE_ID
    await pg_pool.execute(
        "DELETE FROM feed_sources WHERE id = $1", _DUMMY_FEED_SOURCE_ID
    )


# ---------------------------------------------------------------------------
# get_feed_source_by_code
# ---------------------------------------------------------------------------


async def test_get_feed_source_by_code_returns_seeded_chainabuse(pg_pool):
    result = await repo.get_feed_source_by_code(pg_pool, "chainabuse")
    assert result is not None
    assert result.code == "chainabuse"
    assert result.id == "a1b2c3d4-0001-0001-0001-000000000001"
    assert result.name == "Chainabuse"
    assert result.base_url == "https://api.chainabuse.com/v0"


async def test_get_feed_source_by_code_returns_none_for_missing_code(pg_pool):
    result = await repo.get_feed_source_by_code(pg_pool, "nonexistent_source_xyz")
    assert result is None


# ---------------------------------------------------------------------------
# mark_feed_attempt / mark_feed_success / mark_feed_failure
# ---------------------------------------------------------------------------


async def test_mark_feed_attempt_sets_last_attempt_at(pg_pool, dummy_feed_source):
    feed_source_id = dummy_feed_source
    await repo.mark_feed_attempt(pg_pool, feed_source_id)
    row = await pg_pool.fetchrow(
        "SELECT last_attempt_at FROM feed_sources WHERE id = $1", feed_source_id
    )
    assert row["last_attempt_at"] is not None


async def test_mark_feed_success_sets_last_success_at_and_clears_error(
    pg_pool, dummy_feed_source
):
    feed_source_id = dummy_feed_source
    # First set an error to confirm it is cleared.
    await pg_pool.execute(
        "UPDATE feed_sources SET last_error = 'prior error' WHERE id = $1",
        feed_source_id,
    )
    await repo.mark_feed_success(pg_pool, feed_source_id)
    row = await pg_pool.fetchrow(
        "SELECT last_success_at, last_error FROM feed_sources WHERE id = $1",
        feed_source_id,
    )
    assert row["last_success_at"] is not None
    assert row["last_error"] is None


async def test_mark_feed_failure_sets_last_error(pg_pool, dummy_feed_source):
    feed_source_id = dummy_feed_source
    await repo.mark_feed_failure(pg_pool, feed_source_id, "test error message")
    row = await pg_pool.fetchrow(
        "SELECT last_error FROM feed_sources WHERE id = $1", feed_source_id
    )
    assert row["last_error"] == "test error message"


# ---------------------------------------------------------------------------
# resolve_network_id
# ---------------------------------------------------------------------------


async def test_resolve_network_id_known_returns_int(pg_pool):
    result = await repo.resolve_network_id(pg_pool, "BTC")
    assert isinstance(result, int)


async def test_resolve_network_id_lowercase_input_works(pg_pool):
    result = await repo.resolve_network_id(pg_pool, "eth")
    assert result is not None


async def test_resolve_network_id_unknown_returns_none(pg_pool):
    result = await repo.resolve_network_id(pg_pool, "UNKNOWN_CHAIN_XYZ")
    assert result is None


# ---------------------------------------------------------------------------
# resolve_risk_category_id
# ---------------------------------------------------------------------------


async def test_resolve_risk_category_id_scam_returns_int(pg_pool):
    result = await repo.resolve_risk_category_id(pg_pool, "scam")
    assert isinstance(result, int)


async def test_resolve_risk_category_id_phishing_returns_int(pg_pool):
    result = await repo.resolve_risk_category_id(pg_pool, "phishing")
    assert isinstance(result, int)


async def test_resolve_risk_category_id_unknown_returns_none(pg_pool):
    result = await repo.resolve_risk_category_id(pg_pool, "not_a_real_category_xyz")
    assert result is None


# ---------------------------------------------------------------------------
# upsert_flagged_address
# ---------------------------------------------------------------------------


async def test_upsert_flagged_address_inserts_and_returns_id(pg_pool):
    address = f"btc-integ-{uuid.uuid4().hex[:12]}"
    network_id = await repo.resolve_network_id(pg_pool, "BTC")
    risk_category_id = await repo.resolve_risk_category_id(pg_pool, "scam")
    assert network_id is not None
    assert risk_category_id is not None

    returned_id = await repo.upsert_flagged_address(
        pg_pool, network_id, address, risk_category_id, "integration test"
    )
    try:
        assert isinstance(returned_id, str) and len(returned_id) == 36
        row = await pg_pool.fetchrow(
            "SELECT id, address, comment FROM flagged_addresses WHERE id = $1",
            returned_id,
        )
        assert row is not None
        assert row["address"] == address
        assert row["comment"] == "integration test"
    finally:
        await pg_pool.execute(
            "DELETE FROM flagged_addresses WHERE id = $1", returned_id
        )


async def test_upsert_flagged_address_deduplicates_and_returns_same_id(pg_pool):
    address = f"btc-dedup-{uuid.uuid4().hex[:12]}"
    network_id = await repo.resolve_network_id(pg_pool, "BTC")
    risk_category_id = await repo.resolve_risk_category_id(pg_pool, "scam")

    first_id = await repo.upsert_flagged_address(
        pg_pool, network_id, address, risk_category_id, None
    )
    try:
        second_id = await repo.upsert_flagged_address(
            pg_pool, network_id, address, risk_category_id, "second attempt"
        )
        assert first_id == second_id

        count = await pg_pool.fetchval(
            "SELECT count(*) FROM flagged_addresses WHERE network_id=$1 AND address=$2",
            network_id,
            address,
        )
        assert count == 1
    finally:
        await pg_pool.execute(
            "DELETE FROM flagged_addresses WHERE id = $1", first_id
        )


# ---------------------------------------------------------------------------
# insert_flagged_address_source
# ---------------------------------------------------------------------------


async def _insert_canonical_address(pool, network_code: str, address: str, category: str) -> str:
    """Helper: insert a flagged_addresses row and return its id."""
    network_id = await repo.resolve_network_id(pool, network_code)
    risk_category_id = await repo.resolve_risk_category_id(pool, category)
    return await repo.upsert_flagged_address(pool, network_id, address, risk_category_id, None)


async def test_insert_flagged_address_source_with_external_id_inserts_once(
    pg_pool, dummy_feed_source
):
    feed_source_id = dummy_feed_source
    address = f"btc-fas-ext-{uuid.uuid4().hex[:10]}"
    flagged_address_id = await _insert_canonical_address(pg_pool, "BTC", address, "scam")

    try:
        nfa = NormalizedFlaggedAddress(
            address=address,
            network_code="BTC",
            risk_category_code="scam",
            external_id="ext-001",
            source_chain="Bitcoin source label",
            source_category="fraud",
            confidence=0.9,
            raw_payload={"note": "test"},
        )
        inserted_first = await repo.insert_flagged_address_source(
            pg_pool, flagged_address_id, feed_source_id, nfa
        )
        inserted_second = await repo.insert_flagged_address_source(
            pg_pool, flagged_address_id, feed_source_id, nfa
        )
        assert inserted_first is True
        assert inserted_second is False

        count = await pg_pool.fetchval(
            """
            SELECT count(*) FROM flagged_address_sources
            WHERE flagged_address_id = $1 AND feed_source_id = $2
            """,
            flagged_address_id,
            feed_source_id,
        )
        assert count == 1
    finally:
        await pg_pool.execute(
            "DELETE FROM flagged_address_sources WHERE flagged_address_id = $1",
            flagged_address_id,
        )
        await pg_pool.execute(
            "DELETE FROM flagged_addresses WHERE id = $1", flagged_address_id
        )


async def test_insert_flagged_address_source_without_external_id_inserts_once(
    pg_pool, dummy_feed_source
):
    feed_source_id = dummy_feed_source
    address = f"btc-fas-noext-{uuid.uuid4().hex[:10]}"
    flagged_address_id = await _insert_canonical_address(pg_pool, "BTC", address, "scam")

    try:
        nfa = NormalizedFlaggedAddress(
            address=address,
            network_code="BTC",
            risk_category_code="scam",
            external_id=None,
            source_chain="BTC native",
            source_category="fraud",
            confidence=0.7,
        )
        inserted_first = await repo.insert_flagged_address_source(
            pg_pool, flagged_address_id, feed_source_id, nfa
        )
        inserted_second = await repo.insert_flagged_address_source(
            pg_pool, flagged_address_id, feed_source_id, nfa
        )
        assert inserted_first is True
        assert inserted_second is False

        count = await pg_pool.fetchval(
            """
            SELECT count(*) FROM flagged_address_sources
            WHERE flagged_address_id = $1 AND feed_source_id = $2
            """,
            flagged_address_id,
            feed_source_id,
        )
        assert count == 1
    finally:
        await pg_pool.execute(
            "DELETE FROM flagged_address_sources WHERE flagged_address_id = $1",
            flagged_address_id,
        )
        await pg_pool.execute(
            "DELETE FROM flagged_addresses WHERE id = $1", flagged_address_id
        )


async def test_insert_flagged_address_source_stores_evidence_fields(
    pg_pool, dummy_feed_source
):
    feed_source_id = dummy_feed_source
    address = f"btc-fas-payload-{uuid.uuid4().hex[:10]}"
    flagged_address_id = await _insert_canonical_address(pg_pool, "BTC", address, "scam")
    first_seen = datetime(2026, 1, 1, tzinfo=timezone.utc)
    last_seen = datetime(2026, 1, 2, tzinfo=timezone.utc)

    try:
        nfa = NormalizedFlaggedAddress(
            address=address,
            network_code="BTC",
            risk_category_code="scam",
            external_id="ext-payload-test",
            source_chain="Bitcoin native",
            source_category="source scam",
            confidence=0.81,
            trusted=True,
            checked=False,
            first_seen=first_seen,
            last_seen=last_seen,
            raw_payload={"source": "dummy", "note": "payload test"},
        )
        await repo.insert_flagged_address_source(
            pg_pool, flagged_address_id, feed_source_id, nfa
        )
        row = await pg_pool.fetchrow(
            """
            SELECT source_chain, source_category, confidence, trusted, checked,
                   first_seen, last_seen, raw_payload_json
            FROM flagged_address_sources
            WHERE flagged_address_id = $1 AND feed_source_id = $2
            """,
            flagged_address_id,
            feed_source_id,
        )
        assert row is not None
        assert row["source_chain"] == "Bitcoin native"
        assert row["source_category"] == "source scam"
        assert float(row["confidence"]) == 0.81
        assert row["trusted"] is True
        assert row["checked"] is False
        assert row["first_seen"] == first_seen
        assert row["last_seen"] == last_seen
        raw_payload = row["raw_payload_json"]
        assert raw_payload is not None
        payload = json.loads(raw_payload) if isinstance(raw_payload, str) else raw_payload
        assert payload["note"] == "payload test"
    finally:
        await pg_pool.execute(
            "DELETE FROM flagged_address_sources WHERE flagged_address_id = $1",
            flagged_address_id,
        )
        await pg_pool.execute(
            "DELETE FROM flagged_addresses WHERE id = $1", flagged_address_id
        )


# ---------------------------------------------------------------------------
# write_audit_log
# ---------------------------------------------------------------------------


async def test_write_audit_log_inserts_feed_collect_row(pg_pool, dummy_feed_source):
    from app.models import FeedRunResult

    feed_source_id = dummy_feed_source
    result = FeedRunResult(
        source_code="dummy",
        fetched_count=3,
        normalized_count=2,
        skipped_count=1,
        errors=["skipped FAKECHAIN"],
        dry_run=False,
    )

    await repo.write_audit_log(pg_pool, feed_source_id, "dummy", result)

    row = await pg_pool.fetchrow(
        """
        SELECT action, entity, entity_id, details_json, user_id, actor_role
        FROM audit_logs
        WHERE entity_id = $1 AND action = 'FEED_COLLECT'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        feed_source_id,
    )
    try:
        assert row is not None
        assert row["action"] == "FEED_COLLECT"
        assert row["entity"] == "feed_source"
        assert row["entity_id"] == feed_source_id
        assert row["user_id"] is None
        assert row["actor_role"] is None
        details = json.loads(row["details_json"]) if isinstance(row["details_json"], str) else row["details_json"]
        assert details["source_code"] == "dummy"
        assert details["fetched_count"] == 3
        assert details["normalized_count"] == 2
        assert details["skipped_count"] == 1
        assert details["error_count"] == 1
        assert details["dry_run"] is False
    finally:
        await pg_pool.execute(
            "DELETE FROM audit_logs WHERE entity_id = $1 AND action = 'FEED_COLLECT'",
            feed_source_id,
        )


# ---------------------------------------------------------------------------
# Full pipeline dry_run=False end-to-end
# ---------------------------------------------------------------------------


async def test_full_pipeline_dry_run_false_end_to_end(pg_pool, dummy_feed_source):
    """
    Run the complete pipeline with DummySource and dry_run=False.
    Expects:
      - 2 flagged_addresses rows (BTC scam + ETH phishing)
      - 2 flagged_address_sources evidence rows
      - 1 FAKECHAIN record skipped
      - 1 FEED_COLLECT audit_logs row
    """
    settings = FeedCollectorSettings(
        dry_run=False,
        database_url=os.environ["TEST_DATABASE_URL"],
        dummy_initial_limit=10,
    )
    source = DummySource()

    # Capture addresses written by DummySource (normalized forms)
    btc_address = "12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y"
    eth_address = "0x742d35cc6634c0532925a3b844bc454e4438f44e"

    try:
        result = await run_pipeline(source, settings, db_pool=pg_pool)

        # Pipeline summary checks
        assert result.dry_run is False
        assert result.source_code == "dummy"
        assert result.fetched_count == 3
        assert result.normalized_count == 2
        assert result.skipped_count == 1
        assert any("FAKECHAIN" in e for e in result.errors)

        # Verify 2 flagged_addresses rows exist
        btc_network_id = await repo.resolve_network_id(pg_pool, "BTC")
        eth_network_id = await repo.resolve_network_id(pg_pool, "ETH")

        btc_row = await pg_pool.fetchrow(
            "SELECT id FROM flagged_addresses WHERE network_id=$1 AND address=$2",
            btc_network_id,
            btc_address,
        )
        eth_row = await pg_pool.fetchrow(
            "SELECT id FROM flagged_addresses WHERE network_id=$1 AND address=$2",
            eth_network_id,
            eth_address,
        )
        assert btc_row is not None, "BTC flagged_addresses row missing"
        assert eth_row is not None, "ETH flagged_addresses row missing"

        # Verify 2 flagged_address_sources evidence rows for this feed_source
        fas_count = await pg_pool.fetchval(
            """
            SELECT count(*) FROM flagged_address_sources
            WHERE feed_source_id = $1
              AND flagged_address_id = ANY($2::text[])
            """,
            dummy_feed_source,
            [btc_row["id"], eth_row["id"]],
        )
        assert fas_count == 2, f"Expected 2 evidence rows, got {fas_count}"

        # Verify 1 FEED_COLLECT audit row
        audit_count = await pg_pool.fetchval(
            """
            SELECT count(*) FROM audit_logs
            WHERE entity_id = $1 AND action = 'FEED_COLLECT'
            """,
            dummy_feed_source,
        )
        assert audit_count == 1, f"Expected 1 audit row, got {audit_count}"

        # feed_sources sync state
        fs_row = await pg_pool.fetchrow(
            "SELECT last_success_at, last_error FROM feed_sources WHERE id = $1",
            dummy_feed_source,
        )
        assert fs_row["last_success_at"] is not None
        assert fs_row["last_error"] is None

    finally:
        # Clean up in dependency order: sources → addresses → audit rows
        for flagged_id_row in [btc_row, eth_row]:
            if flagged_id_row is not None:
                await pg_pool.execute(
                    "DELETE FROM flagged_address_sources WHERE flagged_address_id = $1",
                    flagged_id_row["id"],
                )
                await pg_pool.execute(
                    "DELETE FROM flagged_addresses WHERE id = $1",
                    flagged_id_row["id"],
                )
        await pg_pool.execute(
            "DELETE FROM audit_logs WHERE entity_id = $1 AND action = 'FEED_COLLECT'",
            dummy_feed_source,
        )


async def test_pipeline_dry_run_false_missing_feed_source_returns_error(pg_pool):
    """
    When the source_code is not present in feed_sources, the pipeline must return
    an error result without fetching records or crashing.
    """
    settings = FeedCollectorSettings(
        dry_run=False,
        database_url=os.environ["TEST_DATABASE_URL"],
        dummy_initial_limit=10,
    )

    class _UnknownSource(DummySource):
        @property
        def source_code(self) -> str:
            return "no_such_source_in_db"

    source = _UnknownSource()
    result = await run_pipeline(source, settings, db_pool=pg_pool)

    assert result.dry_run is False
    assert result.fetched_count == 0
    assert result.normalized_count == 0
    assert len(result.errors) == 1
    assert "not configured" in result.errors[0].lower() or "not active" in result.errors[0].lower()
