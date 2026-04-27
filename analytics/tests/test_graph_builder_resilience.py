"""
Unit tests for GraphBuilder multi-depth fetch resilience.

Correct behavior:
- Root address (depth=0) fetch failure → re-raised (fatal, analysis fails).
- Non-root address (depth>0) fetch failure → skipped, warning logged, BFS continues.
- Partial graph from successful branches is returned as a completed GraphResult.

No DB, Docker, blockchain API, or model artifacts required.
"""

import asyncio
import logging
from unittest.mock import AsyncMock, patch

import pytest

from app.blockchain.base import (
    BlockchainRateLimitedError,
    BlockchainUnavailableError,
    Transaction,
)
from app.graph.builder import GraphBuilder


# ── Fixed test addresses ──────────────────────────────────────────────────────

ROOT   = "1RootAddr1111111111111111111111111"
PEER_A = "1PeerAddrAAAAAAAAAAAAAAAAAAAAAAAAA"
PEER_B = "1PeerAddrBBBBBBBBBBBBBBBBBBBBBBBB"
DEEP   = "1DeepAddr111111111111111111111111"

_T0 = 1_700_000_000
_T1 = _T0 + 86_400


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _tx(from_a: str, to_a: str, ts: int = _T0) -> Transaction:
    return Transaction(
        tx_hash=f"hash-{from_a[:6]}-{to_a[:6]}",
        from_address=from_a,
        to_address=to_a,
        amount=1.0,
        timestamp=ts,
    )


def _build_with_fetcher(fetcher_mock, root=ROOT, network="BTC", depth=2):
    builder = GraphBuilder(max_addresses=20, tx_limit_per_address=10)
    with patch("app.graph.builder.get_fetcher", return_value=fetcher_mock):
        return _run(builder.build(root_address=root, network_code=network, depth=depth))


# ── Root fetch failures ───────────────────────────────────────────────────────

class TestRootFetchFailure:

    def test_root_fetch_unavailable_still_raises(self):
        """BlockchainUnavailableError on root fetch propagates out of build()."""
        mock = AsyncMock()
        mock.fetch = AsyncMock(side_effect=BlockchainUnavailableError("provider down"))

        with pytest.raises(BlockchainUnavailableError):
            _build_with_fetcher(mock, depth=2)

    def test_root_fetch_rate_limited_still_raises(self):
        """BlockchainRateLimitedError on root fetch propagates out of build()."""
        mock = AsyncMock()
        mock.fetch = AsyncMock(side_effect=BlockchainRateLimitedError("rate limited"))

        with pytest.raises(BlockchainRateLimitedError):
            _build_with_fetcher(mock, depth=2)


# ── Non-root fetch failures ───────────────────────────────────────────────────

class TestNonRootFetchFailure:

    def test_non_root_fetch_unavailable_is_skipped(self):
        """
        Root fetch succeeds and returns root→PEER_A edge.
        depth=2 fetch for PEER_A raises BlockchainUnavailableError.
        build() must complete without raising.
        Returned graph contains root, PEER_A, and the root-adjacent edge.
        """
        def _side_effect(addr, limit):
            if addr == ROOT:
                return [_tx(ROOT, PEER_A)]
            raise BlockchainUnavailableError(f"provider down for {addr}")

        mock = AsyncMock()
        mock.fetch = AsyncMock(side_effect=_side_effect)

        result = _build_with_fetcher(mock, depth=2)

        addresses = {n.address for n in result.nodes}
        assert ROOT in addresses
        assert PEER_A in addresses
        assert len(result.edges) == 1
        assert result.edges[0].from_address == ROOT
        assert result.edges[0].to_address == PEER_A

    def test_non_root_fetch_rate_limited_is_skipped(self):
        """
        Same as above but BlockchainRateLimitedError — must also be skipped.
        """
        def _side_effect(addr, limit):
            if addr == ROOT:
                return [_tx(ROOT, PEER_A)]
            raise BlockchainRateLimitedError(f"rate limited for {addr}")

        mock = AsyncMock()
        mock.fetch = AsyncMock(side_effect=_side_effect)

        result = _build_with_fetcher(mock, depth=2)

        assert len(result.edges) == 1
        assert result.edges[0].from_address == ROOT

    def test_non_root_unexpected_exception_propagates(self):
        """
        Unexpected exceptions (not BlockchainError) from non-root fetches
        still propagate — they map to INTERNAL_ERROR in the API layer.
        """
        def _side_effect(addr, limit):
            if addr == ROOT:
                return [_tx(ROOT, PEER_A)]
            raise RuntimeError("unexpected internal error")

        mock = AsyncMock()
        mock.fetch = AsyncMock(side_effect=_side_effect)

        with pytest.raises(RuntimeError):
            _build_with_fetcher(mock, depth=2)

    def test_skipped_branch_logs_warning(self, caplog):
        """Warning is emitted with address, depth, and exception info."""
        def _side_effect(addr, limit):
            if addr == ROOT:
                return [_tx(ROOT, PEER_A)]
            raise BlockchainUnavailableError("provider down")

        mock = AsyncMock()
        mock.fetch = AsyncMock(side_effect=_side_effect)

        with caplog.at_level(logging.WARNING, logger="app.graph.builder"):
            _build_with_fetcher(mock, depth=2)

        assert any(
            "Skipping non-root" in r.message and PEER_A in r.message
            for r in caplog.records
        )


# ── Partial graph from mixed success/failure ──────────────────────────────────

class TestPartialGraphAfterMixedFetches:

    def test_other_frontier_addresses_continue_after_one_branch_fails(self):
        """
        Root returns two neighbors: PEER_A and PEER_B.
        PEER_A fetch fails; PEER_B fetch succeeds and returns PEER_B→DEEP edge.
        Completed graph must contain root-adjacent edges AND PEER_B branch edges.
        """
        def _side_effect(addr, limit):
            if addr == ROOT:
                return [_tx(ROOT, PEER_A), _tx(ROOT, PEER_B)]
            if addr == PEER_A:
                raise BlockchainUnavailableError("provider down for PEER_A")
            if addr == PEER_B:
                return [_tx(PEER_B, DEEP)]
            return []

        mock = AsyncMock()
        mock.fetch = AsyncMock(side_effect=_side_effect)

        result = _build_with_fetcher(mock, depth=2)

        edge_pairs = {(e.from_address, e.to_address) for e in result.edges}
        # Root-adjacent edges present
        assert (ROOT, PEER_A) in edge_pairs
        assert (ROOT, PEER_B) in edge_pairs
        # PEER_B's successful branch also present
        assert (PEER_B, DEEP) in edge_pairs
        # PEER_A's branch is absent (it was skipped)
        assert not any(e.from_address == PEER_A for e in result.edges)

    def test_all_non_root_branches_fail_returns_root_only_graph(self):
        """
        Root succeeds; all neighbor fetches fail.
        Result: root + neighbors as nodes, root-adjacent edges present,
        no deeper edges, no exception raised.
        """
        def _side_effect(addr, limit):
            if addr == ROOT:
                return [_tx(ROOT, PEER_A), _tx(ROOT, PEER_B)]
            raise BlockchainUnavailableError(f"down for {addr}")

        mock = AsyncMock()
        mock.fetch = AsyncMock(side_effect=_side_effect)

        result = _build_with_fetcher(mock, depth=2)

        addresses = {n.address for n in result.nodes}
        assert ROOT in addresses
        assert PEER_A in addresses
        assert PEER_B in addresses
        # Root-adjacent edges came from root's own fetch — they are present
        edge_pairs = {(e.from_address, e.to_address) for e in result.edges}
        assert (ROOT, PEER_A) in edge_pairs
        assert (ROOT, PEER_B) in edge_pairs
