from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # PostgreSQL — connection to the shared project database
    database_url: str = "postgresql://riskapp:riskapp_secret@postgres:5432/riskscoredb"

    # Analysis limits
    max_addresses_per_analysis: int = 20
    max_depth: int = 5

    # Path to the universal XGBoost model (shared across all networks)
    btc_model_path: str = "models/btc_xgboost.json"

    @property
    def model_path(self) -> str:
        return self.btc_model_path

    # External API keys (optional — fallback to public endpoints if empty)
    etherscan_api_key: str = ""
    trongrid_api_key: str = ""
    tronscan_api_key: str = ""
    helius_api_key: str = ""
    blockfrost_api_key: str = ""
    toncenter_api_key: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
