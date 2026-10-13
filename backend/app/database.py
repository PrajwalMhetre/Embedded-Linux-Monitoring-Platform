"""Small SQLite persistence boundary for telemetry snapshots."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from backend.app.schemas import TelemetryPayload


class DatabaseError(RuntimeError):
    """Raised when the telemetry database cannot complete an operation."""


@contextmanager
def _connect(database_path: Path) -> Iterator[sqlite3.Connection]:
    if str(database_path) != ":memory:":
        database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(database_path), timeout=5)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database(database_path: Path) -> None:
    try:
        with _connect(database_path) as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS telemetry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    hostname TEXT NOT NULL,
                    payload TEXT NOT NULL
                )"""
            )
            connection.execute("CREATE INDEX IF NOT EXISTS telemetry_timestamp_idx ON telemetry(timestamp DESC, id DESC)")
    except (OSError, sqlite3.Error) as error:
        raise DatabaseError("could not initialize telemetry database") from error


def check_database(database_path: Path) -> None:
    try:
        with _connect(database_path) as connection:
            connection.execute("SELECT 1 FROM telemetry LIMIT 1").fetchone()
    except (OSError, sqlite3.Error) as error:
        raise DatabaseError("telemetry database is unavailable") from error


def insert_telemetry(database_path: Path, payload: TelemetryPayload) -> None:
    try:
        with _connect(database_path) as connection:
            connection.execute(
                "INSERT INTO telemetry(timestamp, hostname, payload) VALUES (?, ?, ?)",
                (payload.timestamp.isoformat(), payload.hostname, payload.model_dump_json()),
            )
    except (OSError, sqlite3.Error) as error:
        raise DatabaseError("could not persist telemetry") from error


def get_latest(database_path: Path) -> TelemetryPayload | None:
    try:
        with _connect(database_path) as connection:
            row = connection.execute("SELECT payload FROM telemetry ORDER BY timestamp DESC, id DESC LIMIT 1").fetchone()
        return TelemetryPayload.model_validate_json(row["payload"]) if row else None
    except (OSError, sqlite3.Error, ValueError) as error:
        raise DatabaseError("could not read latest telemetry") from error


def get_history(database_path: Path, limit: int) -> list[TelemetryPayload]:
    try:
        with _connect(database_path) as connection:
            rows = connection.execute(
                "SELECT payload FROM telemetry ORDER BY timestamp DESC, id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [TelemetryPayload.model_validate_json(row["payload"]) for row in rows]
    except (OSError, sqlite3.Error, ValueError) as error:
        raise DatabaseError("could not read telemetry history") from error


def count_telemetry(database_path: Path) -> int:
    try:
        with _connect(database_path) as connection:
            row = connection.execute("SELECT COUNT(*) AS count FROM telemetry").fetchone()
        return int(row["count"])
    except (OSError, sqlite3.Error) as error:
        raise DatabaseError("could not count telemetry records") from error