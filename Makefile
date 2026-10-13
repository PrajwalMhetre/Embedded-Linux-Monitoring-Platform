.PHONY: install install-frontend run-api run-agent run-dashboard test lint build compose-up compose-down

install:
	python3.11 -m venv .venv
	.venv/bin/python -m pip install -r requirements.txt

install-frontend:
	cd frontend && npm ci

run-api:
	.venv/bin/uvicorn backend.app.main:app --reload

run-agent:
	.venv/bin/python -m agent.telemetry_agent --interval 15 --backend-url http://127.0.0.1:8000

run-dashboard:
	cd frontend && npm run dev

test:
	.venv/bin/python -m pytest
	cd frontend && npm test

lint:
	.venv/bin/ruff check agent backend

build:
	cd frontend && npm run build

compose-up:
	docker compose up --build

compose-down:
	docker compose down