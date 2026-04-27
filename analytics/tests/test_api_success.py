"""
API success-path tests for analytics-service.

Strategy:
- Use FastAPI TestClient (synchronous, wraps the ASGI app).
- Patch `asyncpg.create_pool` so the lifespan never touches a real DB.
- Inject a fake pool that satisfies `await pool.execute(...)`.
- Patch `GraphBuilder.build`, `repo.get_flagged_addresses`,
  `repo.get_address_flag`, `repo.save_analysis`, and
  `repo.mark_request_completed` so no blockchain or DB calls are made.
- The real heuristic scorer runs (no model artifacts required).

No Postgres, no blockchain API, no model artifacts required.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.graph.builder import EdgeInfo, GraphResult, NodeInfo
from tests.conftest import (
    ROOT_ADDR,
    PEER_ADDR,
    FLAG_ADDR,
    _T0,
    _T1,
    _T2,
)

# Valid BTC address used in all /api/analyze requests so address validation passes.
_BTC_ADDR = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

# Fixed fake result_id returned by the patched repo.save_analysis.
_FAKE_RESULT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

_SUPPORTED_NETWORKS = ["BTC", "ETH", "TRX", "SOL", "BNB", "XRP", "LTC", "DOGE", "ADA", "TON"]

# root_flag dict returned by repo.get_address_flag for the database path test.
_ROOT_FLAG = {
    "flag_type": "ransomware",
    "category_severity": 75,
    "risk_level": "HIGH",
    "risk_score": 75.0,
}


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def fake_pool():
    """Async mock pool that satisfies `await pool.execute(...)`."""
    pool = AsyncMock()
    pool.execute = AsyncMock(return_value=None)
    return pool


@pytest.fixture
def api_graph_result():
    """
    Synthetic GraphResult for API tests.
    Uses the same addresses as conftest but keyed to _BTC_ADDR as root
    so the response nodes/edges are predictable.
    Reuses conftest timestamps for determinism.
    """
    import networkx as nx

    G = nx.DiGraph()
    G.add_node(_BTC_ADDR, depth=0, is_root=True)
    G.add_node(PEER_ADDR, depth=1, is_root=False)
    G.add_node(FLAG_ADDR, depth=1, is_root=False)
    G.add_edge(PEER_ADDR, _BTC_ADDR,
               tx_count=1, total_amount=1.0, first_seen=_T0, last_seen=_T1, weight=1.0)
    G.add_edge(_BTC_ADDR, FLAG_ADDR,
               tx_count=1, total_amount=0.5, first_seen=_T1, last_seen=_T2, weight=0.5)

    nodes = [
        NodeInfo(address=_BTC_ADDR, depth=0, is_root=True),
        NodeInfo(address=PEER_ADDR, depth=1, is_root=False),
        NodeInfo(address=FLAG_ADDR, depth=1, is_root=False),
    ]
    edges = [
        EdgeInfo(from_address=PEER_ADDR, to_address=_BTC_ADDR,
                 tx_count=1, total_amount=1.0, first_seen=_T0, last_seen=_T1),
        EdgeInfo(from_address=_BTC_ADDR, to_address=FLAG_ADDR,
                 tx_count=1, total_amount=0.5, first_seen=_T1, last_seen=_T2),
    ]
    return GraphResult(graph=G, nodes=nodes, edges=edges,
                       root_address=_BTC_ADDR, network_code="BTC")


@pytest.fixture
def client(fake_pool):
    """
    TestClient wrapping the real FastAPI app with a patched asyncpg.create_pool
    so the lifespan does not attempt a real DB connection.
    The fake pool is attached to app.state.db_pool after startup.
    """
    from main import app

    with patch("main.asyncpg.create_pool", new=AsyncMock(return_value=fake_pool)):
        with TestClient(app) as c:
            # Ensure the injected pool is what the endpoints see.
            app.state.db_pool = fake_pool
            yield c


# ── /health ───────────────────────────────────────────────────────────────────

class TestHealth:

    def test_health_returns_200(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_body(self, client):
        resp = client.get("/health")
        assert resp.json() == {"status": "ok"}


# ── /api/networks ─────────────────────────────────────────────────────────────

class TestNetworks:

    def test_networks_returns_200(self, client):
        resp = client.get("/api/networks")
        assert resp.status_code == 200

    def test_networks_has_networks_key(self, client):
        resp = client.get("/api/networks")
        assert "networks" in resp.json()

    def test_networks_contains_all_supported_codes(self, client):
        networks = resp = client.get("/api/networks").json()["networks"]
        for code in _SUPPORTED_NETWORKS:
            assert code in networks

    def test_networks_returns_exactly_10(self, client):
        networks = client.get("/api/networks").json()["networks"]
        assert len(networks) == 10


# ── /api/model/status ─────────────────────────────────────────────────────────

class TestModelStatus:

    def test_model_status_returns_200(self, client):
        resp = client.get("/api/model/status")
        assert resp.status_code == 200

    def test_model_status_has_models_key(self, client):
        resp = client.get("/api/model/status")
        assert "models" in resp.json()

    def test_model_status_all_values_are_valid(self, client):
        models = client.get("/api/model/status").json()["models"]
        valid = {"loaded", "heuristic_fallback"}
        for code, status in models.items():
            assert status in valid, f"{code}: unexpected status {status!r}"

    def test_model_status_covers_all_networks(self, client):
        models = client.get("/api/model/status").json()["models"]
        for code in _SUPPORTED_NETWORKS:
            assert code in models


# ── /api/analyze — shared helpers ────────────────────────────────────────────

def _analyze_patches(graph_result, flagged_dict, root_flag_dict):
    """Return a context-manager stack of all patches needed for /api/analyze."""
    return [
        patch(
            "app.api.analyze.GraphBuilder.build",
            new=AsyncMock(return_value=graph_result),
        ),
        patch(
            "app.db.repository.get_flagged_addresses",
            new=AsyncMock(return_value=flagged_dict),
        ),
        patch(
            "app.db.repository.get_address_flag",
            new=AsyncMock(return_value=root_flag_dict),
        ),
        patch(
            "app.db.repository.save_analysis",
            new=AsyncMock(return_value=_FAKE_RESULT_ID),
        ),
        patch(
            "app.db.repository.mark_request_completed",
            new=AsyncMock(return_value=None),
        ),
    ]


def _apply_patches(patch_list):
    """Enter a list of patch context managers and return (started_patches, stack)."""
    started = [p.__enter__() for p in patch_list]
    return patch_list, started


def _exit_patches(patch_list):
    for p in patch_list:
        p.__exit__(None, None, None)


# ── /api/analyze — database path ─────────────────────────────────────────────

class TestAnalyzeDatabasePath:
    """Root address is directly flagged → scoring_method == 'database'."""

    @pytest.fixture(autouse=True)
    def _patches(self, api_graph_result):
        patches = _analyze_patches(
            graph_result=api_graph_result,
            flagged_dict={},
            root_flag_dict=_ROOT_FLAG,
        )
        _apply_patches(patches)
        yield
        _exit_patches(patches)

    @pytest.fixture
    def resp(self, client):
        return client.post(
            "/api/analyze",
            json={"address": _BTC_ADDR, "network": "BTC"},
        )

    def test_returns_200(self, resp):
        assert resp.status_code == 200

    def test_scoring_method_is_database(self, resp):
        assert resp.json()["scoring_method"] == "database"

    def test_model_version_is_database_lookup(self, resp):
        assert resp.json()["model_version"] == "database_lookup"

    def test_flag_type_is_set(self, resp):
        assert resp.json()["flag_type"] == "ransomware"

    def test_risk_level_is_valid(self, resp):
        assert resp.json()["risk_level"] in {"LOW", "MEDIUM", "HIGH"}

    def test_risk_score_in_range(self, resp):
        score = resp.json()["risk_score"]
        assert 0.0 <= score <= 100.0

    def test_response_has_request_id(self, resp):
        assert resp.json()["request_id"]

    def test_response_has_result_id(self, resp):
        assert resp.json()["result_id"] == _FAKE_RESULT_ID

    def test_response_has_analyzed_at(self, resp):
        assert resp.json()["analyzed_at"]

    def test_features_empty_on_database_path(self, resp):
        assert resp.json()["features"] == {}

    def test_nodes_present(self, resp):
        assert isinstance(resp.json()["nodes"], list)

    def test_edges_present(self, resp):
        assert isinstance(resp.json()["edges"], list)

    def test_factors_field_exists(self, resp):
        assert "factors" in resp.json()


# ── /api/analyze — ML path ────────────────────────────────────────────────────

class TestAnalyzeMLPath:
    """Root address is not flagged → scoring_method == 'ml_model'."""

    @pytest.fixture(autouse=True)
    def _patches(self, api_graph_result):
        patches = _analyze_patches(
            graph_result=api_graph_result,
            flagged_dict={},
            root_flag_dict=None,
        )
        _apply_patches(patches)
        yield
        _exit_patches(patches)

    @pytest.fixture
    def resp(self, client):
        return client.post(
            "/api/analyze",
            json={"address": _BTC_ADDR, "network": "BTC"},
        )

    def test_returns_200(self, resp):
        assert resp.status_code == 200

    def test_scoring_method_is_ml_model(self, resp):
        assert resp.json()["scoring_method"] == "ml_model"

    def test_flag_type_is_null(self, resp):
        assert resp.json()["flag_type"] is None

    def test_model_version_contains_xgboost(self, resp):
        assert "xgboost" in resp.json()["model_version"]

    def test_features_populated(self, resp):
        features = resp.json()["features"]
        assert isinstance(features, dict)
        assert len(features) == 27

    def test_risk_level_is_valid(self, resp):
        assert resp.json()["risk_level"] in {"LOW", "MEDIUM", "HIGH"}

    def test_risk_score_in_range(self, resp):
        score = resp.json()["risk_score"]
        assert 0.0 <= score <= 100.0

    def test_nodes_count_matches_nodes_list(self, resp):
        body = resp.json()
        assert body["nodes_count"] == len(body["nodes"])

    def test_edges_count_matches_edges_list(self, resp):
        body = resp.json()
        assert body["edges_count"] == len(body["edges"])

    def test_edges_have_first_seen_and_last_seen(self, resp):
        edges = resp.json()["edges"]
        assert len(edges) > 0
        for edge in edges:
            assert "first_seen" in edge
            assert "last_seen" in edge

    def test_factors_field_exists(self, resp):
        assert "factors" in resp.json()

    def test_response_has_request_id(self, resp):
        assert resp.json()["request_id"]

    def test_response_has_result_id(self, resp):
        assert resp.json()["result_id"] == _FAKE_RESULT_ID

    def test_response_has_analyzed_at(self, resp):
        assert resp.json()["analyzed_at"]


# ── /api/analyze — TON success path ──────────────────────────────────────────

# Valid 48-char TON base64url address (accepted by the TON address validator).
_TON_ADDR = "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM98xKb"


class TestAnalyzeTONMLPath:
    """
    Regression guard for TON persistence failure.

    Before the live staging DB fix, TON analysis failed at repo.save_analysis
    with: ValueError: Unknown network code 'TON' — cannot persist analysis
    because the networks table lacked a 'TON' row.

    This test exercises the full /api/analyze path for TON using the same
    mock strategy as TestAnalyzeMLPath.  All DB and blockchain calls are
    patched; no Postgres, blockchain API, or model artifact is required.
    """

    @pytest.fixture(autouse=True)
    def _patches(self, api_graph_result):
        patches = _analyze_patches(
            graph_result=api_graph_result,
            flagged_dict={},
            root_flag_dict=None,
        )
        _apply_patches(patches)
        yield
        _exit_patches(patches)

    @pytest.fixture
    def resp(self, client):
        return client.post(
            "/api/analyze",
            json={"address": _TON_ADDR, "network": "TON"},
        )

    def test_returns_200(self, resp):
        assert resp.status_code == 200

    def test_network_is_ton(self, resp):
        assert resp.json()["network"] == "TON"

    def test_scoring_method_is_ml_model(self, resp):
        assert resp.json()["scoring_method"] == "ml_model"

    def test_risk_level_is_valid(self, resp):
        assert resp.json()["risk_level"] in {"LOW", "MEDIUM", "HIGH"}

    def test_risk_score_in_range(self, resp):
        score = resp.json()["risk_score"]
        assert 0.0 <= score <= 100.0

    def test_response_has_request_id(self, resp):
        assert resp.json()["request_id"]

    def test_response_has_result_id(self, resp):
        assert resp.json()["result_id"] == _FAKE_RESULT_ID

    def test_features_populated(self, resp):
        features = resp.json()["features"]
        assert isinstance(features, dict)
        assert len(features) == 27

    def test_flag_type_is_null(self, resp):
        assert resp.json()["flag_type"] is None

    def test_factors_field_exists(self, resp):
        assert "factors" in resp.json()
