"""Application factory and ASGI entry point for the telemetry API."""

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app import database
from backend.app.config import Settings
from backend.app.database import DatabaseError
from backend.app.routes import create_router


class JSONLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps({"level": record.levelname.lower(), "logger": record.name, "message": record.getMessage()})


def configure_logging(log_level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JSONLogFormatter())
    logging.basicConfig(level=log_level, handlers=[handler], force=True)


def create_app(database_path: Path | None = None, settings: Settings | None = None) -> FastAPI:
    active_settings = settings or Settings.from_environment()
    db_path = database_path or active_settings.database_path
    configure_logging(active_settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        try:
            database.initialize_database(db_path)
            app.state.database_ready = True
        except DatabaseError:
            app.state.database_ready = False
            logging.getLogger("embedded_monitoring").exception("database initialization failed")
        app.state.samples_received = 0
        yield

    app = FastAPI(
        title="Embedded Linux Monitoring API",
        description="Validated telemetry ingestion and history for Linux devices.",
        version="1.0.0",
        lifespan=lifespan,
    )
    if active_settings.cors_allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(active_settings.cors_allowed_origins),
            allow_methods=["GET", "POST"],
            allow_headers=["Accept", "Content-Type"],
        )
    app.include_router(create_router(db_path, app))
    return app


app = create_app()