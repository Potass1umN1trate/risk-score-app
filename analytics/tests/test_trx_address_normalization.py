"""
Regression tests for TRX address canonicalization.

TRX user input remains base58 T..., while providers may return transaction
endpoints as 41-prefixed hex. Analytics canonicalizes those provider endpoints
to base58 so graph identity, features, and API responses use one address form.
"""

import asyncio
from unittest.mock import AsyncMock, patch

from app.blockchain.base import Transaction
from app.blockchain.tron import TronFetcher
from app.graph.builder import GraphBuilder
from app.graph.features import extract
from app.validators.address import normalize_address_for_network


TRX_BASE58 = "TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy"
TRX_HEX = "4177944d19c052b73ee2286823aa83f8138cb7032f"
TRX_MALFORMED_HEX = "41" + ("z" * 40)
TRX_PEER = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE"

ETH_CHECKSUM = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12"
BNB_CHECKSUM = "0x1234567890AbCdEf1234567890AbCdEf12345678"
BTC_MIXED_CASE = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"

_T0 = 1_700_000_000


def _run(coro):
    return asyncio.run(coro)


def _mock_fetcher(txs):
    mock = AsyncMock()
    mock.fetch = AsyncMock(return_value=txs)
    return mock


def _build_trx_graph_with_hex_root_endpoint():
    tx = Transaction(
        tx_hash="trxhash1",
        from_address=TRX_HEX,
        to_address=TRX_PEER,
        amount=12.5,
        timestamp=_T0,
    )

    async def _build():
        builder = GraphBuilder(max_addresses=20, tx_limit_per_address=10)
        with patch("app.graph.builder.get_fetcher", return_value=_mock_fetcher([tx])):
            return await builder.build(
                root_address=TRX_BASE58,
                network_code="TRX",
                depth=1,
            )

    return _run(_build())


def test_trx_hex_to_base58_conversion():
    assert normalize_address_for_network("TRX", TRX_HEX) == TRX_BASE58


def test_trx_base58_remains_unchanged():
    assert normalize_address_for_network("TRX", f"  {TRX_BASE58}  ") == TRX_BASE58


def test_trx_malformed_hex_does_not_crash():
    assert normalize_address_for_network("TRX", TRX_MALFORMED_HEX) == TRX_MALFORMED_HEX


def test_eth_bnb_normalization_unchanged():
    assert normalize_address_for_network("ETH", ETH_CHECKSUM) == ETH_CHECKSUM.lower()
    assert normalize_address_for_network("BNB", BNB_CHECKSUM) == BNB_CHECKSUM.lower()


def test_btc_or_non_trx_address_not_lowercased():
    assert normalize_address_for_network("BTC", BTC_MIXED_CASE) == BTC_MIXED_CASE


def test_graph_builder_trx_root_connects_to_hex_endpoint():
    result = _build_trx_graph_with_hex_root_endpoint()

    assert result.root_address == TRX_BASE58
    assert all(not node.address.startswith("41") for node in result.nodes)
    assert result.graph.in_degree(TRX_BASE58) + result.graph.out_degree(TRX_BASE58) > 0


def test_trx_features_non_zero_after_hex_endpoint_normalization():
    result = _build_trx_graph_with_hex_root_endpoint()
    features = extract(result, {})

    assert (
        features.tx_in_count > 0
        or features.tx_out_count > 0
        or features.in_degree > 0
        or features.out_degree > 0
        or features.total_received > 0
        or features.total_sent > 0
    )


def test_tron_fetcher_normalizes_and_deduplicates_provider_variants():
    raw_txs = [
        {
            "raw_data": {
                "contract": [{
                    "parameter": {
                        "value": {
                            "owner_address": TRX_HEX,
                            "to_address": TRX_PEER,
                            "amount": 1_000_000,
                        }
                    }
                }]
            },
            "block_timestamp": _T0 * 1000,
            "txID": "same-hash",
        },
        {
            "raw_data": {
                "contract": [{
                    "parameter": {
                        "value": {
                            "owner_address": TRX_BASE58,
                            "to_address": TRX_PEER,
                            "amount": 1_000_000,
                        }
                    }
                }]
            },
            "block_timestamp": _T0 * 1000,
            "txID": "same-hash",
        },
    ]

    txs = TronFetcher()._normalize(raw_txs)

    assert len(txs) == 1
    assert txs[0].from_address == TRX_BASE58
    assert txs[0].to_address == TRX_PEER
