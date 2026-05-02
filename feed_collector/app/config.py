from pathlib import Path
from typing import Any

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class FeedCollectorSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    database_url: str | None = None
    dry_run: bool = True
    dummy_initial_limit: int = 10
    enabled_sources: str = "dummy"
    log_level: str = "INFO"
    chainabuse_api_key: str | None = None
    chainabuse_base_url: str = "https://api.chainabuse.com/v0"
    chainabuse_timeout_seconds: float = 10.0
    chainabuse_per_page: int = 50
    chainabuse_initial_max_pages: int = 1
    chainabuse_before: str | None = None
    chainabuse_checked: bool | None = None
    chainabuse_trusted: bool | None = None
    chainabuse_category: str | None = None
    chainabuse_chain: str | None = None
    scamsniffer_address_blacklist_url: str = (
        "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json"
    )
    scamsniffer_timeout_seconds: float = 10.0
    scamsniffer_evm_networks: str = "ETH,BNB"
    ofac_base_url: str = "https://sanctionslistservice.ofac.treas.gov"
    ofac_sdn_filename: str = "SDN_ADVANCED.XML"
    ofac_timeout_seconds: float = 20.0
    ofac_use_alive_check: bool = True

    @field_validator(
        "database_url",
        "chainabuse_api_key",
        "chainabuse_before",
        "chainabuse_checked",
        "chainabuse_trusted",
        "chainabuse_category",
        "chainabuse_chain",
        mode="before",
    )
    @classmethod
    def _blank_optional_env_values_are_unset(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("chainabuse_per_page")
    @classmethod
    def _validate_chainabuse_per_page(cls, value: int) -> int:
        if value < 1 or value > 50:
            raise ValueError("chainabuse_per_page must be between 1 and 50")
        return value

    @field_validator("chainabuse_initial_max_pages")
    @classmethod
    def _validate_chainabuse_initial_max_pages(cls, value: int) -> int:
        if value < 1:
            raise ValueError("chainabuse_initial_max_pages must be >= 1")
        return value

    @model_validator(mode="after")
    def _require_database_url_when_not_dry_run(self) -> "FeedCollectorSettings":
        if not self.dry_run and not self.database_url:
            raise ValueError("DATABASE_URL is required when dry_run=False")
        return self
