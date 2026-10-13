"""HTTP routes for health, telemetry ingestion, and metrics exposition."""

import logging
import os
from pathlib import Path

import psutil
from fastapi import APIRouter, FastAPI, HTTPException, Query, Response, status
from fastapi.responses import JSONResponse

from backend.app import database
from backend.app.database import MAX_HISTORY_LIMIT, DatabaseError
from backend.app.schemas import HealthResponse, TelemetryPayload

LOGGER = logging.getLogger("embedded_monitoring")


def process_metric_lines() -> list[str]:
    process = psutil.Process(os.getpid())
    lines: list[str] = []
    try:
        lines.extend(
            (
                "# HELP process_resident_memory_bytes Resident memory size in bytes.",
                "# TYPE process_resident_memory_bytes gauge",
                f"process_resident_memory_bytes {process.memory_info().rss}",
            )
        )
    except (OSError, psutil.Error):
        pass
    try:
        cpu_times = process.cpu_times()
        lines.extend(
            (
                "# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.",
                "# TYPE process_cpu_seconds_total counter",
                f"process_cpu_seconds_total {cpu_times.user + cpu_times.system}",
            )
        )
    except (OSError, psutil.Error):
        pass
    try:
        lines.extend(
            (
                "# HELP process_threads Number of operating system threads in the API process.",
                "# TYPE process_threads gauge",
                f"process_threads {process.num_threads()}",
            )
        )
    except (OSError, psutil.Error):
        pass
    return lines


def create_router(database_path: Path, app: FastAPI) -> APIRouter:
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse, tags=["operations"])
    def health() -> HealthResponse | JSONResponse:
        try:
            database.check_database(database_path)
        except DatabaseError:
            app.state.database_ready = False
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content={"status": "unhealthy", "database": "unavailable"},
            )
        app.state.database_ready = True
        return HealthResponse(status="ok", database="ok")

    @router.get("/metrics", tags=["operations"], response_class=Response)
    def prometheus_metrics() -> Response:
        try:
            total = database.count_telemetry(database_path)
            latest = database.get_latest(database_path)
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
                lines.extend(
                    (
                        f"# HELP embedded_monitoring_{name} Latest reported host {name.replace('_', ' ')}.",
                        f"# TYPE embedded_monitoring_{name} gauge",
                        f"embedded_monitoring_{name} {value}",
                    )
                )
        lines.extend(process_metric_lines())
        return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4; charset=utf-8")

    @router.post(
        "/api/v1/metrics",
        response_model=TelemetryPayload,
        status_code=status.HTTP_201_CREATED,
        tags=["telemetry"],
    )
    def ingest(payload: TelemetryPayload) -> TelemetryPayload:
        try:
            database.insert_telemetry(database_path, payload)
        except DatabaseError as error:
            LOGGER.exception("telemetry persistence failed")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="telemetry storage unavailable",
            ) from error
        app.state.samples_received += 1
        LOGGER.info("telemetry accepted for host %s", payload.hostname)
        return payload

    @router.get("/api/v1/metrics/latest", response_model=TelemetryPayload, tags=["telemetry"])
    def latest() -> TelemetryPayload:
        try:
            payload = database.get_latest(database_path)
        except DatabaseError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="telemetry storage unavailable",
            ) from error
        if payload is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no telemetry has been recorded")
        return payload

    @router.get("/api/v1/metrics/history", response_model=list[TelemetryPayload], tags=["telemetry"])
    def history(limit: int = Query(default=60, ge=1, le=MAX_HISTORY_LIMIT)) -> list[TelemetryPayload]:
        try:
            return database.get_history(database_path, limit)
        except DatabaseError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="telemetry storage unavailable",
            ) from error

    return router