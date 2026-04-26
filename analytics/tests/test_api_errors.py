"""
API error-contract tests for analytics-service.

These tests keep the surface API-level while patching all external work:
no real Postgres, blockchain providers, model artifacts, Docker, or k8s.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.blockchain.base import (
    BlockchainRateLimitedError,
    BlockchainUnavailableError,
)


_BTC_ADDR = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
_ERROR_KEYS = {"error_code", "detail", "request_id"}


@pytest.fixture
def fake_pool():
    """Async mock pool for startup and the initial analysis_requests INSERT."""
    pool = AsyncMock()
    pool.execute = AsyncMock(return_value=None)
    return pool


@pytest.fixture
def client(fake_pool):
    from main import app

    with patch("main.asyncpg.create_pool", new=AsyncMock(return_value=fake_pool)):
        with TestClient(app) as c:
            app.state.db_pool = fake_pool
            yield c


def _assert_error_shape(resp, status_code, error_code):
    body = resp.json()
    assert resp.status_code == status_code
    assert set(body.keys()) == _ERROR_KEYS
    assert body["error_code"] == error_code
    assert isinstance(body["detail"], str)
    assert body["detail"]
    return body


def test_invalid_request_returns_422_with_null_request_id_and_no_db_insert(client, fake_pool):
    resp = client.post(
        "/api/analyze",
        json={"address": _BTC_ADDR, "network": "BTC", "depth": 999},
    )

    body = _assert_error_shape(resp, 422, "INVALID_REQUEST")
    assert body["request_id"] is None
    fake_pool.execute.assert_not_awaited()


def test_invalid_address_returns_400_with_null_request_id_and_no_db_insert(client, fake_pool):
    resp = client.post(
        "/api/analyze",
        json={"address": "not-a-real-btc-address", "network": "BTC"},
    )

    body = _assert_error_shape(resp, 400, "INVALID_ADDRESS")
    assert body["request_id"] is None
    fake_pool.execute.assert_not_awaited()


def test_unsupported_network_returns_400_with_null_request_id_and_no_db_insert(client, fake_pool):
    resp = client.post(
        "/api/analyze",
        json={"address": "not-a-real-wallet", "network": "NOPE"},
    )

    body = _assert_error_shape(resp, 400, "UNSUPPORTED_NETWORK")
    assert body["request_id"] is None
    fake_pool.execute.assert_not_awaited()


def test_blockchain_rate_limited_returns_429_with_request_id_and_marks_failed(
    client,
    fake_pool,
):
    mark_failed = AsyncMock(return_value=None)
    with patch(
        "app.api.analyze.GraphBuilder.build",
        new=AsyncMock(side_effect=BlockchainRateLimitedError("rate limited")),
    ), patch("app.api.analyze.repo.mark_request_failed", new=mark_failed):
        resp = client.post(
            "/api/analyze",
            json={"address": _BTC_ADDR, "network": "BTC"},
        )

    body = _assert_error_shape(resp, 429, "BLOCKCHAIN_RATE_LIMITED")
    assert body["request_id"]
    fake_pool.execute.assert_awaited_once()
    mark_failed.assert_awaited_once()


def test_blockchain_unavailable_returns_502_with_request_id_and_marks_failed(
    client,
    fake_pool,
):
    mark_failed = AsyncMock(return_value=None)
    with patch(
        "app.api.analyze.GraphBuilder.build",
        new=AsyncMock(side_effect=BlockchainUnavailableError("provider down")),
    ), patch("app.api.analyze.repo.mark_request_failed", new=mark_failed):
        resp = client.post(
            "/api/analyze",
            json={"address": _BTC_ADDR, "network": "BTC"},
        )

    body = _assert_error_shape(resp, 502, "BLOCKCHAIN_UNAVAILABLE")
    assert body["request_id"]
    fake_pool.execute.assert_awaited_once()
    mark_failed.assert_awaited_once()


def test_internal_error_returns_500_hides_detail_and_marks_failed(
    client,
    fake_pool,
    minimal_graph_result,
):
    mark_failed = AsyncMock(return_value=None)
    with patch(
        "app.api.analyze.GraphBuilder.build",
        new=AsyncMock(return_value=minimal_graph_result),
    ), patch(
        "app.api.analyze.repo.get_flagged_addresses",
        new=AsyncMock(side_effect=RuntimeError("sensitive internal detail")),
    ), patch("app.api.analyze.repo.mark_request_failed", new=mark_failed):
        resp = client.post(
            "/api/analyze",
            json={"address": _BTC_ADDR, "network": "BTC"},
        )

    body = _assert_error_shape(resp, 500, "INTERNAL_ERROR")
    assert body["request_id"]
    assert "sensitive internal detail" not in body["detail"]
    fake_pool.execute.assert_awaited_once()
    mark_failed.assert_awaited_once()
