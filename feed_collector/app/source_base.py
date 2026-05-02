from abc import ABC, abstractmethod
from datetime import datetime

from .models import RawFeedRecord


class FeedSource(ABC):
    @property
    @abstractmethod
    def source_code(self) -> str:
        """Machine-readable key matching feed_sources.code."""
        ...

    @abstractmethod
    async def check_availability(self) -> bool:
        """Return True if the source is reachable. Must not raise."""
        ...

    @property
    @abstractmethod
    def supports_time_filter(self) -> bool:
        """True if fetch_since() returns a meaningful incremental result."""
        ...

    @abstractmethod
    async def fetch_initial(self, limit: int) -> list[RawFeedRecord]:
        """Full/bulk load. Called when last_success_at is None."""
        ...

    @abstractmethod
    async def fetch_since(self, since: datetime, limit: int) -> list[RawFeedRecord]:
        """Incremental load — records added after `since`."""
        ...
