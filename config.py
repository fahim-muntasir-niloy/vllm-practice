from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # extra="ignore" lets .env hold variables that aren't listed here.
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent / ".env", extra="ignore"
    )

    BRAVE_SEARCH_API_KEY: str | None = None


settings = Settings()
