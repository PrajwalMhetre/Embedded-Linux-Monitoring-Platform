from pathlib import Path

from backend.app.config import Settings


def test_settings_read_database_path_logging_and_allowed_origins(monkeypatch, tmp_path):
    database_path = tmp_path / "configured.db"
    monkeypatch.setenv("DATABASE_PATH", str(database_path))
    monkeypatch.setenv("LOG_LEVEL", "debug")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173, https://dashboard.example")

    settings = Settings.from_environment()

    assert settings.database_path == Path(database_path)
    assert settings.log_level == "DEBUG"
    assert settings.cors_allowed_origins == ("http://localhost:5173", "https://dashboard.example")