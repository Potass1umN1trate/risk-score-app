"""
Unit tests for DogecoinFetcher BlockCypher request behavior.

No real network, DB, Docker, or model artifacts.
All HTTP calls are intercepted via unittest.mock.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.blockchain.base import BlockchainRateLimitedError, BlockchainUnavailableError
from app.blockchain.dogecoin import DogecoinFetcher, _BLOCKCYPHER_URL
from app.blockchain import dogecoin


_ADDR = "DDTtqnuZ5kfRT5qh2c7sNtqrJmV3iXYdGG"

_VALID_TX = {
    "hash": "doge-tx-abc123",
    "confirmed": "2024-01-15T12:00:00Z",
    "inputs": [
        {
            "addresses": ["DSourceAddress111111111111111111111"],
        }
    ],
    "outputs": [
        {
            "addresses": [_ADDR],
            "value": 125000000,
        }
    ],
}


def _mock_response(status_code: int, json_body=None, text_body: str = "") -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.is_success = 200 <= status_code < 300
    resp.text = text_body or (str(json_body) if json_body else "")
    resp.json = MagicMock(return_value=json_body or {})
    resp.raise_for_status = MagicMock(
        side_effect=None if resp.is_success else Exception(f"HTTP {status_code}")
    )
    return resp


def _make_client_mock(resp: MagicMock) -> MagicMock:
    client = AsyncMock()
    client.get = AsyncMock(return_value=resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


@pytest.mark.asyncio
async def test_doge_request_without_token(monkeypatch):
    resp = _mock_response(200, {"txs": []})
    client = _make_client_mock(resp)
    monkeypatch.setattr(dogecoin.settings, "blockcypher_api_token", "")

    with patch("app.blockchain.dogecoin.httpx.AsyncClient", return_value=client):
        await DogecoinFetcher().fetch(_ADDR, limit=10)

    assert client.get.call_args.args[0] == f"{_BLOCKCYPHER_URL}/{_ADDR}/full"
    params = client.get.call_args.kwargs["params"]
    assert params["limit"] == 10
    assert "token" not in params


@pytest.mark.asyncio
async def test_doge_request_with_token(monkeypatch):
    resp = _mock_response(200, {"txs": []})
    client = _make_client_mock(resp)
    monkeypatch.setattr(dogecoin.settings, "blockcypher_api_token", "fake-token")

    with patch("app.blockchain.dogecoin.httpx.AsyncClient", return_value=client):
        await DogecoinFetcher().fetch(_ADDR, limit=10)

    params = client.get.call_args.kwargs["params"]
    assert params["limit"] == 10
    assert params["token"] == "fake-token"


@pytest.mark.asyncio
async def test_doge_limit_is_capped_at_50(monkeypatch):
    resp = _mock_response(200, {"txs": []})
    client = _make_client_mock(resp)
    monkeypatch.setattr(dogecoin.settings, "blockcypher_api_token", "")

    with patch("app.blockchain.dogecoin.httpx.AsyncClient", return_value=client):
        await DogecoinFetcher().fetch(_ADDR, limit=200)

    params = client.get.call_args.kwargs["params"]
    assert params["limit"] == 50


@pytest.mark.asyncio
async def test_doge_429_raises_blockchain_rate_limited(monkeypatch):
    resp = _mock_response(429, text_body="rate limit exceeded")
    client = _make_client_mock(resp)
    monkeypatch.setattr(dogecoin.settings, "blockcypher_api_token", "")

    with patch("app.blockchain.dogecoin.httpx.AsyncClient", return_value=client):
        with pytest.raises(BlockchainRateLimitedError):
            await DogecoinFetcher().fetch(_ADDR)


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", [400, 500])
async def test_doge_400_or_5xx_raises_blockchain_unavailable(monkeypatch, status_code):
    resp = _mock_response(status_code, text_body="provider error")
    client = _make_client_mock(resp)
    monkeypatch.setattr(dogecoin.settings, "blockcypher_api_token", "")

    with patch("app.blockchain.dogecoin.httpx.AsyncClient", return_value=client):
        with pytest.raises(BlockchainUnavailableError):
            await DogecoinFetcher().fetch(_ADDR)


@pytest.mark.asyncio
async def test_doge_success_normalizes_transactions(monkeypatch):
    resp = _mock_response(200, {"txs": [_VALID_TX]})
    client = _make_client_mock(resp)
    monkeypatch.setattr(dogecoin.settings, "blockcypher_api_token", "")

    with patch("app.blockchain.dogecoin.httpx.AsyncClient", return_value=client):
        txs = await DogecoinFetcher().fetch(_ADDR, limit=10)

    assert len(txs) == 1
    tx = txs[0]
    assert tx.tx_hash == "doge-tx-abc123"
    assert tx.from_address == "DSourceAddress111111111111111111111"
    assert tx.to_address == _ADDR
    assert tx.amount == 1.25
    assert tx.timestamp == 1_705_320_000


@pytest.mark.asyncio
async def test_doge_empty_success_returns_empty_list(monkeypatch):
    resp = _mock_response(200, {"txs": []})
    client = _make_client_mock(resp)
    monkeypatch.setattr(dogecoin.settings, "blockcypher_api_token", "")

    with patch("app.blockchain.dogecoin.httpx.AsyncClient", return_value=client):
        txs = await DogecoinFetcher().fetch(_ADDR, limit=10)

    assert txs == []
