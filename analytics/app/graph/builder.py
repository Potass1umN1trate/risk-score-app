"""
BFS-based transaction graph construction for an arbitrary wallet address.

Algorithm:
  1. Start from the root address (depth 0).
  2. For each address at the current depth, fetch its transactions.
  3. Add edges to the DiGraph; enqueue neighbouring addresses.
  4. Repeat up to `depth` hops or until the address limit is reached.

Why NetworkX DiGraph instead of MultiDiGraph?
  Multiple transactions between the same address pair are aggregated
  into a single edge with total weight (total_amount) and count (tx_count).
  This simplifies feature extraction and reduces memory usage.
"""

import asyncio
from dataclasses import dataclass, field
from collections import deque

import networkx as nx

from app.blockchain.registry import get_fetcher
from app.blockchain.base import Transaction, BlockchainError


# ─── Return type definitions ───────────────────────────────────────────────────

@dataclass
class NodeInfo:
    address: str
    depth: int            # BFS hop distance from the root address
    is_root: bool = False


@dataclass
class EdgeInfo:
    from_address: str
    to_address: str
    tx_count: int         # number of transactions between this pair
    total_amount: float   # total value in native currency
    first_seen: int       # earliest unix timestamp
    last_seen: int        # latest unix timestamp


@dataclass
class GraphResult:
    graph: nx.DiGraph
    nodes: list[NodeInfo]
    edges: list[EdgeInfo]
    root_address: str
    network_code: str


# ─── Internal accumulator for per-edge statistics ─────────────────────────────

@dataclass
class _EdgeAccum:
    tx_count: int = 0
    total_amount: float = 0.0
    first_seen: int = 2**62
    last_seen: int = 0

    def update(self, tx: Transaction) -> None:
        self.tx_count += 1
        self.total_amount += tx.amount
        if tx.timestamp and tx.timestamp < self.first_seen:
            self.first_seen = tx.timestamp
        if tx.timestamp and tx.timestamp > self.last_seen:
            self.last_seen = tx.timestamp


# ─── Main graph builder ────────────────────────────────────────────────────────

class GraphBuilder:
    """
    Builds a transaction graph via BFS around a root address.

    Args:
        max_addresses: maximum number of addresses in the graph (nodes + neighbours)
        tx_limit_per_address: max transactions to fetch per address
        concurrency: how many addresses to query in parallel
    """

    def __init__(
        self,
        max_addresses: int = 20,
        tx_limit_per_address: int = 50,
        concurrency: int = 5,
    ) -> None:
        self.max_addresses = max_addresses
        self.tx_limit_per_address = tx_limit_per_address
        self.concurrency = concurrency

    async def build(
        self,
        root_address: str,
        network_code: str,
        depth: int = 2,
        since_ts: int | None = None,
    ) -> GraphResult:
        """
        Build the graph starting from root_address up to the given depth.

        since_ts: if set, transactions with timestamp < since_ts are discarded
                  before being added to the graph (builder-side period filter).

        Returns:
            GraphResult containing the DiGraph, NodeInfo list, and EdgeInfo list.
        """
        fetcher = get_fetcher(network_code)

        G = nx.DiGraph()
        # address → NodeInfo mapping to track already-added nodes
        node_map: dict[str, NodeInfo] = {}
        # accumulated edge statistics: (from, to) → _EdgeAccum
        edge_accum: dict[tuple[str, str], _EdgeAccum] = {}

        # BFS queue: (address, current_depth)
        queue: deque[tuple[str, int]] = deque()
        queue.append((root_address, 0))

        # Add the root address
        root_node = NodeInfo(address=root_address, depth=0, is_root=True)
        node_map[root_address] = root_node
        G.add_node(root_address, depth=0, is_root=True)

        # Addresses whose transactions have already been fetched
        fetched: set[str] = set()

        # Level-by-level BFS
        while queue:
            # Drain all addresses at the current depth into one batch
            current_level: list[tuple[str, int]] = []
            while queue:
                addr, d = queue[0]
                if not current_level or d == current_level[0][1]:
                    current_level.append(queue.popleft())
                else:
                    break  # next depth level — leave in the queue

            current_depth = current_level[0][1]

            # Only fetch addresses we haven't seen yet
            to_fetch = [
                (addr, d) for addr, d in current_level
                if addr not in fetched
            ]

            if not to_fetch:
                continue

            # Parallel fetch with a concurrency semaphore
            sem = asyncio.Semaphore(self.concurrency)

            async def _fetch_one(addr: str) -> tuple[str, list[Transaction]]:
                async with sem:
                    # BlockchainError subclasses propagate to build() caller;
                    # unexpected exceptions are also left to propagate.
                    txs = await fetcher.fetch(addr, limit=self.tx_limit_per_address)
                    return addr, txs

            tasks = [_fetch_one(addr) for addr, _ in to_fetch]
            results: list[tuple[str, list[Transaction]]] = await asyncio.gather(*tasks)

            for addr, txs in results:
                fetched.add(addr)
                addr_depth = node_map[addr].depth

                if since_ts is not None:
                    txs = [tx for tx in txs if tx.timestamp and tx.timestamp >= since_ts]

                for tx in txs:
                    from_a = tx.from_address
                    to_a = tx.to_address

                    # Register unknown addresses as new nodes
                    for new_addr in (from_a, to_a):
                        if new_addr and new_addr not in node_map:
                            if len(node_map) >= self.max_addresses:
                                continue  # address limit reached
                            new_depth = addr_depth + 1
                            node_map[new_addr] = NodeInfo(
                                address=new_addr,
                                depth=new_depth,
                            )
                            G.add_node(new_addr, depth=new_depth, is_root=False)

                            # Enqueue only if depth allows further expansion
                            if new_depth < depth:
                                queue.append((new_addr, new_depth))

                    # Accumulate edge statistics
                    if from_a in node_map and to_a in node_map:
                        key = (from_a, to_a)
                        if key not in edge_accum:
                            edge_accum[key] = _EdgeAccum()
                        edge_accum[key].update(tx)

        # Build DiGraph edges from accumulated statistics
        edges_out: list[EdgeInfo] = []
        for (from_a, to_a), accum in edge_accum.items():
            first = accum.first_seen if accum.first_seen < 2**62 else 0
            G.add_edge(
                from_a,
                to_a,
                tx_count=accum.tx_count,
                total_amount=accum.total_amount,
                first_seen=first,
                last_seen=accum.last_seen,
                weight=accum.total_amount,  # used by NetworkX algorithms
            )
            edges_out.append(EdgeInfo(
                from_address=from_a,
                to_address=to_a,
                tx_count=accum.tx_count,
                total_amount=round(accum.total_amount, 8),
                first_seen=first,
                last_seen=accum.last_seen,
            ))

        return GraphResult(
            graph=G,
            nodes=list(node_map.values()),
            edges=edges_out,
            root_address=root_address,
            network_code=network_code.upper(),
        )
