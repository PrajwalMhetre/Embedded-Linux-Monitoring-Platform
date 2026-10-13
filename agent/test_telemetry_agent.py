import json
import urllib.error
from unittest.mock import patch

import pytest

from agent import telemetry_agent


def test_collector_returns_valid_versioned_snapshot():
    with (
        patch.object(telemetry_agent.psutil, "cpu_percent", return_value=12.5),
        patch.object(telemetry_agent.psutil, "virtual_memory", return_value=type("Memory", (), {"percent": 40.0})()),
        patch.object(telemetry_agent.psutil, "disk_usage", return_value=type("Disk", (), {"percent": 60.0})()),
        patch.object(telemetry_agent.psutil, "pids", return_value=[1, 2]),
        patch.object(telemetry_agent, "_load_average", return_value=[0.1, 0.2, 0.3]),
        patch.object(telemetry_agent, "_uptime_seconds", return_value=123.0),
        patch.object(telemetry_agent, "_cpu_temperature", return_value=None),
    ):
        snapshot = telemetry_agent.collect_telemetry()

    assert snapshot["schema_version"] == "1.0"
    assert snapshot["cpu_percent"] == 12.5
    assert snapshot["process_count"] == 2
    assert snapshot["timestamp"].endswith("Z")
    json.dumps(snapshot, allow_nan=False)


def test_unsupported_metrics_are_null_instead_of_crashing():
    with (
        patch.object(telemetry_agent.psutil, "cpu_percent", side_effect=PermissionError),
        patch.object(telemetry_agent.psutil, "virtual_memory", side_effect=telemetry_agent.psutil.AccessDenied(1)),
        patch.object(telemetry_agent.psutil, "disk_usage", side_effect=OSError("unsupported")),
        patch.object(telemetry_agent.psutil, "pids", side_effect=OSError("unsupported")),
        patch.object(telemetry_agent, "_load_average", return_value=None),
        patch.object(telemetry_agent, "_uptime_seconds", return_value=None),
        patch.object(telemetry_agent, "_cpu_temperature", return_value=None),
    ):
        snapshot = telemetry_agent.collect_telemetry()

    assert snapshot["cpu_percent"] is None
    assert snapshot["memory_percent"] is None
    assert snapshot["disk_root_percent"] is None
    assert snapshot["process_count"] is None


def test_schema_rejects_out_of_range_values():
    snapshot = telemetry_agent.collect_telemetry()
    snapshot["cpu_percent"] = 101
    with pytest.raises(ValueError, match="cpu_percent"):
        telemetry_agent._validate_snapshot(snapshot)


def test_schema_rejects_boolean_metric_values():
    snapshot = telemetry_agent.collect_telemetry()
    snapshot["cpu_percent"] = True
    with pytest.raises(ValueError, match="cpu_percent"):
        telemetry_agent._validate_snapshot(snapshot)


def test_one_shot_cli_prints_json(capsys):
    with patch.object(telemetry_agent, "collect_telemetry", return_value={"schema_version": "1.0"}):
        assert telemetry_agent.main([]) == 0
    assert json.loads(capsys.readouterr().out) == {"schema_version": "1.0"}


def test_cli_logs_http_failure_and_keeps_standalone_sample(capsys, caplog):
    snapshot = {"schema_version": "1.0", "hostname": "edge-board"}
    with (
        patch.object(telemetry_agent, "collect_telemetry", return_value=snapshot),
        patch.object(telemetry_agent, "post_telemetry", side_effect=urllib.error.URLError("offline")),
    ):
        assert telemetry_agent.main(["--backend-url", "http://127.0.0.1:8000"]) == 0

    assert json.loads(capsys.readouterr().out) == snapshot
    assert "HTTP ingestion failed" in caplog.text


def test_cli_logs_mqtt_failure_without_aborting_collection(capsys, caplog):
    snapshot = {"schema_version": "1.0", "hostname": "edge-board"}
    with (
        patch.object(telemetry_agent, "collect_telemetry", return_value=snapshot),
        patch.object(telemetry_agent, "publish_mqtt", side_effect=RuntimeError("broker unavailable")),
    ):
        assert telemetry_agent.main(["--mqtt-broker", "127.0.0.1"]) == 0

    assert json.loads(capsys.readouterr().out) == snapshot
    assert "MQTT publishing failed" in caplog.text


def test_optional_mqtt_publisher_sends_versioned_json():
    snapshot = {"schema_version": "1.0", "hostname": "edge-board"}
    with patch("paho.mqtt.client.Client") as create_client:
        client = create_client.return_value
        client.publish.return_value.rc = 0
        client.publish.return_value.is_published.return_value = True
        telemetry_agent.publish_mqtt("broker.local", "edge/telemetry", snapshot, port=1884, timeout=3)

    assert client.connect_timeout == 3
    client.connect.assert_called_once_with("broker.local", port=1884, keepalive=30)
    client.publish.assert_called_once_with(
        "edge/telemetry",
        payload=json.dumps(snapshot),
        qos=1,
    )
    client.disconnect.assert_called_once_with()
    client.loop_stop.assert_called_once_with()


def test_optional_mqtt_publisher_reports_publish_timeout():
    with patch("paho.mqtt.client.Client") as create_client:
        client = create_client.return_value
        client.publish.return_value.rc = 0
        client.publish.return_value.is_published.return_value = False
        with pytest.raises(RuntimeError, match="did not complete within 2 seconds"):
            telemetry_agent.publish_mqtt("broker.local", "edge/telemetry", {}, timeout=2)

    client.disconnect.assert_called_once_with()
    client.loop_stop.assert_called_once_with()