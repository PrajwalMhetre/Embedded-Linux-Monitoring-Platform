from fastapi.testclient import TestClient

from backend.app.main import create_app


def sample_payload(**overrides):
    payload = {
        "schema_version": "1.0",
        "timestamp": "2026-10-13T12:00:00Z",
        "hostname": "edge-board",
        "os": {"system": "Linux", "release": "6.1", "version": "test", "machine": "aarch64"},
        "cpu_percent": 12.5,
        "memory_percent": 40.0,
        "disk_root_percent": 60.0,
        "load_average": [0.1, 0.2, 0.3],
        "uptime_seconds": 1200,
        "process_count": 42,
        "cpu_temperature_c": None,
    }
    payload.update(overrides)
    return payload


def test_health_and_empty_history(tmp_path):
    with TestClient(create_app(tmp_path / "test.db")) as client:
        assert client.get("/health").json() == {"status": "ok", "database": "ok"}
        assert client.get("/api/v1/metrics/history").json() == []
        assert client.get("/api/v1/metrics/latest").status_code == 404


def test_ingest_latest_history_and_prometheus_metrics(tmp_path):
    with TestClient(create_app(tmp_path / "test.db")) as client:
        response = client.post("/api/v1/metrics", json=sample_payload())
        assert response.status_code == 201
        assert response.json()["hostname"] == "edge-board"
        assert client.get("/api/v1/metrics/latest").json()["cpu_percent"] == 12.5
        assert len(client.get("/api/v1/metrics/history?limit=1").json()) == 1
        metrics = client.get("/metrics")
        assert metrics.status_code == 200
        assert "embedded_monitoring_samples_received_total 1" in metrics.text
        assert "embedded_monitoring_cpu_percent 12.5" in metrics.text
        assert "process_resident_memory_bytes " in metrics.text
        assert "process_cpu_seconds_total " in metrics.text
        assert "process_threads " in metrics.text


def test_history_returns_latest_bounded_window_in_chronological_order(tmp_path):
    timestamps = [
        "2026-10-13T12:03:00Z",
        "2026-10-13T12:01:00Z",
        "2026-10-13T12:02:00Z",
    ]
    with TestClient(create_app(tmp_path / "history.db")) as client:
        for timestamp in timestamps:
            assert client.post("/api/v1/metrics", json=sample_payload(timestamp=timestamp)).status_code == 201

        history = client.get("/api/v1/metrics/history?limit=2")
        assert history.status_code == 200
        assert [item["timestamp"] for item in history.json()] == [
            "2026-10-13T12:02:00Z",
            "2026-10-13T12:03:00Z",
        ]
        assert client.get("/api/v1/metrics/history?limit=500").status_code == 200


def test_invalid_values_and_unknown_fields_are_rejected(tmp_path):
    with TestClient(create_app(tmp_path / "test.db")) as client:
        assert client.post("/api/v1/metrics", json=sample_payload(cpu_percent=101)).status_code == 422
        assert client.post("/api/v1/metrics", json=sample_payload(cpu_percent="12.5")).status_code == 422
        assert client.post("/api/v1/metrics", json=sample_payload(memory_percent=101)).status_code == 422
        assert client.post("/api/v1/metrics", json=sample_payload(disk_root_percent=-1)).status_code == 422
        assert client.post("/api/v1/metrics", json=sample_payload(uptime_seconds=-1)).status_code == 422
        assert client.post("/api/v1/metrics", json=sample_payload(process_count=-1)).status_code == 422
        assert client.post("/api/v1/metrics", json=sample_payload(process_count="42")).status_code == 422
        assert client.post("/api/v1/metrics", json=sample_payload(cpu_percent=True)).status_code == 422
        assert client.post("/api/v1/metrics", json=sample_payload(load_average=[0.1, True, 0.3])).status_code == 422
        assert client.post("/api/v1/metrics", json=sample_payload(load_average=[0.1, "0.2", 0.3])).status_code == 422
        assert client.post("/api/v1/metrics", json=sample_payload(unexpected="field")).status_code == 422
        assert client.get("/api/v1/metrics/history?limit=0").status_code == 422
        assert client.get("/api/v1/metrics/history?limit=501").status_code == 422


def test_openapi_documentation_is_available(tmp_path):
    with TestClient(create_app(tmp_path / "test.db")) as client:
        response = client.get("/openapi.json")
        assert response.status_code == 200
        assert "/api/v1/metrics" in response.json()["paths"]


def test_database_failures_return_service_unavailable(tmp_path):
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("file", encoding="utf-8")
    with TestClient(create_app(blocker / "test.db")) as client:
        assert client.get("/health").status_code == 503
        assert client.post("/api/v1/metrics", json=sample_payload()).status_code == 503
        assert client.get("/metrics").status_code == 503
        assert client.get("/api/v1/metrics/latest").status_code == 503
        assert client.get("/api/v1/metrics/history").status_code == 503


def test_cors_is_opt_in_and_allows_configured_dashboard_origin(tmp_path, monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
    with TestClient(create_app(tmp_path / "cors.db")) as client:
        response = client.options(
            "/api/v1/metrics",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"