from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # PostgreSQL — connection to the shared project database
    database_url: str = "postgresql://riskapp:riskapp_secret@postgres:5432/riskscoredb"

    # Analysis limits
    max_addresses_per_analysis: int = 20
    max_depth: int = 5

    # Path to the trained XGBoost model
    btc_model_path: str = "models/btc_xgboost.json"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
