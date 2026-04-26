"""
Unit tests for analytics/app/graph/features.py

Covers:
  - OUR_FEATURE_NAMES / AddressFeatures canonical order and count
  - to_numpy() / to_dict() preserve field order
  - extract() on an empty graph
  - extract() volume group
  - extract() topology group
  - extract() temporal group
  - extract() risk-signal group
"""

import dataclasses

import networkx as nx
import numpy as np
import pytest

from app.graph.builder import EdgeInfo, GraphResult, NodeInfo
from app.graph.features import (
    OUR_FEATURE_NAMES,
    AddressFeatures,
    extract,
)
from tests.conftest import (
    ROOT_ADDR,
    PEER_ADDR,
    FLAG_ADDR,
    _T0,
    _T1,
    _T2,
)

# ── Inline helpers / fixtures needed beyond what conftest provides ─────────────

DEPTH2_ADDR = "1Depth2Addr111111111111111111111111"


def _make_graph_result(
    nodes: list[NodeInfo],
    edges_nx: list[tuple],   # (from, to, attr_dict)
    edges_info: list[EdgeInfo],
    root: str = ROOT_ADDR,
    network: str = "BTC",
) -> GraphResult:
    """Build a GraphResult from explicit node/edge specs."""
    G = nx.DiGraph()
    for n in nodes:
        G.add_node(n.address, depth=n.depth, is_root=n.is_root)
    for from_a, to_a, attrs in edges_nx:
        G.add_edge(from_a, to_a, **attrs)
    return GraphResult(graph=G, nodes=nodes, edges=edges_info,
                       root_address=root, network_code=network)


# ── Group A: canonical order ──────────────────────────────────────────────────

class TestCanonicalOrder:

    def test_feature_count_is_27(self):
        assert len(OUR_FEATURE_NAMES) == 27

    def test_feature_names_match_dataclass_fields(self):
        field_names = [f.name for f in dataclasses.fields(AddressFeatures)]
        assert OUR_FEATURE_NAMES == field_names

    def test_to_numpy_length(self, zero_features):
        arr = zero_features.to_numpy()
        assert arr.shape == (27,)

    def test_to_numpy_preserves_order(self):
        # Build a feature where each field has a unique value = its index
        vals = list(range(27))
        feat = AddressFeatures(*vals)
        arr = feat.to_numpy()
        np.testing.assert_array_equal(arr, np.arange(27, dtype=np.float32))

    def test_to_dict_keys_match_canonical_order(self, zero_features):
        keys = list(zero_features.to_dict().keys())
        assert keys == OUR_FEATURE_NAMES


# ── Group B: empty graph ──────────────────────────────────────────────────────

class TestEmptyGraph:

    def test_volume_all_zero(self, empty_graph_result, no_flags):
        f = extract(empty_graph_result, no_flags)
        assert f.tx_in_count == 0
        assert f.tx_out_count == 0
        assert f.total_received == 0.0
        assert f.total_sent == 0.0
        assert f.median_tx_amount == 0.0
        assert f.max_tx_amount == 0.0
        assert f.unique_counterparties == 0

    def test_topology_all_zero(self, empty_graph_result, no_flags):
        f = extract(empty_graph_result, no_flags)
        assert f.in_degree == 0
        assert f.out_degree == 0
        assert f.depth1_neighbors == 0
        assert f.depth2_neighbors == 0
        assert f.graph_density == 0.0
        assert f.clustering_coefficient == 0.0

    def test_temporal_all_zero(self, empty_graph_result, no_flags):
        f = extract(empty_graph_result, no_flags)
        assert f.active_days == 0
        assert f.tx_per_day == 0.0
        assert f.lifespan_days == 0

    def test_risk_signals_zero_and_default_dist(self, empty_graph_result, no_flags):
        f = extract(empty_graph_result, no_flags)
        assert f.flagged_neighbors_count == 0
        assert f.flagged_neighbors_ratio == 0.0
        assert f.min_dist_to_flagged == 999
        assert f.flag_mixer == 0
        assert f.flag_scam == 0
        assert f.flag_sanctions == 0
        assert f.flag_darknet_market == 0
        assert f.flag_ransomware == 0
        assert f.flag_gambling == 0
        assert f.flag_phishing == 0
        assert f.flag_suspicious == 0


# ── Group C: volume ───────────────────────────────────────────────────────────

class TestVolumeFeatures:

    def test_tx_in_count_sums_edge_tx_counts(self, no_flags):
        """tx_in_count is the sum of tx_count on incoming aggregated edges."""
        nodes = [
            NodeInfo(ROOT_ADDR, depth=0, is_root=True),
            NodeInfo(PEER_ADDR, depth=1, is_root=False),
        ]
        edges_nx = [(PEER_ADDR, ROOT_ADDR,
                     dict(tx_count=3, total_amount=3.0,
                          first_seen=_T0, last_seen=_T1, weight=3.0))]
        edges_info = [EdgeInfo(PEER_ADDR, ROOT_ADDR, 3, 3.0, _T0, _T1)]
        gr = _make_graph_result(nodes, edges_nx, edges_info)
        f = extract(gr, no_flags)
        assert f.tx_in_count == 3   # NOT 1 (one edge object)
        assert f.tx_out_count == 0

    def test_tx_out_count_sums_edge_tx_counts(self, no_flags):
        nodes = [
            NodeInfo(ROOT_ADDR, depth=0, is_root=True),
            NodeInfo(PEER_ADDR, depth=1, is_root=False),
        ]
        edges_nx = [(ROOT_ADDR, PEER_ADDR,
                     dict(tx_count=5, total_amount=5.0,
                          first_seen=_T0, last_seen=_T1, weight=5.0))]
        edges_info = [EdgeInfo(ROOT_ADDR, PEER_ADDR, 5, 5.0, _T0, _T1)]
        gr = _make_graph_result(nodes, edges_nx, edges_info)
        f = extract(gr, no_flags)
        assert f.tx_out_count == 5
        assert f.tx_in_count == 0

    def test_total_received_sums_in_edge_amounts(self, minimal_graph_result, no_flags):
        # minimal_graph_result: PEER→ROOT total_amount=1.0
        f = extract(minimal_graph_result, no_flags)
        assert f.total_received == pytest.approx(1.0)

    def test_total_sent_sums_out_edge_amounts(self, minimal_graph_result, no_flags):
        # minimal_graph_result: ROOT→FLAG total_amount=0.5
        f = extract(minimal_graph_result, no_flags)
        assert f.total_sent == pytest.approx(0.5)

    def test_median_tx_amount_is_per_edge_average(self, no_flags):
        """
        median_tx_amount is the median of per-edge averages (total_amount / tx_count),
        NOT the median of all raw transactions. This locks current behavior explicitly.
        Edge 1 in: 2.0 / 2 = 1.0 avg; Edge 2 out: 3.0 / 3 = 1.0 avg → median = 1.0
        """
        nodes = [
            NodeInfo(ROOT_ADDR, depth=0, is_root=True),
            NodeInfo(PEER_ADDR, depth=1, is_root=False),
            NodeInfo(FLAG_ADDR, depth=1, is_root=False),
        ]
        edges_nx = [
            (PEER_ADDR, ROOT_ADDR,
             dict(tx_count=2, total_amount=2.0, first_seen=_T0, last_seen=_T1, weight=2.0)),
            (ROOT_ADDR, FLAG_ADDR,
             dict(tx_count=3, total_amount=3.0, first_seen=_T1, last_seen=_T2, weight=3.0)),
        ]
        edges_info = [
            EdgeInfo(PEER_ADDR, ROOT_ADDR, 2, 2.0, _T0, _T1),
            EdgeInfo(ROOT_ADDR, FLAG_ADDR, 3, 3.0, _T1, _T2),
        ]
        gr = _make_graph_result(nodes, edges_nx, edges_info)
        f = extract(gr, no_flags)
        assert f.median_tx_amount == pytest.approx(1.0)

    def test_max_tx_amount_is_largest_edge_average(self, no_flags):
        """max_tx_amount is the max per-edge average: max(1.0/1, 0.5/1) = 1.0"""
        nodes = [
            NodeInfo(ROOT_ADDR, depth=0, is_root=True),
            NodeInfo(PEER_ADDR, depth=1, is_root=False),
            NodeInfo(FLAG_ADDR, depth=1, is_root=False),
        ]
        edges_nx = [
            (PEER_ADDR, ROOT_ADDR,
             dict(tx_count=1, total_amount=1.0, first_seen=_T0, last_seen=_T1, weight=1.0)),
            (ROOT_ADDR, FLAG_ADDR,
             dict(tx_count=1, total_amount=0.5, first_seen=_T1, last_seen=_T2, weight=0.5)),
        ]
        edges_info = [
            EdgeInfo(PEER_ADDR, ROOT_ADDR, 1, 1.0, _T0, _T1),
            EdgeInfo(ROOT_ADDR, FLAG_ADDR, 1, 0.5, _T1, _T2),
        ]
        gr = _make_graph_result(nodes, edges_nx, edges_info)
        f = extract(gr, no_flags)
        assert f.max_tx_amount == pytest.approx(1.0)

    def test_unique_counterparties_counts_senders_and_receivers(
            self, minimal_graph_result, no_flags):
        # PEER_ADDR sends to ROOT; ROOT sends to FLAG_ADDR → 2 unique counterparties
        f = extract(minimal_graph_result, no_flags)
        assert f.unique_counterparties == 2


# ── Group D: topology ─────────────────────────────────────────────────────────

class TestTopologyFeatures:

    def test_in_out_degree(self, minimal_graph_result, no_flags):
        f = extract(minimal_graph_result, no_flags)
        assert f.in_degree == 1
        assert f.out_degree == 1

    def test_depth1_neighbors_from_node_list(self, minimal_graph_result, no_flags):
        # minimal_graph_result has PEER and FLAG at depth 1
        f = extract(minimal_graph_result, no_flags)
        assert f.depth1_neighbors == 2

    def test_depth2_neighbors_from_node_list(self, no_flags):
        """depth2_neighbors reads NodeInfo.depth == 2, not graph distance."""
        nodes = [
            NodeInfo(ROOT_ADDR,   depth=0, is_root=True),
            NodeInfo(PEER_ADDR,   depth=1, is_root=False),
            NodeInfo(DEPTH2_ADDR, depth=2, is_root=False),
        ]
        edges_nx = [
            (PEER_ADDR, ROOT_ADDR,
             dict(tx_count=1, total_amount=1.0, first_seen=_T0, last_seen=_T1, weight=1.0)),
            (PEER_ADDR, DEPTH2_ADDR,
             dict(tx_count=1, total_amount=0.1, first_seen=_T0, last_seen=_T1, weight=0.1)),
        ]
        edges_info = [
            EdgeInfo(PEER_ADDR, ROOT_ADDR,   1, 1.0, _T0, _T1),
            EdgeInfo(PEER_ADDR, DEPTH2_ADDR, 1, 0.1, _T0, _T1),
        ]
        gr = _make_graph_result(nodes, edges_nx, edges_info)
        f = extract(gr, no_flags)
        assert f.depth1_neighbors == 1
        assert f.depth2_neighbors == 1

    def test_graph_density_3_nodes_2_edges(self, minimal_graph_result, no_flags):
        # 3 nodes, 2 directed edges → density = 2 / (3 * 2) = 2/6
        f = extract(minimal_graph_result, no_flags)
        assert f.graph_density == pytest.approx(2 / 6)

    def test_graph_density_single_node(self, empty_graph_result, no_flags):
        f = extract(empty_graph_result, no_flags)
        assert f.graph_density == 0.0


# ── Group E: temporal ─────────────────────────────────────────────────────────

class TestTemporalFeatures:

    def test_lifespan_days_minimal_graph(self, minimal_graph_result, no_flags):
        # _T0 and _T2 are 2 days apart; lifespan = max(1, 2) = 2
        f = extract(minimal_graph_result, no_flags)
        assert f.lifespan_days == 2

    def test_lifespan_days_minimum_one_for_same_day(self, no_flags):
        """Same-day timestamps → lifespan_days = 1 (not 0)."""
        nodes = [
            NodeInfo(ROOT_ADDR, depth=0, is_root=True),
            NodeInfo(PEER_ADDR, depth=1, is_root=False),
        ]
        same_day_ts = _T0
        edges_nx = [(PEER_ADDR, ROOT_ADDR,
                     dict(tx_count=1, total_amount=1.0,
                          first_seen=same_day_ts, last_seen=same_day_ts, weight=1.0))]
        edges_info = [EdgeInfo(PEER_ADDR, ROOT_ADDR, 1, 1.0, same_day_ts, same_day_ts)]
        gr = _make_graph_result(nodes, edges_nx, edges_info)
        f = extract(gr, no_flags)
        assert f.lifespan_days == 1

    def test_active_days_from_timestamps(self, minimal_graph_result, no_flags):
        # Edge 1: first_seen=_T0, last_seen=_T1; Edge 2: first_seen=_T1, last_seen=_T2
        # Day buckets: _T0//86400, _T1//86400, _T2//86400 = 3 distinct days
        f = extract(minimal_graph_result, no_flags)
        assert f.active_days == 3

    def test_tx_per_day(self, minimal_graph_result, no_flags):
        # tx_in_count=1, tx_out_count=1 → total=2; lifespan=2 → tx_per_day=1.0
        f = extract(minimal_graph_result, no_flags)
        assert f.tx_per_day == pytest.approx(1.0)

    def test_temporal_zero_when_no_timestamps(self, no_flags):
        """Edges with first_seen=0 and last_seen=0 are skipped (falsy guard)."""
        nodes = [
            NodeInfo(ROOT_ADDR, depth=0, is_root=True),
            NodeInfo(PEER_ADDR, depth=1, is_root=False),
        ]
        edges_nx = [(PEER_ADDR, ROOT_ADDR,
                     dict(tx_count=1, total_amount=1.0,
                          first_seen=0, last_seen=0, weight=1.0))]
        edges_info = [EdgeInfo(PEER_ADDR, ROOT_ADDR, 1, 1.0, 0, 0)]
        gr = _make_graph_result(nodes, edges_nx, edges_info)
        f = extract(gr, no_flags)
        assert f.active_days == 0
        assert f.lifespan_days == 0
        assert f.tx_per_day == 0.0


# ── Group F: risk signals ─────────────────────────────────────────────────────

class TestRiskSignalFeatures:

    def test_no_flags_all_zero_signals(self, minimal_graph_result, no_flags):
        f = extract(minimal_graph_result, no_flags)
        assert f.flagged_neighbors_count == 0
        assert f.flagged_neighbors_ratio == 0.0
        assert f.min_dist_to_flagged == 999
        assert f.flag_ransomware == 0

    def test_flagged_neighbor_count_one(self, minimal_graph_result, one_flag_ransomware):
        f = extract(minimal_graph_result, one_flag_ransomware)
        assert f.flagged_neighbors_count == 1

    def test_flagged_neighbor_ratio(self, minimal_graph_result, one_flag_ransomware):
        # 1 flagged out of 3 nodes
        f = extract(minimal_graph_result, one_flag_ransomware)
        assert f.flagged_neighbors_ratio == pytest.approx(1 / 3)

    def test_min_dist_direct_neighbor(self, minimal_graph_result, one_flag_ransomware):
        # ROOT→FLAG_ADDR is a direct out-edge → distance 1
        f = extract(minimal_graph_result, one_flag_ransomware)
        assert f.min_dist_to_flagged == 1

    def test_flag_category_ransomware_incremented(
            self, minimal_graph_result, one_flag_ransomware):
        f = extract(minimal_graph_result, one_flag_ransomware)
        assert f.flag_ransomware == 1
        assert f.flag_mixer == 0
        assert f.flag_scam == 0
        assert f.flag_sanctions == 0
        assert f.flag_darknet_market == 0
        assert f.flag_gambling == 0
        assert f.flag_phishing == 0
        assert f.flag_suspicious == 0

    def test_flag_type_matching_is_case_insensitive(self, minimal_graph_result):
        flagged = {FLAG_ADDR: ["Ransomware"]}   # capitalised
        f = extract(minimal_graph_result, flagged)
        assert f.flag_ransomware == 1

    def test_flagged_address_not_in_graph_is_ignored(self, minimal_graph_result):
        flagged = {"1UnknownAddr11111111111111111111111": ["scam"]}
        f = extract(minimal_graph_result, flagged)
        assert f.flagged_neighbors_count == 0
        assert f.flag_scam == 0

    def test_multiple_flag_categories_on_same_address(self, minimal_graph_result):
        flagged = {FLAG_ADDR: ["mixer", "scam"]}
        f = extract(minimal_graph_result, flagged)
        assert f.flagged_neighbors_count == 1   # one address, not two
        assert f.flag_mixer == 1
        assert f.flag_scam == 1
