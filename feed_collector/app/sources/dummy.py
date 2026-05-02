from datetime import datetime

from ..models import RawFeedRecord
from ..source_base import FeedSource

_DUMMY_RECORDS: list[RawFeedRecord] = [
    RawFeedRecord(
        address="12QeMLzSrB8XH8FvEzPMVoRxVAzTr5XM2y",
        source_chain="BTC",
        source_category="scam",
        external_id="dummy-001",
        confidence=0.9,
        trusted=True,
        checked=True,
        raw_payload={"source": "dummy", "note": "test BTC record", "chain": "BTC"},
    ),
    RawFeedRecord(
        address="0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        source_chain="ETH",
        source_category="phishing",
        external_id="dummy-002",
        confidence=0.75,
        trusted=False,
        checked=True,
        raw_payload={"source": "dummy", "note": "test ETH record", "chain": "ETH"},
    ),
    RawFeedRecord(
        address="FAKECHAIN_ADDR_001",
        source_chain="FAKECHAIN",
        source_category="scam",
        external_id="dummy-003",
        confidence=0.5,
        raw_payload={"source": "dummy", "note": "unsupported network — should be skipped"},
    ),
]


class DummySource(FeedSource):
    """
    Hardcoded test source used for dry-run pipeline validation.
    Makes no network calls and connects to no external service.
    """

    @property
    def source_code(self) -> str:
        return "dummy"

    async def check_availability(self) -> bool:
        return True

    @property
    def supports_time_filter(self) -> bool:
        return False

    async def fetch_initial(self, limit: int) -> list[RawFeedRecord]:
        return list(_DUMMY_RECORDS[:limit])

    async def fetch_since(self, since: datetime, limit: int) -> list[RawFeedRecord]:
        return []
