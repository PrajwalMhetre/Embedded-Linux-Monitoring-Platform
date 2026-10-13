"""Collect and publish versioned host telemetry."""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import platform
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psutil

LOGGER = logging.getLogger("telemetry_agent")
SCHEMA_VERSION = "1.0"


def _read_linux_float(path: str) -> float | None:
    try:
        return float(Path(path).read_text(encoding="ascii").split()[0])
    except (OSError, ValueError, IndexError):
        return None


def _load_average() -> list[float] | None:
    try:
        if sys.platform == "linux" and Path("/proc/loadavg").exists():
            values = Path("/proc/loadavg").read_text(encoding="ascii").split()[:3]
            result = [float(value) for value in values]
        else:
            result = list(os.getloadavg())
        return result if len(result) == 3 and all(math.isfinite(value) for value in result) else None
    except (OSError, ValueError, AttributeError):
        return None


def _uptime_seconds() -> float | None:
    if sys.platform == "linux":
        uptime = _read_linux_float("/proc/uptime")
        if uptime is not None and math.isfinite(uptime) and uptime >= 0:
            return uptime
    try:
        return max(0.0, time.time() - psutil.boot_time())
    except (OSError, ValueError, psutil.Error):
        return None


def _cpu_temperature() -> float | None:
    if sys.platform != "linux":
        return None
    try:
        for sensor in Path("/sys/class/thermal").glob("thermal_zone*/temp"):
            raw = float(sensor.read_text(encoding="ascii").strip())
            value = raw / 1000 if abs(raw) > 1000 else raw
            if math.isfinite(value) and -50 <= value <= 200:
                return value
    except (OSError, ValueError):
        LOGGER.debug("CPU temperature sensor is unavailable", exc_info=True)
    return None


def _safe_metric(name: str, read: Any) -> Any:
    try:
        return read()
    except (OSError, PermissionError, ValueError, psutil.Error) as error:
        LOGGER.debug("Metric %s is unavailable: %s", name, error)
        return None


def collect_telemetry() -> dict[str, Any]:
    """Return a schema-versioned snapshot; unavailable readings are null."""
    cpu_percent = _safe_metric("cpu_percent", lambda: psutil.cpu_percent(interval=0.1))
    memory_percent = _safe_metric("memory_percent", lambda: psutil.virtual_memory().percent)
    disk_percent = _safe_metric("disk_root_percent", lambda: psutil.disk_usage("/").percent)
    process_count = _safe_metric("process_count", lambda: len(psutil.pids()))

    snapshot = {
        "schema_version": SCHEMA_VERSION,
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "hostname": platform.node() or "unknown",
        "os": {
            "system": platform.system() or "unknown",
            "release": platform.release() or "unknown",
            "version": platform.version() or "unknown",
            "machine": platform.machine() or "unknown",
        },
        "cpu_percent": cpu_percent,
        "memory_percent": memory_percent,
        "disk_root_percent": disk_percent,
        "load_average": _load_average(),
        "uptime_seconds": _uptime_seconds(),
        "process_count": process_count,
        "cpu_temperature_c": _cpu_temperature(),
    }
    _validate_snapshot(snapshot)
    return snapshot


def _validate_snapshot(snapshot: dict[str, Any]) -> None:
    for key in ("cpu_percent", "memory_percent", "disk_root_percent"):
        value = snapshot[key]
        if value is not None and (isinstance(value, bool) or not math.isfinite(value) or not 0 <= value <= 100):
            raise ValueError(f"{key} must be between 0 and 100")
    for key in ("uptime_seconds", "cpu_temperature_c"):
        value = snapshot[key]
        if value is not None and (isinstance(value, bool) or not math.isfinite(value)):
            raise ValueError(f"{key} must be finite")
    if snapshot["process_count"] is not None and (
        isinstance(snapshot["process_count"], bool) or snapshot["process_count"] < 0
    ):
        raise ValueError("process_count must not be negative")
    load = snapshot["load_average"]
    if load is not None and (
        len(load) != 3
        or any(isinstance(value, bool) or not math.isfinite(value) or value < 0 for value in load)
    ):
        raise ValueError("load_average must contain three non-negative values")


def post_telemetry(url: str, snapshot: dict[str, Any], timeout: float = 5.0) -> None:
    request = urllib.request.Request(
        url.rstrip("/") + "/api/v1/metrics",
        data=json.dumps(snapshot).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status not in (200, 201, 202):
            raise urllib.error.HTTPError(request.full_url, response.status, "ingestion failed", response.headers, None)


def publish_mqtt(broker: str, topic: str, snapshot: dict[str, Any], port: int = 1883) -> None:
    try:
        import paho.mqtt.publish as mqtt_publish
    except ImportError as error:
        raise RuntimeError("MQTT publishing requires paho-mqtt; install the agent dependencies") from error
    mqtt_publish.single(topic, json.dumps(snapshot), hostname=broker, port=port, qos=1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect and publish host telemetry")
    parser.add_argument("--interval", type=float, default=0, help="sampling interval in seconds; 0 collects once")
    parser.add_argument("--backend-url", help="backend base URL, for example http://localhost:8000")
    parser.add_argument("--mqtt-broker", default=os.getenv("MQTT_BROKER") or None, help="optional MQTT broker hostname")
    parser.add_argument("--mqtt-port", type=int, default=int(os.getenv("MQTT_PORT", "1883")))
    parser.add_argument("--mqtt-topic", default=os.getenv("MQTT_TOPIC", "embedded-monitoring/telemetry"))
    args = parser.parse_args(argv)
    if args.interval < 0:
        parser.error("--interval must be zero or greater")

    while True:
        snapshot = collect_telemetry()
        print(json.dumps(snapshot, allow_nan=False), flush=True)
        if args.backend_url:
            try:
                post_telemetry(args.backend_url, snapshot)
            except (OSError, urllib.error.URLError, ValueError) as error:
                LOGGER.warning("HTTP ingestion failed: %s", error)
        if args.mqtt_broker:
            try:
                publish_mqtt(args.mqtt_broker, args.mqtt_topic, snapshot, args.mqtt_port)
            except (OSError, RuntimeError, ValueError) as error:
                LOGGER.warning("MQTT publishing failed: %s", error)
        if args.interval == 0:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    raise SystemExit(main())