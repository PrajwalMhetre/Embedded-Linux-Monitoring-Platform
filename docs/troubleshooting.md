# Installation and Troubleshooting

## Local prerequisites

- Python 3.11 or newer, Node.js 22 or newer, and npm.
- Docker Desktop and Compose v2 only when using the container workflow.
- macOS is sufficient for local software checks. Linux is required to exercise `/proc`, `/sys`, and systemd behavior.

From the repository root:

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd frontend && npm ci
```

The Python development requirements include FastAPI/Uvicorn, psutil, Paho MQTT, pytest, Starlette's HTTPX2-compatible TestClient transport, and Ruff. Frontend packages are locked in `frontend/package-lock.json`.

## Common issues

| Symptom | Check |
| --- | --- |
| Dashboard reports API disconnected | Start Uvicorn on port 8000; with the Vite proxy, keep its default backend target at `localhost:8000`. Check `GET /health`. |
| Direct API URL fails in a browser | Set `CORS_ALLOWED_ORIGINS` to the exact dashboard origin, such as `http://127.0.0.1:5173`; set `VITE_API_BASE_URL` to the API origin and restart both processes. Avoid `*`. |
| Dashboard is empty | Send one sample with the agent or API example, then check `/api/v1/metrics/history`. Empty history is expected before ingestion. |
| API returns `422` | Compare the body with `/docs`; include timezone-aware timestamp, schema version `1.0`, required OS identity fields, and bounded metric values. |
| Database endpoint returns `503` | Confirm the configured database parent directory is writable and storage is available; inspect structured backend logs. |
| MQTT publish fails | Start the optional broker with `docker compose --profile mqtt up`, then set `MQTT_BROKER=127.0.0.1` for a host-run agent. The sample broker is local-only and anonymous. |
| `npm ci` fails | Use Node 22+ and run it from `frontend/` so it can read the lockfile. |
| Linux readings are null | Check kernel interfaces and access for the service account. Unsupported metrics are intentionally null; not every board exposes a thermal zone. |
| Compose health check fails | Run `docker compose ps` and `docker compose logs backend frontend`; verify Docker Desktop is running and ports 8000/8080 are free. |

## systemd agent example

The unit at `deploy/telemetry-agent.service` assumes the project is installed under `/opt/embedded-linux-monitoring-platform`, a `telemetry` account exists, and an API is reachable at `127.0.0.1:8000`. Install Python runtime dependencies in that installation's `.venv`, install the unit under `/etc/systemd/system/`, then run `systemctl daemon-reload`, `systemctl enable --now telemetry-agent`, and `systemctl status telemetry-agent`. Use `journalctl -u telemetry-agent` to inspect output. Optional MQTT environment variables can be placed in `/etc/embedded-monitoring/agent.env`.

## Linux SBC validation

Hardware checks have not yet been performed. On a Raspberry Pi or another Linux SBC:

1. Record board model, distro, kernel, Python version, and service user.
2. Install the repository's runtime requirements and run `python -m agent.telemetry_agent`; parse the single output line as JSON.
3. Compare load/uptime readings with `/proc/loadavg` and `/proc/uptime`; inspect thermal-zone files if present.
4. Start a trusted API endpoint, run the agent with `--backend-url`, and verify ingestion, latest, history, and the dashboard.
5. Repeat under the intended unprivileged systemd user, checking that inaccessible optional readings are null and the service remains active.
6. Record actual results before marking any hardware or deployment status as verified.