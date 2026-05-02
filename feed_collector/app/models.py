from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class FeedSourceConfig:
    id: str
    code: str
    name: str
    base_url: str | None
    last_success_at: datetime | None
    config_json: dict | None


@dataclass
class RawFeedRecord:
    address: str | None
    source_chain: str | None
    source_category: str | None
    external_id: str | None = None
    confidence: float | None = None
    trusted: bool | None = None
    checked: bool | None = None
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    raw_payload: dict | None = None


@dataclass
class NormalizedFlaggedAddress:
    address: str
    network_code: str
    risk_category_code: str
    comment: str | None = None
    external_id: str | None = None
    source_chain: str | None = None
    source_category: str | None = None
    confidence: float | None = None
    trusted: bool | None = None
    checked: bool | None = None
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    raw_payload: dict | None = None


@dataclass
class FeedRunResult:
    source_code: str
    fetched_count: int
    normalized_count: int
    skipped_count: int
    errors: list[str] = field(default_factory=list)
    dry_run: bool = True
    fetch_mode: str | None = None
    fetch_since: datetime | None = None
