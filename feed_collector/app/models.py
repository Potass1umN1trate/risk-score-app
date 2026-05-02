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
    address: str
    network_code: str
    risk_category_code: str
    external_id: str | None = None
    source_category: str | None = None
    confidence: float | None = None
    raw_payload: dict | None = None


@dataclass
class NormalizedFlaggedAddress:
    address: str
    network_code: str
    risk_category_code: str
    comment: str | None = None
    external_id: str | None = None
    source_category: str | None = None
    confidence: float | None = None
    raw_payload: dict | None = None


@dataclass
class FeedRunResult:
    source_code: str
    fetched_count: int
    normalized_count: int
    skipped_count: int
    errors: list[str] = field(default_factory=list)
    dry_run: bool = True
