"""
Shared pytest fixtures for the analytics-service test suite.

Scope:
- No DB connection, no Docker, no Postgres dependency.
- Provides lightweight synthetic graph objects and a loaded scorer instance
  for use in upcoming unit and API tests.
"""

import networkx as nx
import pytest

from app.graph.builder import EdgeInfo, GraphResult, NodeInfo
from app.graph.features import AddressFeatures


# ── Canonical test addresses ──────────────────────────────────────────────────

ROOT_ADDR = "1RootAddr1111111111111111111111111"
PEER_ADDR = "1PeerAddr1111111111111111111111111"
FLAG_ADDR = "1FlagAddr1111111111111111111111111"

# Unix timestamps anchored to a fixed point so temporal features are stable.
_T0 = 1_700_000_000   # 2023-11-14 22:13:20 UTC
_T1 = _T0 + 86_400    # +1 day
_T2 = _T0 + 172_800   # +2 days


# ── Graph fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture
def minimal_graph_result() -> GraphResult:
    """
    Three-node graph:  PEER → ROOT → FLAG
    - ROOT receives 1.0 from PEER (tx_count=1, t0→t1)
    - ROOT sends 0.5 to FLAG (tx_count=1, t1→t2)
    FLAG is present as a node but flagged status comes from the `flagged` dict,
    not from the graph itself.
    """
    G = nx.DiGraph()
    G.add_node(ROOT_ADDR, depth=0, is_root=True)
    G.add_node(PEER_ADDR, depth=1, is_root=False)
    G.add_node(FLAG_ADDR, depth=1, is_root=False)

    G.add_edge(PEER_ADDR, ROOT_ADDR,
               tx_count=1, total_amount=1.0, first_seen=_T0, last_seen=_T1, weight=1.0)
    G.add_edge(ROOT_ADDR, FLAG_ADDR,
               tx_count=1, total_amount=0.5, first_seen=_T1, last_seen=_T2, weight=0.5)

    nodes = [
        NodeInfo(address=ROOT_ADDR, depth=0, is_root=True),
        NodeInfo(address=PEER_ADDR, depth=1, is_root=False),
        NodeInfo(address=FLAG_ADDR, depth=1, is_root=False),
    ]
    edges = [
        EdgeInfo(from_address=PEER_ADDR, to_address=ROOT_ADDR,
                 tx_count=1, total_amount=1.0, first_seen=_T0, last_seen=_T1),
        EdgeInfo(from_address=ROOT_ADDR, to_address=FLAG_ADDR,
                 tx_count=1, total_amount=0.5, first_seen=_T1, last_seen=_T2),
    ]
    return GraphResult(graph=G, nodes=nodes, edges=edges,
                       root_address=ROOT_ADDR, network_code="BTC")


@pytest.fixture
def empty_graph_result() -> GraphResult:
    """Single root node, no edges — represents an address with zero transactions."""
    G = nx.DiGraph()
    G.add_node(ROOT_ADDR, depth=0, is_root=True)
    nodes = [NodeInfo(address=ROOT_ADDR, depth=0, is_root=True)]
    return GraphResult(graph=G, nodes=nodes, edges=[],
                       root_address=ROOT_ADDR, network_code="BTC")


# ── Flagged-address dicts ─────────────────────────────────────────────────────

@pytest.fixture
def no_flags() -> dict:
    """Empty flagged dict — no addresses are flagged in the DB."""
    return {}


@pytest.fixture
def one_flag_ransomware() -> dict:
    """FLAG_ADDR is flagged as ransomware."""
    return {FLAG_ADDR: ["ransomware"]}


# ── Feature fixtures ──────────────────────────────────────────────────────────

@pytest.fixture
def zero_features() -> AddressFeatures:
    """All-zero feature vector — useful for scorer and validation tests."""
    return AddressFeatures(
        tx_in_count=0, tx_out_count=0,
        total_received=0.0, total_sent=0.0,
        median_tx_amount=0.0, max_tx_amount=0.0,
        unique_counterparties=0,
        depth1_neighbors=0, depth2_neighbors=0,
        in_degree=0, out_degree=0,
        graph_density=0.0, clustering_coefficient=0.0,
        active_days=0, tx_per_day=0.0, lifespan_days=0,
        flagged_neighbors_count=0, flagged_neighbors_ratio=0.0,
        min_dist_to_flagged=999,
        flag_mixer=0, flag_scam=0, flag_sanctions=0, flag_darknet_market=0,
        flag_ransomware=0, flag_gambling=0, flag_phishing=0, flag_suspicious=0,
    )


# ── Scorer fixture ────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def loaded_scorer():
    """
    UniversalXGBoostScorer for BTC, loaded from the real model files on disk.
    Session-scoped to avoid repeated model loads across tests.
    Model artifacts must exist at analytics/models/ (they are in .gitignore;
    generate them with: cd analytics && python -m training.train_btc).
    """
    from app.scoring.xgboost_scorer import UniversalXGBoostScorer
    return UniversalXGBoostScorer("BTC", "models/btc_xgboost.json")
