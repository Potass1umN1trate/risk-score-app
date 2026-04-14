"""
Numerical feature extraction from the transaction graph for the ML model.

All features are floating-point numbers ready to be passed to XGBoost.
Organized into four semantic groups:

  1. Volume        — how many transactions and how much value
  2. Topology      — graph structure and connectivity
  3. Temporal      — activity patterns over time
  4. Risk signals  — whether neighbours are flagged as suspicious

Why these features?
  They cover the three main risk vectors:
    a) Abnormal volume / structuring (smurfing)
    b) Centrality in a money-laundering graph
    c) Proximity to known bad addresses
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import TYPE_CHECKING

import networkx as nx
import numpy as np

if TYPE_CHECKING:
    from app.graph.builder import GraphResult


# Flag categories — must match the `code` values in the risk_categories table
FLAG_CATEGORIES = [
    "mixer",
    "scam",
    "sanctions",
    "darknet_market",
    "ransomware",
    "gambling",
    "phishing",
    "suspicious",
]

# Canonical feature names in the exact order of AddressFeatures fields.
# Used by the XGBoost scorer to build a named DMatrix.
OUR_FEATURE_NAMES = [
    "tx_in_count", "tx_out_count", "total_received", "total_sent",
    "avg_tx_amount", "max_tx_amount", "unique_counterparties",
    "depth1_neighbors", "depth2_neighbors", "in_degree", "out_degree",
    "graph_density", "clustering_coefficient",
    "active_days", "tx_per_day", "lifespan_days",
    "flagged_neighbors_count", "flagged_neighbors_ratio", "min_dist_to_flagged",
    "flag_mixer", "flag_scam", "flag_sanctions", "flag_darknet_market",
    "flag_ransomware", "flag_gambling", "flag_phishing", "flag_suspicious",
]


@dataclass
class AddressFeatures:
    """
    All numerical features for a single address.
    Field order is fixed — XGBoost expects columns in exactly this order
    at inference time.
    """

    # ── Volume ────────────────────────────────────────────────────────────────
    tx_in_count: int            # number of incoming transactions (root address as receiver)
    tx_out_count: int           # number of outgoing transactions
    total_received: float       # total incoming value (native currency)
    total_sent: float           # total outgoing value
    avg_tx_amount: float     # median amount across all transactions
    max_tx_amount: float        # largest single transaction
    unique_counterparties: int  # number of unique counterparty addresses

    # ── Topology ──────────────────────────────────────────────────────────────
    depth1_neighbors: int       # addresses at hop distance 1 from root
    depth2_neighbors: int       # addresses at hop distance 2
    in_degree: int              # in-degree of root in the graph
    out_degree: int             # out-degree of root in the graph
    graph_density: float        # edges / max possible edges
    clustering_coefficient: float  # clustering coefficient of root (undirected)

    # ── Temporal ──────────────────────────────────────────────────────────────
    active_days: int            # number of unique calendar days with transactions
    tx_per_day: float           # average transaction frequency
    lifespan_days: int          # days between first and last transaction

    # ── Risk signals ──────────────────────────────────────────────────────────
    flagged_neighbors_count: int    # number of flagged addresses in the graph
    flagged_neighbors_ratio: float  # fraction of flagged addresses among all nodes
    min_dist_to_flagged: int        # shortest path to nearest flagged node (999 = none)
    # Per-category flag counts (one feature per category):
    flag_mixer: int
    flag_scam: int
    flag_sanctions: int
    flag_darknet_market: int
    flag_ransomware: int
    flag_gambling: int
    flag_phishing: int
    flag_suspicious: int

    def to_numpy(self) -> np.ndarray:
        """Return the feature vector in dataclass field order."""
        return np.array(list(asdict(self).values()), dtype=np.float32)

    def to_dict(self) -> dict:
        return asdict(self)


def extract(
    result: "GraphResult",
    flagged: dict[str, list[str]],  # address → list of flag_types
) -> AddressFeatures:
    """
    Extract features for the root address from an already-built graph.

    Args:
        result:  output of GraphBuilder.build()
        flagged: {address: [flag_type, …]} dict from the database (may be empty)

    Returns:
        AddressFeatures — ready feature vector.
    """
    G = result.graph
    root = result.root_address

    # ── Volume ────────────────────────────────────────────────────────────────
    in_edges = list(G.in_edges(root, data=True))
    out_edges = list(G.out_edges(root, data=True))

    tx_in_count = sum(e["tx_count"] for _, _, e in in_edges)
    tx_out_count = sum(e["tx_count"] for _, _, e in out_edges)
    total_received = sum(e["total_amount"] for _, _, e in in_edges)
    total_sent = sum(e["total_amount"] for _, _, e in out_edges)

    all_amounts = (
        [e["total_amount"] / e["tx_count"] for _, _, e in in_edges if e["tx_count"] > 0]
        + [e["total_amount"] / e["tx_count"] for _, _, e in out_edges if e["tx_count"] > 0]
    )
    avg_tx_amount = float(np.mean(all_amounts)) if all_amounts else 0.0
    max_tx_amount = float(max(all_amounts)) if all_amounts else 0.0

    counterparties = set()
    for u, v, _ in in_edges:
        counterparties.add(u)
    for _, v, _ in out_edges:
        counterparties.add(v)
    unique_counterparties = len(counterparties)

    # ── Topology ──────────────────────────────────────────────────────────────
    nodes_by_depth: dict[int, list[str]] = {}
    for node_info in result.nodes:
        nodes_by_depth.setdefault(node_info.depth, []).append(node_info.address)

    depth1_neighbors = len(nodes_by_depth.get(1, []))
    depth2_neighbors = len(nodes_by_depth.get(2, []))
    in_degree = G.in_degree(root)
    out_degree = G.out_degree(root)

    n_nodes = G.number_of_nodes()
    n_edges = G.number_of_edges()
    max_possible = n_nodes * (n_nodes - 1) if n_nodes > 1 else 1
    graph_density = n_edges / max_possible

    # Clustering coefficient computed on the undirected projection
    UG = G.to_undirected()
    clustering_coefficient = nx.clustering(UG, root) if root in UG else 0.0

    # ── Temporal ──────────────────────────────────────────────────────────────
    all_timestamps: list[int] = []
    for _, _, e in list(G.in_edges(root, data=True)) + list(G.out_edges(root, data=True)):
        if e.get("first_seen"):
            all_timestamps.append(e["first_seen"])
        if e.get("last_seen"):
            all_timestamps.append(e["last_seen"])

    if all_timestamps:
        ts_min = min(all_timestamps)
        ts_max = max(all_timestamps)
        lifespan_days = max(1, (ts_max - ts_min) // 86400)
        # Set of unique calendar dates
        unique_dates = {ts // 86400 for ts in all_timestamps}
        active_days = len(unique_dates)
        total_txs = tx_in_count + tx_out_count
        tx_per_day = total_txs / lifespan_days
    else:
        active_days = 0
        tx_per_day = 0.0
        lifespan_days = 0

    # ── Risk signals ──────────────────────────────────────────────────────────
    all_addresses = {n.address for n in result.nodes}
    flagged_in_graph = {addr for addr in flagged if addr in all_addresses}

    flagged_neighbors_count = len(flagged_in_graph)
    flagged_neighbors_ratio = (
        flagged_neighbors_count / len(all_addresses) if all_addresses else 0.0
    )

    # Shortest path to the nearest flagged address
    min_dist = 999
    if flagged_in_graph:
        for flagged_addr in flagged_in_graph:
            try:
                # Try both directions, take the minimum
                d1 = nx.shortest_path_length(G, root, flagged_addr) if G.has_node(flagged_addr) else 999
            except nx.NetworkXNoPath:
                d1 = 999
            try:
                d2 = nx.shortest_path_length(G, flagged_addr, root) if G.has_node(flagged_addr) else 999
            except nx.NetworkXNoPath:
                d2 = 999
            min_dist = min(min_dist, d1, d2)

    min_dist_to_flagged = min_dist

    # Per-category counts: how many addresses in the graph carry each flag
    flag_counts: dict[str, int] = {cat: 0 for cat in FLAG_CATEGORIES}
    for addr, flag_types in flagged.items():
        if addr in all_addresses:
            for ftype in flag_types:
                key = ftype.lower()
                if key in flag_counts:
                    flag_counts[key] += 1

    return AddressFeatures(
        tx_in_count=tx_in_count,
        tx_out_count=tx_out_count,
        total_received=round(total_received, 8),
        total_sent=round(total_sent, 8),
        avg_tx_amount=round(avg_tx_amount, 8),
        max_tx_amount=round(max_tx_amount, 8),
        unique_counterparties=unique_counterparties,
        depth1_neighbors=depth1_neighbors,
        depth2_neighbors=depth2_neighbors,
        in_degree=in_degree,
        out_degree=out_degree,
        graph_density=round(graph_density, 6),
        clustering_coefficient=round(clustering_coefficient, 6),
        active_days=active_days,
        tx_per_day=round(tx_per_day, 4),
        lifespan_days=lifespan_days,
        flagged_neighbors_count=flagged_neighbors_count,
        flagged_neighbors_ratio=round(flagged_neighbors_ratio, 6),
        min_dist_to_flagged=min_dist_to_flagged,
        flag_mixer=flag_counts["mixer"],
        flag_scam=flag_counts["scam"],
        flag_sanctions=flag_counts["sanctions"],
        flag_darknet_market=flag_counts["darknet_market"],
        flag_ransomware=flag_counts["ransomware"],
        flag_gambling=flag_counts["gambling"],
        flag_phishing=flag_counts["phishing"],
        flag_suspicious=flag_counts["suspicious"],
    )
