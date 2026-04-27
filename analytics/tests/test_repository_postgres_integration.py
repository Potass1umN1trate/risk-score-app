"""
Postgres integration smoke tests for analytics repository persistence.

These tests are intentionally skipped unless TEST_DATABASE_URL is set. They
never read DATABASE_URL, do not require Docker/k3s, and do not call FastAPI or
external blockchain APIs.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import asyncpg
import networkx as nx
import pytest
import pytest_asyncio

from app.db import repository as repo
from app.graph.builder import EdgeInfo, GraphResult, NodeInfo
from app.graph.features import OUR_FEATURE_NAMES, extract
from app.scoring.base import ScoreResult


pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"),
    reason="TEST_DATABASE_URL is not set; skipping Postgres integration tests",
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCHEMA_CONFIGMAP = _REPO_ROOT / "k8s" / "postgres" / "initdb-configmap.yaml"
_T0 = 1_700_000_000
_T1 = _T0 + 3_600


def _load_initdb_schema_sql() -> str:
    """Extract the 01_schema.sql literal block without adding a YAML parser."""
    lines = _SCHEMA_CONFIGMAP.read_text(encoding="utf-8").splitlines()
    for idx, line in enumerate(lines):
        if line.strip() == "01_schema.sql: |":
            block = []
            for raw in lines[idx + 1:]:
                if raw and not raw.startswith("    "):
                    break
                block.append(raw[4:] if raw.startswith("    ") else "")
            sql = "\n".join(block).strip()
            if not sql:
                raise AssertionError("01_schema.sql block is empty")
            return sql
    raise AssertionError("01_schema.sql block not found in initdb configmap")


def _jsonb(value):
    return json.loads(value) if isinstance(value, str) else value


def _unique_address(label: str) -> str:
    return f"pg-smoke-{label}-{uuid.uuid4().hex}"


def _minimal_graph(root: str, peer: str) -> GraphResult:
    graph = nx.DiGraph()
    graph.add_node(root, depth=0, is_root=True)
    graph.add_node(peer, depth=1, is_root=False)
    graph.add_edge(
        root,
        peer,
        tx_count=2,
        total_amount=1.25,
        first_seen=_T0,
        last_seen=_T1,
        weight=1.25,
    )
    return GraphResult(
        graph=graph,
        nodes=[
            NodeInfo(address=root, depth=0, is_root=True),
            NodeInfo(address=peer, depth=1, is_root=False),
        ],
        edges=[
            EdgeInfo(
                from_address=root,
                to_address=peer,
                tx_count=2,
                total_amount=1.25,
                first_seen=_T0,
                last_seen=_T1,
            )
        ],
        root_address=root,
        network_code="BTC",
    )


@pytest_asyncio.fixture
async def pg_pool():
    pool = await asyncpg.create_pool(os.environ["TEST_DATABASE_URL"], min_size=1, max_size=2)
    try:
        await pool.execute(_load_initdb_schema_sql())
        yield pool
    finally:
        await pool.close()


async def _insert_processing_request(
    pool: asyncpg.Pool,
    *,
    request_id: str,
    address: str,
    network_code: str = "BTC",
) -> None:
    await pool.execute(
        """
        INSERT INTO analysis_requests (
            id, user_id, address, network_code, depth, limit_tx,
            period_days, status, created_at
        )
        VALUES ($1, NULL, $2, $3, 1, 10, NULL, 'processing', $4)
        """,
        request_id,
        address,
        network_code,
        datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_save_analysis_and_mark_completed_persist_full_chain(pg_pool):
    request_id = str(uuid.uuid4())
    root = _unique_address("root")
    peer = _unique_address("peer")
    graph_result = _minimal_graph(root, peer)
    flagged = {peer: ["suspicious"]}
    features = extract(graph_result, flagged)
    factors = [
        {
            "key": "integration_smoke",
            "label": "Integration Smoke",
            "value": "repository",
            "severity": "MEDIUM",
            "description": "Repository persistence smoke factor.",
        }
    ]
    score_result = ScoreResult(
        score=42.5,
        risk_level="MEDIUM",
        model_version="integration_test_model",
        raw_probability=0.425,
    )

    try:
        await _insert_processing_request(pg_pool, request_id=request_id, address=root)

        result_id = await repo.save_analysis(
            pg_pool,
            request_id=request_id,
            root_address=root,
            network_code="BTC",
            graph_result=graph_result,
            features=features,
            factors=factors,
            score_result=score_result,
            flagged=flagged,
            scoring_method="ml_model",
        )
        await repo.mark_request_completed(pg_pool, request_id, result_id)

        request_row = await pg_pool.fetchrow(
            """
            SELECT status, result_id, completed_at
            FROM analysis_requests
            WHERE id = $1
            """,
            request_id,
        )
        assert request_row["status"] == "completed"
        assert request_row["result_id"] == result_id
        assert request_row["completed_at"] is not None

        result_row = await pg_pool.fetchrow(
            """
            SELECT id, request_id, address, network_code, risk_score, risk_level,
                   model_version, raw_probability, factors_json
            FROM analysis_results
            WHERE request_id = $1
            """,
            request_id,
        )
        assert result_row["id"] == result_id
        assert result_row["request_id"] == request_id
        assert result_row["address"] == root
        assert result_row["network_code"] == "BTC"
        assert result_row["risk_score"] == Decimal("42.50")
        assert result_row["risk_level"] == "MEDIUM"
        assert result_row["model_version"] == "integration_test_model"
        assert result_row["raw_probability"] == pytest.approx(0.425)

        factors_json = _jsonb(result_row["factors_json"])
        assert factors_json["scoring_method"] == "ml_model"
        assert factors_json["model_version"] == "integration_test_model"
        assert factors_json["raw_probability"] == pytest.approx(0.425)
        assert factors_json["factors"] == factors
        assert set(factors_json["features"]) == set(OUR_FEATURE_NAMES)

        network_id = await pg_pool.fetchval("SELECT id FROM networks WHERE code = 'BTC'")
        node_rows = await pg_pool.fetch(
            """
            SELECT address, network_id, depth, is_root, is_flagged, flag_types, tags_json
            FROM address_nodes
            WHERE result_id = $1
            ORDER BY is_root DESC, address
            """,
            result_id,
        )
        assert len(node_rows) == 2
        assert {row["address"] for row in node_rows} == {root, peer}
        assert all(row["network_id"] == network_id for row in node_rows)
        root_node = next(row for row in node_rows if row["address"] == root)
        peer_node = next(row for row in node_rows if row["address"] == peer)
        assert root_node["is_root"] is True
        assert root_node["is_flagged"] is False
        assert peer_node["is_root"] is False
        assert peer_node["is_flagged"] is True
        assert peer_node["flag_types"] == ["suspicious"]
        assert _jsonb(peer_node["tags_json"])["flags"] == ["suspicious"]

        edge_row = await pg_pool.fetchrow(
            """
            SELECT network_id, from_address, to_address, tx_count, amount,
                   first_seen, last_seen
            FROM graph_edges
            WHERE result_id = $1
            """,
            result_id,
        )
        assert edge_row["network_id"] == network_id
        assert edge_row["from_address"] == root
        assert edge_row["to_address"] == peer
        assert edge_row["tx_count"] == 2
        assert edge_row["amount"] == Decimal("1.2500000000")
        assert edge_row["first_seen"] is not None
        assert edge_row["last_seen"] is not None

        features_json = await pg_pool.fetchval(
            "SELECT features_json FROM analysis_features WHERE result_id = $1",
            result_id,
        )
        features_json = _jsonb(features_json)
        assert set(features_json) == set(OUR_FEATURE_NAMES)
        assert len(features_json) == 27
    finally:
        await pg_pool.execute("DELETE FROM analysis_requests WHERE id = $1", request_id)


@pytest.mark.asyncio
async def test_mark_request_failed_persists_failure_without_result(pg_pool):
    request_id = str(uuid.uuid4())
    root = _unique_address("failed-root")
    error_message = "integration failure smoke"

    try:
        await _insert_processing_request(pg_pool, request_id=request_id, address=root)
        await repo.mark_request_failed(pg_pool, request_id, error_message)

        request_row = await pg_pool.fetchrow(
            """
            SELECT status, error_message, completed_at, result_id
            FROM analysis_requests
            WHERE id = $1
            """,
            request_id,
        )
        assert request_row["status"] == "failed"
        assert request_row["error_message"] == error_message
        assert request_row["completed_at"] is not None
        assert request_row["result_id"] is None

        result_count = await pg_pool.fetchval(
            "SELECT count(*) FROM analysis_results WHERE request_id = $1",
            request_id,
        )
        assert result_count == 0
    finally:
        await pg_pool.execute("DELETE FROM analysis_requests WHERE id = $1", request_id)


@pytest.mark.asyncio
async def test_ton_network_row_exists_and_supports_flagged_lookup(pg_pool):
    """
    Regression guard for the TON persistence failure:
      ValueError: Unknown network code 'TON' — cannot persist analysis

    Root cause: live staging DB lacked a 'TON' row in the networks table because
    the initdb ConfigMap only runs on first volume initialization. The seed SQL
    already contains TON; existing DBs need a one-time idempotent INSERT.

    This test verifies that after the fix, TON network_id can be resolved by
    the repository and a flagged-address round-trip works correctly for TON.
    """
    # A valid 48-char TON base64url address (same format as the API smoke address)
    ton_address = "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM98xKb"
    ton_flag_id = str(uuid.uuid4())

    try:
        ids = await pg_pool.fetchrow(
            """
            SELECT
              (SELECT id FROM networks WHERE code = 'TON') AS ton_network_id,
              (SELECT id FROM risk_categories WHERE code = 'suspicious') AS suspicious_category_id
            """
        )
        assert ids["ton_network_id"] is not None, (
            "networks table has no row for code='TON'. "
            "Run: INSERT INTO networks (code, name) VALUES ('TON', 'The Open Network') ON CONFLICT DO NOTHING;"
        )

        await pg_pool.execute(
            """
            INSERT INTO flagged_addresses (
                id, network_id, address, risk_category_id, comment, is_active
            )
            VALUES ($1, $2, $3, $4, $5, true)
            """,
            ton_flag_id,
            ids["ton_network_id"],
            ton_address,
            ids["suspicious_category_id"],
            "TON integration smoke",
        )

        ton_flag = await repo.get_address_flag(pg_pool, ton_address, "TON")
        assert ton_flag is not None, "get_address_flag returned None for flagged TON address"
        assert ton_flag["flag_type"] == "suspicious"
        assert ton_flag["risk_level"] in {"LOW", "MEDIUM", "HIGH"}

        flagged_map = await repo.get_flagged_addresses(pg_pool, [ton_address], "TON")
        assert flagged_map == {ton_address: ["suspicious"]}

        btc_flag = await repo.get_address_flag(pg_pool, ton_address, "BTC")
        assert btc_flag is None, "TON-flagged address must not appear under BTC"

    finally:
        await pg_pool.execute(
            "DELETE FROM flagged_addresses WHERE id = $1", ton_flag_id
        )


@pytest.mark.asyncio
async def test_flagged_address_lookups_are_network_aware(pg_pool):
    address = _unique_address("flagged")
    btc_flag_id = str(uuid.uuid4())
    eth_flag_id = str(uuid.uuid4())

    try:
        ids = await pg_pool.fetchrow(
            """
            SELECT
              (SELECT id FROM networks WHERE code = 'BTC') AS btc_network_id,
              (SELECT id FROM networks WHERE code = 'ETH') AS eth_network_id,
              (SELECT id FROM risk_categories WHERE code = 'scam') AS scam_category_id,
              (SELECT id FROM risk_categories WHERE code = 'gambling') AS gambling_category_id
            """
        )
        await pg_pool.executemany(
            """
            INSERT INTO flagged_addresses (
                id, network_id, address, risk_category_id, comment, is_active
            )
            VALUES ($1, $2, $3, $4, $5, true)
            """,
            [
                (
                    btc_flag_id,
                    ids["btc_network_id"],
                    address,
                    ids["scam_category_id"],
                    "BTC integration smoke",
                ),
                (
                    eth_flag_id,
                    ids["eth_network_id"],
                    address,
                    ids["gambling_category_id"],
                    "ETH integration smoke",
                ),
            ],
        )

        btc_flag = await repo.get_address_flag(pg_pool, address, "BTC")
        eth_flag = await repo.get_address_flag(pg_pool, address, "ETH")

        assert btc_flag["flag_type"] == "scam"
        assert btc_flag["risk_level"] == "HIGH"
        assert eth_flag["flag_type"] == "gambling"
        assert eth_flag["risk_level"] == "MEDIUM"

        assert await repo.get_flagged_addresses(pg_pool, [address], "BTC") == {
            address: ["scam"]
        }
        assert await repo.get_flagged_addresses(pg_pool, [address], "ETH") == {
            address: ["gambling"]
        }
    finally:
        await pg_pool.execute(
            "DELETE FROM flagged_addresses WHERE id = ANY($1::text[])",
            [btc_flag_id, eth_flag_id],
        )
