"""Environment-backed settings for the telemetry API."""

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    database_path: Path = Path("data/telemetry.db")
    log_level: str = "INFO"
    cors_allowed_origins: tuple[str, ...] = ()

    @classmethod
    def from_environment(cls) -> "Settings":
        database_path = Path(os.getenv("DATABASE_PATH", "data/telemetry.db"))
        log_level = os.getenv("LOG_LEVEL", "INFO").upper()
        origins = tuple(
            origin.strip()
            for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
            if origin.strip()
        )
        return cls(database_path=database_path, log_level=log_level, cors_allowed_origins=origins)