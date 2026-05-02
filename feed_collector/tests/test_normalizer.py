from datetime import datetime, timezone

from app.models import RawFeedRecord
from app.normalizer import normalize_feed_record


def test_missing_address_is_skipped():
    nfa, reason = normalize_feed_record(
        "dummy",
        RawFeedRecord(address=" ", source_chain="BTC", source_category="scam"),
    )
    assert nfa is None
    assert reason is not None
    assert "missing address" in reason


def test_unsupported_source_chain_is_skipped():
    nfa, reason = normalize_feed_record(
        "dummy",
        RawFeedRecord(
            address="FAKECHAIN_ADDR_001",
            source_chain="FAKECHAIN",
            source_category="scam",
        ),
    )
    assert nfa is None
    assert reason is not None
    assert "unsupported source chain" in reason


def test_eth_address_is_lowercased():
    nfa, reason = normalize_feed_record(
        "dummy",
        RawFeedRecord(
            address=" 0x742d35Cc6634C0532925a3b844Bc454e4438f44e ",
            source_chain="ETH",
            source_category="phishing",
        ),
    )
    assert reason is None
    assert nfa is not None
    assert nfa.address == "0x742d35cc6634c0532925a3b844bc454e4438f44e"
    assert nfa.network_code == "ETH"
    assert nfa.risk_category_code == "phishing"


def test_scamsniffer_expanded_bnb_address_is_lowercased():
    nfa, reason = normalize_feed_record(
        "scamsniffer",
        RawFeedRecord(
            address=" 0x742d35Cc6634C0532925a3b844Bc454e4438f44e ",
            source_chain="EVM_UNSPECIFIED_EXPANDED_BNB",
            source_category="PHISHING",
        ),
    )
    assert reason is None
    assert nfa is not None
    assert nfa.address == "0x742d35cc6634c0532925a3b844bc454e4438f44e"
    assert nfa.network_code == "BNB"
    assert nfa.risk_category_code == "phishing"


def test_source_evidence_fields_are_preserved():
    first_seen = datetime(2026, 1, 1, tzinfo=timezone.utc)
    last_seen = datetime(2026, 1, 2, tzinfo=timezone.utc)
    payload = {"id": "dummy-001", "source": "dummy"}

    nfa, reason = normalize_feed_record(
        "dummy",
        RawFeedRecord(
            address="12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y",
            source_chain="BTC",
            source_category="scam",
            external_id="dummy-001",
            confidence=0.9,
            trusted=True,
            checked=False,
            first_seen=first_seen,
            last_seen=last_seen,
            raw_payload=payload,
        ),
    )
    assert reason is None
    assert nfa is not None
    assert nfa.source_chain == "BTC"
    assert nfa.source_category == "scam"
    assert nfa.external_id == "dummy-001"
    assert nfa.confidence == 0.9
    assert nfa.trusted is True
    assert nfa.checked is False
    assert nfa.first_seen == first_seen
    assert nfa.last_seen == last_seen
    assert nfa.raw_payload == payload
