from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class FeedCollectorSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str | None = None
    dry_run: bool = True
    dummy_initial_limit: int = 10
    enabled_sources: str = "dummy"
    log_level: str = "INFO"

    @model_validator(mode="after")
    def _require_database_url_when_not_dry_run(self) -> "FeedCollectorSettings":
        if not self.dry_run and not self.database_url:
            raise ValueError("DATABASE_URL is required when dry_run=False")
        return self
