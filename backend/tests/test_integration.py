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