"""
Unit tests for EVM address normalization in GraphBuilder and the
normalize_address_for_network helper.

Uses a synthetic async fetcher — no blockchain API, no DB, no model artifacts.

Coverage:
  A. normalize_address_for_network helper
  B. GraphBuilder: ETH checksum root is stored lowercase in GraphResult
  C. GraphBuilder: normalized root connects to lowercase transaction endpoints
  D. GraphBuilder: BNB follows same EVM rules
  E. GraphBuilder: BTC root casing is preserved unchanged
  F. Feature regression: EVM graph with normalized addresses produces non-zero
     root volume/topology features
"""

import asyncio
from unittest.mock import AsyncMock, patch

import networkx as nx
import pytest

from app.graph.builder import EdgeInfo, GraphBuilder, GraphResult, NodeInfo
from app.graph.features import extract
from app.validators.address import normalize_address_for_network

# ── EVM test addresses ────────────────────────────────────────────────────────
# Checksum form (EIP-55 mixed case) — exactly as a user might submit.
ETH_CHECKSUM = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12"
ETH_LOWER    = ETH_CHECKSUM.lower()

BNB_CHECKSUM = "0x1234567890AbCdEf1234567890AbCdEf12345678"
BNB_LOWER    = BNB_CHECKSUM.lower()

ETH_PEER     = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

BTC_ADDR     = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

_T0 = 1_700_000_000
_T1 = _T0 + 86_400


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _mock_fetcher(txs):
    """Return an AsyncMock whose fetch() returns the given Transaction list."""
    mock = AsyncMock()
    mock.fetch = AsyncMock(return_value=txs)
    return mock


# ── Group A: normalize_address_for_network ────────────────────────────────────

class TestNormalizeAddressForNetwork:

    def test_eth_checksum_lowercased(self):
        assert normalize_address_for_network("ETH", ETH_CHECKSUM) == ETH_LOWER

    def test_eth_already_lower_unchanged(self):
        assert normalize_address_for_network("ETH", ETH_LOWER) == ETH_LOWER

    def test_bnb_checksum_lowercased(self):
        assert normalize_address_for_network("BNB", BNB_CHECKSUM) == BNB_LOWER

    def test_btc_unchanged(self):
        assert normalize_address_for_network("BTC", BTC_ADDR) == BTC_ADDR

    def test_trx_unchanged(self):
        addr = "TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy"
        assert normalize_address_for_network("TRX", addr) == addr

    def test_strips_whitespace_all_networks(self):
        assert normalize_address_for_network("BTC", "  " + BTC_ADDR + "  ") == BTC_ADDR
        assert normalize_address_for_network("ETH", "  " + ETH_CHECKSUM + "  ") == ETH_LOWER

    def test_network_code_case_insensitive(self):
        assert normalize_address_for_network("eth", ETH_CHECKSUM) == ETH_LOWER
        assert normalize_address_for_network("Bnb", BNB_CHECKSUM) == BNB_LOWER


# ── Group B: ETH root stored lowercase in GraphResult ────────────────────────

class TestETHRootNormalization:

    def test_root_address_lowercased_in_graph_result(self):
        """GraphResult.root_address is lowercase even when submitted as checksum."""
        from app.blockchain.base import Transaction

        tx = Transaction(
            tx_hash="0xhash1",
            from_address=ETH_LOWER,
            to_address=ETH_PEER,
            amount=1.0,
            timestamp=_T0,
        )

        async def _build():
            builder = GraphBuilder(max_addresses=20, tx_limit_per_address=10)
            with patch("app.graph.builder.get_fetcher", return_value=_mock_fetcher([tx])):
                return await builder.build(
                    root_address=ETH_CHECKSUM,
                    network_code="ETH",
                    depth=1,
                )

        result = _run(_build())
        assert result.root_address == ETH_LOWER

    def test_root_node_info_carries_lowercase_address(self):
        """The NodeInfo with is_root=True has the lowercase address."""
        from app.blockchain.base import Transaction

        tx = Transaction(
            tx_hash="0xhash2",
            from_address=ETH_LOWER,
            to_address=ETH_PEER,
            amount=1.0,
            timestamp=_T0,
        )

        async def _build():
            builder = GraphBuilder(max_addresses=20, tx_limit_per_address=10)
            with patch("app.graph.builder.get_fetcher", return_value=_mock_fetcher([tx])):
                return await builder.build(
                    root_address=ETH_CHECKSUM,
                    network_code="ETH",
                    depth=1,
                )

        result = _run(_build())
        root_nodes = [n for n in result.nodes if n.is_root]
        assert len(root_nodes) == 1
        assert root_nodes[0].address == ETH_LOWER


# ── Group C: ETH root connects to lowercase transaction endpoints ─────────────

class TestETHRootConnected:

    def test_outgoing_edge_captured_when_root_submitted_as_checksum(self):
        """
        Before the fix the edge was silently dropped because ETH_CHECKSUM !=
        ETH_LOWER in the node_map key lookup.  After normalization it connects.
        """
        from app.blockchain.base import Transaction

        tx = Transaction(
            tx_hash="0xhash3",
            from_address=ETH_LOWER,
            to_address=ETH_PEER,
            amount=2.5,
            timestamp=_T0,
        )

        async def _build():
            builder = GraphBuilder(max_addresses=20, tx_limit_per_address=10)
            with patch("app.graph.builder.get_fetcher", return_value=_mock_fetcher([tx])):
                return await builder.build(
                    root_address=ETH_CHECKSUM,
                    network_code="ETH",
                    depth=1,
                )

        result = _run(_build())
        assert len(result.edges) == 1
        edge = result.edges[0]
        assert edge.from_address == ETH_LOWER
        assert edge.to_address == ETH_PEER

    def test_incoming_edge_captured_when_root_submitted_as_checksum(self):
        from app.blockchain.base import Transaction

        tx = Transaction(
            tx_hash="0xhash4",
            from_address=ETH_PEER,
            to_address=ETH_LOWER,
            amount=1.0,
            timestamp=_T0,
        )

        async def _build():
            builder = GraphBuilder(max_addresses=20, tx_limit_per_address=10)
            with patch("app.graph.builder.get_fetcher", return_value=_mock_fetcher([tx])):
                return await builder.build(
                    root_address=ETH_CHECKSUM,
                    network_code="ETH",
                    depth=1,
                )

        result = _run(_build())
        assert len(result.edges) == 1
        assert result.edges[0].from_address == ETH_PEER
        assert result.edges[0].to_address == ETH_LOWER

    def test_networkx_digraph_has_edge_so_degree_is_nonzero(self):
        """The NetworkX DiGraph edge exists, so out_degree > 0 on the root."""
        from app.blockchain.base import Transaction

        tx = Transaction(
            tx_hash="0xhash5",
            from_address=ETH_LOWER,
            to_address=ETH_PEER,
            amount=1.0,
            timestamp=_T0,
        )

        async def _build():
            builder = GraphBuilder(max_addresses=20, tx_limit_per_address=10)
            with patch("app.graph.builder.get_fetcher", return_value=_mock_fetcher([tx])):
                return await builder.build(
                    root_address=ETH_CHECKSUM,
                    network_code="ETH",
                    depth=1,
                )

        result = _run(_build())
        G = result.graph
        assert G.out_degree(ETH_LOWER) == 1
        assert G.in_degree(ETH_LOWER) == 0


# ── Group D: BNB follows same EVM rules ──────────────────────────────────────

class TestBNBRootNormalization:

    def test_bnb_checksum_root_stored_lowercase_with_edge(self):
        from app.blockchain.base import Transaction

        peer = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        tx = Transaction(
            tx_hash="0xhashbnb",
            from_address=BNB_LOWER,
            to_address=peer,
            amount=0.5,
            timestamp=_T0,
        )

        async def _build():
            builder = GraphBuilder(max_addresses=20, tx_limit_per_address=10)
            with patch("app.graph.builder.get_fetcher", return_value=_mock_fetcher([tx])):
                return await builder.build(
                    root_address=BNB_CHECKSUM,
                    network_code="BNB",
                    depth=1,
                )

        result = _run(_build())
        assert result.root_address == BNB_LOWER
        assert len(result.edges) == 1
        assert result.edges[0].from_address == BNB_LOWER


# ── Group E: BTC root preserved unchanged ────────────────────────────────────

class TestBTCRootPreserved:

    def test_btc_root_not_lowercased(self):
        from app.blockchain.base import Transaction

        peer = "1PeerAddr1111111111111111111111111"
        tx = Transaction(
            tx_hash="btchash1",
            from_address=BTC_ADDR,
            to_address=peer,
            amount=0.1,
            timestamp=_T0,
        )

        async def _build():
            builder = GraphBuilder(max_addresses=20, tx_limit_per_address=10)
            with patch("app.graph.builder.get_fetcher", return_value=_mock_fetcher([tx])):
                return await builder.build(
                    root_address=BTC_ADDR,
                    network_code="BTC",
                    depth=1,
                )

        result = _run(_build())
        assert result.root_address == BTC_ADDR


# ── Group F: feature regression ──────────────────────────────────────────────

class TestEVMFeatureRegression:

    def test_normalized_evm_graph_has_nonzero_root_features(self):
        """
        With root and edges using the same lowercase address, extract() must
        return non-zero volume and topology features for the root.
        """
        G = nx.DiGraph()
        G.add_node(ETH_LOWER, depth=0, is_root=True)
        G.add_node(ETH_PEER, depth=1, is_root=False)
        G.add_edge(ETH_LOWER, ETH_PEER,
                   tx_count=2, total_amount=1.5,
                   first_seen=_T0, last_seen=_T1, weight=1.5)

        nodes = [
            NodeInfo(address=ETH_LOWER, depth=0, is_root=True),
            NodeInfo(address=ETH_PEER, depth=1, is_root=False),
        ]
        edges = [
            EdgeInfo(from_address=ETH_LOWER, to_address=ETH_PEER,
                     tx_count=2, total_amount=1.5, first_seen=_T0, last_seen=_T1),
        ]
        result = GraphResult(graph=G, nodes=nodes, edges=edges,
                             root_address=ETH_LOWER, network_code="ETH")

        f = extract(result, {})

        assert f.tx_out_count > 0
        assert f.total_sent > 0
        assert f.out_degree > 0

    def test_mismatched_case_produces_zero_root_features(self):
        """
        Control / regression anchor: if root is checksum but edge uses lowercase,
        the root is disconnected and all volume features are zero.
        This documents the exact broken state normalization fixes.
        """
        G = nx.DiGraph()
        G.add_node(ETH_CHECKSUM, depth=0, is_root=True)   # checksum root
        G.add_node(ETH_PEER, depth=1, is_root=False)
        # Edge references lowercase root — mismatches checksum key
        G.add_edge(ETH_LOWER, ETH_PEER,
                   tx_count=2, total_amount=1.5,
                   first_seen=_T0, last_seen=_T1, weight=1.5)

        nodes = [
            NodeInfo(address=ETH_CHECKSUM, depth=0, is_root=True),
            NodeInfo(address=ETH_PEER, depth=1, is_root=False),
        ]
        edges = [
            EdgeInfo(from_address=ETH_LOWER, to_address=ETH_PEER,
                     tx_count=2, total_amount=1.5, first_seen=_T0, last_seen=_T1),
        ]
        result = GraphResult(graph=G, nodes=nodes, edges=edges,
                             root_address=ETH_CHECKSUM, network_code="ETH")

        f = extract(result, {})

        assert f.tx_out_count == 0
        assert f.tx_in_count == 0
        assert f.out_degree == 0
        assert f.in_degree == 0
