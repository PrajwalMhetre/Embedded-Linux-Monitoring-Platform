"""HTTP API for ingesting and reading embedded Linux telemetry."""

import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware

from backend.app import database
from backend.app.database import DatabaseError
from backend.app.schemas import HealthResponse, TelemetryPayload

LOGGER = logging.getLogger("embedded_monitoring")


class JSONLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps({"level": record.levelname.lower(), "logger": record.name, "message": record.getMessage()})


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JSONLogFormatter())
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(), handlers=[handler], force=True)


def create_app(database_path: Path | None = None) -> FastAPI:
    configure_logging()
    db_path = database_path or Path(os.getenv("DATABASE_PATH", "data/telemetry.db"))

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        try:
            database.initialize_database(db_path)
            app.state.database_ready = True
        except DatabaseError:
            app.state.database_ready = False
            LOGGER.exception("database initialization failed")
        app.state.samples_received = 0
        yield

    app = FastAPI(
        title="Embedded Linux Monitoring API",
        description="Validated telemetry ingestion and history for Linux devices.",
        version="1.0.0",
        lifespan=lifespan,
    )
    allowed_origins = [origin.strip() for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if origin.strip()]
    if allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_methods=["GET", "POST"],
            allow_headers=["Accept", "Content-Type"],
        )

    @app.get("/health", response_model=HealthResponse, tags=["operations"])
    def health() -> HealthResponse:
        try:
            database.check_database(db_path)
        except DatabaseError as error:
            app.state.database_ready = False
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="database unavailable") from error
        app.state.database_ready = True
        return HealthResponse(status="ok", database="ok")

    @app.get("/metrics", tags=["operations"], response_class=Response)
    def prometheus_metrics() -> Response:
        try:
            total = database.count_telemetry(db_path)
            latest = database.get_latest(db_path)
        except DatabaseError as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="database unavailable") from error
        lines = [
            "# HELP embedded_monitoring_samples_received_total Total telemetry samples accepted by this process.",
            "# TYPE embedded_monitoring_samples_received_total counter",
            f"embedded_monitoring_samples_received_total {app.state.samples_received}",
            "# HELP embedded_monitoring_samples_stored Number of samples stored in SQLite.",
            "# TYPE embedded_monitoring_samples_stored gauge",
            f"embedded_monitoring_samples_stored {total}",
        ]
        for name in ("cpu_percent", "memory_percent", "disk_root_percent"):
            value = getattr(latest, name) if latest else None
            if value is not None:
                lines.extend((f"# TYPE embedded_monitoring_{name} gauge", f"embedded_monitoring_{name} {value}"))
        return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4; charset=utf-8")

    @app.post("/api/v1/metrics", response_model=TelemetryPayload, status_code=status.HTTP_201_CREATED, tags=["telemetry"])
    def ingest(payload: TelemetryPayload) -> TelemetryPayload:
        try:
            database.insert_telemetry(db_path, payload)
        except DatabaseError as error:
            LOGGER.exception("telemetry persistence failed")
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="telemetry storage unavailable") from error
        app.state.samples_received += 1
        LOGGER.info("telemetry accepted for host %s", payload.hostname)
        return payload

    @app.get("/api/v1/metrics/latest", response_model=TelemetryPayload, tags=["telemetry"])
    def latest() -> TelemetryPayload:
        try:
            payload = database.get_latest(db_path)
        except DatabaseError as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="telemetry storage unavailable") from error
        if payload is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no telemetry has been recorded")
        return payload

    @app.get("/api/v1/metrics/history", response_model=list[TelemetryPayload], tags=["telemetry"])
    def history(limit: int = Query(default=60, ge=1, le=1000)) -> list[TelemetryPayload]:
        try:
            return database.get_history(db_path, limit)
        except DatabaseError as error:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="telemetry storage unavailable") from error

    return app


app = create_app()