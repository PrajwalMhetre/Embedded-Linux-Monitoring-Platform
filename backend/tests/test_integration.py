from fastapi.testclient import TestClient

from agent.telemetry_agent import collect_telemetry
from backend.app.main import create_app


def test_collector_snapshot_is_ingested_and_read_back(tmp_path):
    snapshot = collect_telemetry()
    with TestClient(create_app(tmp_path / "integration.db")) as client:
        response = client.post("/api/v1/metrics", json=snapshot)
        assert response.status_code == 201
        assert response.json()["hostname"] == snapshot["hostname"]
        assert client.get("/api/v1/metrics/latest").json() == response.json()
        assert client.get("/api/v1/metrics/history").json()[0] == response.json()


def test_sqlite_data_survives_backend_app_restart(tmp_path):
    database_path = tmp_path / "restart.db"
    snapshot = collect_telemetry()
    with TestClient(create_app(database_path)) as first_client:
        assert first_client.post("/api/v1/metrics", json=snapshot).status_code == 201

    with TestClient(create_app(database_path)) as restarted_client:
        assert restarted_client.get("/health").status_code == 200
        latest = restarted_client.get("/api/v1/metrics/latest")
        history = restarted_client.get("/api/v1/metrics/history?limit=60")
        assert latest.status_code == 200
        assert latest.json()["hostname"] == snapshot["hostname"]
        assert len(history.json()) == 1
        assert history.json()[0]["timestamp"] == latest.json()["timestamp"]