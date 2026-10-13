FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE_PATH=/data/telemetry.db

WORKDIR /app
COPY requirements-runtime.txt /tmp/requirements-runtime.txt
RUN pip install --no-cache-dir -r /tmp/requirements-runtime.txt \
    && useradd --create-home --uid 10001 app \
    && mkdir -p /data \
    && chown app:app /data

COPY backend /app/backend
COPY agent /app/agent
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" || exit 1
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]