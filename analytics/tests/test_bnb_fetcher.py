"""
Unit tests for BNBFetcher (Moralis wallet history endpoint).

No real network, no DB, no Docker, no model artifacts.
All HTTP calls are intercepted via unittest.mock.
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.blockchain.base import BlockchainRateLimitedError, BlockchainUnavailableError
from app.blockchain.bnb import BNBFetcher, _MORALIS_URL


# ── Helpers ────────────────────────────────────────────────────────────────────

_ADDR = "0x4923d960f84d89e72c78daf82015b519aaafe994"

_VALID_TX = {
    "hash": "0xabc123",
    "from_address": "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "to_address": "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "value": "1000000000000000000",  # 1.0 BNB in wei
    "block_timestamp": "2024-01-15T12:00:00.000Z",
}

_MORALIS_RESPONSE = {"result": [_VALID_TX], "cursor": None, "page_size": 100}


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


# ── URL / params / headers ─────────────────────────────────────────────────────

class TestUrlConstruction:

    @pytest.mark.asyncio
    async def test_url_construction_uses_wallet_history_endpoint(self):
        resp = _mock_response(200, _MORALIS_RESPONSE)
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            await BNBFetcher().fetch(_ADDR, limit=10)

        call_args = client.get.call_args
        url = call_args.args[0] if call_args.args else call_args.kwargs.get("url", call_args.args[0])
        assert url == f"{_MORALIS_URL}/wallets/{_ADDR}/history"

    @pytest.mark.asyncio
    async def test_chain_param_is_bsc(self):
        resp = _mock_response(200, _MORALIS_RESPONSE)
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            await BNBFetcher().fetch(_ADDR, limit=10)

        params = client.get.call_args.kwargs["params"]
        assert params["chain"] == "bsc"

    @pytest.mark.asyncio
    async def test_api_key_header_is_passed(self):
        resp = _mock_response(200, _MORALIS_RESPONSE)
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "my-secret-key"

            await BNBFetcher().fetch(_ADDR, limit=10)

        headers = client.get.call_args.kwargs["headers"]
        assert headers["X-API-Key"] == "my-secret-key"


# ── Limit capping ──────────────────────────────────────────────────────────────

class TestLimitCap:

    @pytest.mark.asyncio
    async def test_limit_is_capped_at_100(self):
        resp = _mock_response(200, _MORALIS_RESPONSE)
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            await BNBFetcher().fetch(_ADDR, limit=200)

        params = client.get.call_args.kwargs["params"]
        assert params["limit"] == 100

    @pytest.mark.asyncio
    async def test_limit_below_100_is_preserved(self):
        resp = _mock_response(200, _MORALIS_RESPONSE)
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            await BNBFetcher().fetch(_ADDR, limit=25)

        params = client.get.call_args.kwargs["params"]
        assert params["limit"] == 25


# ── Error mapping ──────────────────────────────────────────────────────────────

class TestErrorMapping:

    @pytest.mark.asyncio
    async def test_429_raises_blockchain_rate_limited(self):
        resp = _mock_response(429, text_body="rate limit exceeded")
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            with pytest.raises(BlockchainRateLimitedError):
                await BNBFetcher().fetch(_ADDR)

    @pytest.mark.asyncio
    async def test_400_raises_blockchain_unavailable(self):
        resp = _mock_response(400, text_body='{"message":"Invalid request"}')
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            with pytest.raises(BlockchainUnavailableError):
                await BNBFetcher().fetch(_ADDR)

    @pytest.mark.asyncio
    async def test_500_raises_blockchain_unavailable(self):
        resp = _mock_response(500, text_body="internal server error")
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            with pytest.raises(BlockchainUnavailableError):
                await BNBFetcher().fetch(_ADDR)

    @pytest.mark.asyncio
    async def test_400_does_not_return_empty_list(self):
        resp = _mock_response(400, text_body="bad request")
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            try:
                result = await BNBFetcher().fetch(_ADDR)
                assert False, f"Expected exception, got {result}"
            except BlockchainUnavailableError:
                pass

    @pytest.mark.asyncio
    async def test_missing_api_key_raises_blockchain_unavailable(self):
        client = _make_client_mock(_mock_response(200, _MORALIS_RESPONSE))

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = ""

            with pytest.raises(BlockchainUnavailableError):
                await BNBFetcher().fetch(_ADDR)

    @pytest.mark.asyncio
    async def test_missing_api_key_does_not_make_http_request(self):
        client = _make_client_mock(_mock_response(200, _MORALIS_RESPONSE))

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client) as mock_cls:
            mock_settings.moralis_api_key = ""

            with pytest.raises(BlockchainUnavailableError):
                await BNBFetcher().fetch(_ADDR)

        mock_cls.assert_not_called()


# ── Logging ────────────────────────────────────────────────────────────────────

class TestLogging:

    @pytest.mark.asyncio
    async def test_4xx_logs_response_body(self, caplog):
        error_body = '{"message":"Invalid chain parameter","code":400}'
        resp = _mock_response(400, text_body=error_body)
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client), \
             caplog.at_level(logging.WARNING, logger="app.blockchain.bnb"):
            mock_settings.moralis_api_key = "test-key"

            with pytest.raises(BlockchainUnavailableError):
                await BNBFetcher().fetch(_ADDR)

        assert any(error_body in r.message for r in caplog.records)


# ── Transaction normalization ──────────────────────────────────────────────────

class TestNormalization:

    @pytest.mark.asyncio
    async def test_normalize_happy_path(self):
        resp = _mock_response(200, {"result": [_VALID_TX]})
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            txs = await BNBFetcher().fetch(_ADDR, limit=10)

        assert len(txs) == 1
        tx = txs[0]
        assert tx.tx_hash == "0xabc123"
        assert tx.from_address == _VALID_TX["from_address"].lower()
        assert tx.to_address == _VALID_TX["to_address"].lower()
        assert abs(tx.amount - 1.0) < 1e-9
        assert tx.timestamp > 0

    @pytest.mark.asyncio
    async def test_normalize_skips_zero_value_transactions(self):
        zero_tx = {**_VALID_TX, "value": "0"}
        resp = _mock_response(200, {"result": [zero_tx]})
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            txs = await BNBFetcher().fetch(_ADDR, limit=10)

        assert txs == []

    @pytest.mark.asyncio
    async def test_normalize_skips_missing_from_address(self):
        bad_tx = {**_VALID_TX, "from_address": ""}
        resp = _mock_response(200, {"result": [bad_tx]})
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            txs = await BNBFetcher().fetch(_ADDR, limit=10)

        assert txs == []

    @pytest.mark.asyncio
    async def test_normalize_skips_missing_to_address(self):
        bad_tx = {**_VALID_TX, "to_address": None}
        resp = _mock_response(200, {"result": [bad_tx]})
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            txs = await BNBFetcher().fetch(_ADDR, limit=10)

        assert txs == []

    @pytest.mark.asyncio
    async def test_normalize_lowercases_addresses(self):
        mixed_tx = {
            **_VALID_TX,
            "from_address": "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "to_address": "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        }
        resp = _mock_response(200, {"result": [mixed_tx]})
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            txs = await BNBFetcher().fetch(_ADDR, limit=10)

        assert txs[0].from_address == mixed_tx["from_address"].lower()
        assert txs[0].to_address == mixed_tx["to_address"].lower()

    @pytest.mark.asyncio
    async def test_normalize_converts_wei_to_bnb(self):
        wei_tx = {**_VALID_TX, "value": "500000000000000000"}  # 0.5 BNB
        resp = _mock_response(200, {"result": [wei_tx]})
        client = _make_client_mock(resp)

        with patch("app.blockchain.bnb.settings") as mock_settings, \
             patch("app.blockchain.bnb.httpx.AsyncClient", return_value=client):
            mock_settings.moralis_api_key = "test-key"

            txs = await BNBFetcher().fetch(_ADDR, limit=10)

        assert abs(txs[0].amount - 0.5) < 1e-9
