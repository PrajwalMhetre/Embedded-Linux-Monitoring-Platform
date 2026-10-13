# Embedded Linux Monitoring Platform

> A systems-engineering portfolio project for observing Linux-based edge devices through a lightweight agent, a typed API, a browser dashboard, and automated quality checks.

**Status:** Project scaffold and implementation roadmap. Hardware-specific validation is not claimed until run on a target board.

## Objective

Build an end-to-end monitoring platform for a Linux edge device. The system will collect host metrics, expose them through an API, display trends and health status, and support containerized development and CI validation. It should run on a developer laptop first and later be validated on a Raspberry Pi or another Linux SBC.

## Technology stack

| Layer | Technologies | Purpose |
|---|---|---|
| Edge agent | Python 3.11+, `psutil`, Linux `/proc` and `/sys` | CPU, memory, disk, uptime and load sampling; Linux-specific sensors where available |
| API | FastAPI, Pydantic, Uvicorn | Typed, documented HTTP endpoints and health checks |
| Persistence | SQLite for local mode; PostgreSQL option | Store timestamped samples for trend queries |
| Dashboard | React, TypeScript, Vite, Recharts | Device status, timeseries charts and alert indicators |
| Messaging | MQTT with Eclipse Mosquitto (optional deployment profile) | Publish telemetry for edge-to-service workflows |
| Packaging | Docker, Docker Compose | Reproducible local service startup |
| Testing | pytest, HTTPX, Vitest | Unit, API and UI tests |
| Quality / CI | Ruff, mypy (incrementally), ESLint, GitHub Actions | Linting, type checking and automated tests |
| Observability | Structured JSON logs, health endpoint, Prometheus-format metrics (optional) | Diagnose failures and inspect service health |
| Linux operations | systemd example, shell scripts | Run the agent as a managed Linux service |

Only claim technologies that are present in the code and exercised by the documented workflow. Features marked optional remain optional until implemented.

## Five-step completion plan

### Step 1 — Linux telemetry agent

Implement a portable collector for CPU utilization, memory usage, filesystem usage, load average, uptime, process count, hostname and collection timestamp. Guard Linux-only probes, define a stable JSON schema, use timeouts/error handling, and include deterministic tests with mocked collectors. Provide a CLI mode that prints one JSON sample. The agent must work without a physical board on Linux/macOS where supported metrics exist.

**Acceptance:** `python -m pytest` passes; CLI returns valid JSON; unavailable metrics are reported as unavailable instead of crashing.

### Step 2 — API and storage

Build a FastAPI service with `GET /health`, `GET /api/v1/metrics/latest`, and `GET /api/v1/metrics/history`. Validate payloads with Pydantic and persist samples in SQLite; keep the repository layer clean so PostgreSQL can be added without rewriting the API. Document API schema through OpenAPI and cover success/error cases with HTTPX tests.

**Acceptance:** local API starts, `/docs` loads, latest/history routes return typed data, and tests run without hardware.

### Step 3 — Dashboard and alert rules

Create a React + TypeScript dashboard with current CPU/memory/disk cards, time-series charts, device heartbeat and clear loading/error/empty states. Add configurable threshold rules (for example, disk usage warning) with the rule and status visible in the UI. Keep API URL configurable via environment variables and include responsive styling.

**Acceptance:** dashboard builds cleanly; component tests cover empty data, returned metrics and API failure; screenshots in `docs/` are captured from the real running application.

### Step 4 — Deployment and CI

Add a Dockerfile and Compose profile for the API and dashboard, health checks, `.env.example`, non-root container defaults where practical, and a systemd unit example for a Linux edge agent. Add GitHub Actions to install dependencies, lint and run Python and frontend tests. Include optional Mosquitto configuration only when the publish/subscribe path is implemented and tested.

**Acceptance:** clean checkout follows documented commands; CI reports actual test results; secrets and local databases are ignored by Git.

### Step 5 — Verification, documentation and release

Run the full test/build suite; add architecture and data-flow diagrams, API examples, troubleshooting, resource limitations, test evidence and known limitations. Verify the Docker path on the developer machine and test on a Raspberry Pi/Linux SBC only when available. Record device model, OS/kernel and commands/results for any hardware validation. Tag a release only when the acceptance checks pass.

**Acceptance:** a new contributor can clone, run tests, start the stack and understand what has and has not been verified.

## Proposed repository layout

```text
Embedded-Linux-Monitoring-Platform/
├── agent/                  # Linux telemetry collector and CLI
├── backend/                # FastAPI, schemas, persistence and API tests
├── frontend/               # React + TypeScript dashboard
├── deploy/                 # Docker, Compose, Mosquitto (optional), systemd
├── tests/                  # Integration tests and fixtures
├── docs/                   # Architecture, data flow, API and real screenshots
├── .github/workflows/      # CI checks
├── .env.example
├── .gitignore
├── Makefile
├── docker-compose.yml
└── README.md
```

## Local development target

The initial target is simulation/local-host mode; no physical hardware is required for collector, API, frontend, unit tests or CI development. Hardware-only data such as board temperature must be labelled unsupported when the host does not expose it.

A proposed command interface (commands become available as their corresponding files are implemented):

```bash
make install
make test
make lint
make run
```

The exact setup commands will be finalized alongside the dependency files and Compose configuration. Do not interpret these proposed commands as proof of an existing implementation.

## Security and engineering requirements

- Never commit credentials, API keys, `.env` files, database files, or personal host data.
- Bind development services to localhost by default; configure authentication and TLS before exposing the platform beyond a trusted network.
- Validate all API payloads and bound history-query limits.
- Handle permission-denied and unsupported Linux telemetry gracefully.
- Use CI and reproducible commands rather than claiming a test passed without its output.
- Keep screenshots, benchmarks and hardware results genuine; label simulated data clearly.

## Current validation status

The repository is being initialized. Until implementation and tests are committed, the stack above is the target architecture, not a claim that every component is already working. Hardware validation is pending and must be recorded with evidence.

## License

See [LICENSE](LICENSE).
