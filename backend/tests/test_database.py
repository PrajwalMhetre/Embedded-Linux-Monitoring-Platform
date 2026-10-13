import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from backend.app.database import (
    DatabaseError,
    check_database,
    count_telemetry,
    get_history,
    get_latest,
    initialize_database,
    insert_telemetry,
)
from backend.app.schemas import TelemetryPayload


def payload(hostname: str, timestamp: datetime) -> TelemetryPayload:
    return TelemetryPayload.model_validate(
        {
            "schema_version": "1.0",
            "timestamp": timestamp.isoformat(),
            "hostname": hostname,
            "os": {"system": "Linux", "release": "6.1", "version": "test", "machine": "aarch64"},
            "cpu_percent": 12.0,
            "memory_percent": 34.0,
            "disk_root_percent": 56.0,
            "load_average": [0.1, 0.2, 0.3],
            "uptime_seconds": 100,
            "process_count": 10,
            "cpu_temperature_c": None,
        }
    )


def test_persistence_orders_and_bounds_history_with_parameterized_hostnames(tmp_path):
    database_path = tmp_path / "metrics.db"
    initialize_database(database_path)
    now = datetime.now(UTC)
    insert_telemetry(database_path, payload("older", now - timedelta(seconds=10)))
    insert_telemetry(database_path, payload("edge'); DROP TABLE telemetry;--", now))

    latest = get_latest(database_path)
    assert latest is not None
    assert latest.hostname == "edge'); DROP TABLE telemetry;--"
    assert len(get_history(database_path, 1)) == 1
    assert count_telemetry(database_path) == 2


def test_filesystem_failure_is_reported_as_database_error(tmp_path):
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("file", encoding="utf-8")

    with pytest.raises(DatabaseError, match="initialize"):
        initialize_database(blocker / "metrics.db")


def test_health_check_requires_telemetry_table(tmp_path):
    database_path = tmp_path / "incomplete.db"
    with sqlite3.connect(database_path) as connection:
        connection.execute("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)")

    with pytest.raises(DatabaseError, match="unavailable"):
        check_database(database_path)