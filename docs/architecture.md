# Architecture and Data Flow

## Components

- `agent/telemetry_agent.py` collects host metrics, validates the emitted field ranges, and serializes schema version `1.0`. `psutil` provides cross-platform CPU, memory, filesystem, process, and boot-time metrics. Linux `/proc` supplies load and uptime where present; `/sys` thermal zones are optional. HTTP uses the Python standard library; MQTT uses Paho when requested.
- `backend/app/schemas.py` is the API contract. It rejects unknown fields, invalid ranges, non-finite numbers, and timestamps without a timezone.
- `backend/app/database.py` owns SQLite initialization and parameterized reads/writes. Each operation uses a short-lived connection and history is bounded by the API.
- `backend/app/main.py` owns HTTP routing, database health, structured logs, OpenAPI, and Prometheus exposition.
- `frontend/src/api.ts` reads the backend health and newest-first history endpoints. `frontend/src/App.tsx` renders snapshots and the CPU/memory timeline without generating substitute metric data.
- `deploy/nginx.conf` serves the production frontend and proxies API/health/metrics paths to the backend container.

## Telemetry Path

```mermaid
sequenceDiagram
    participant Agent as Python agent
    participant API as FastAPI
    participant DB as SQLite
    participant UI as React dashboard
    Agent->>Agent: Sample psutil and available Linux files
    Agent->>API: POST /api/v1/metrics (JSON schema 1.0)
    API->>API: Pydantic validation
    API->>DB: Parameterized INSERT
    DB-->>API: Commit
    API-->>Agent: 201 Created
    UI->>API: GET /health and /api/v1/metrics/history
    API->>DB: Bounded SELECT
    DB-->>API: Stored snapshots
    API-->>UI: JSON history
```

MQTT is a separate optional publisher path from the agent. The current backend ingests telemetry over HTTP; no MQTT subscription or broker-to-database bridge is implemented.

## Local Network Boundaries

Compose places the frontend, backend, and optional Mosquitto service on its private project network. Host ports are published to `127.0.0.1` by default. Nginx makes browser requests to the backend through same-origin paths; CORS remains disabled unless an explicit origin is configured for a direct development API URL.