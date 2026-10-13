export interface Telemetry {
  schema_version: "1.0";
  timestamp: string;
  hostname: string;
  os: {
    system: string;
    release: string;
    version: string;
    machine: string;
  };
  cpu_percent: number | null;
  memory_percent: number | null;
  disk_root_percent: number | null;
  load_average: number[] | null;
  uptime_seconds: number | null;
  process_count: number | null;
  cpu_temperature_c: number | null;
}

export interface Health {
  status: "ok";
  database: "ok";
}

export interface DashboardData {
  health: Health;
  latest: Telemetry | null;
  history: Telemetry[];
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL?.trim() ?? "").replace(/\/$/, "");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid telemetry response: ${field} must be a non-empty string`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid telemetry response: ${field} must be a finite number or null`);
  }
  return value;
}

export function parseTelemetry(value: unknown): Telemetry {
  if (!isRecord(value) || !isRecord(value.os)) {
    throw new Error("Invalid telemetry response: expected a telemetry object with OS details");
  }

  const timestamp = requiredString(value.timestamp, "timestamp");
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("Invalid telemetry response: timestamp is not a valid date");
  }

  let loadAverage: number[] | null = null;
  if (value.load_average !== null && value.load_average !== undefined) {
    if (
      !Array.isArray(value.load_average) ||
      value.load_average.length !== 3 ||
      value.load_average.some((reading) => typeof reading !== "number" || !Number.isFinite(reading) || reading < 0)
    ) {
      throw new Error("Invalid telemetry response: load_average must contain three non-negative numbers or null");
    }
    loadAverage = value.load_average;
  }

  const processCount = optionalNumber(value.process_count, "process_count");
  if (processCount !== null && (!Number.isInteger(processCount) || processCount < 0)) {
    throw new Error("Invalid telemetry response: process_count must be a non-negative integer or null");
  }

  const metrics = {
    cpu_percent: optionalNumber(value.cpu_percent, "cpu_percent"),
    memory_percent: optionalNumber(value.memory_percent, "memory_percent"),
    disk_root_percent: optionalNumber(value.disk_root_percent, "disk_root_percent"),
    uptime_seconds: optionalNumber(value.uptime_seconds, "uptime_seconds"),
    cpu_temperature_c: optionalNumber(value.cpu_temperature_c, "cpu_temperature_c"),
  };
  for (const [field, reading] of Object.entries(metrics)) {
    const minimum = field === "cpu_temperature_c" ? -50 : 0;
    const maximum = field.endsWith("percent") ? 100 : field === "cpu_temperature_c" ? 200 : Number.POSITIVE_INFINITY;
    if (reading !== null && (reading < minimum || reading > maximum)) {
      throw new Error(`Invalid telemetry response: ${field} is outside its valid range`);
    }
  }

  return {
    schema_version: value.schema_version === "1.0" ? "1.0" : invalidField("schema_version"),
    timestamp,
    hostname: requiredString(value.hostname, "hostname"),
    os: {
      system: requiredString(value.os.system, "os.system"),
      release: requiredString(value.os.release, "os.release"),
      version: requiredString(value.os.version, "os.version"),
      machine: requiredString(value.os.machine, "os.machine"),
    },
    ...metrics,
    load_average: loadAverage,
    process_count: processCount,
  };
}

function invalidField(field: string): never {
  throw new Error(`Invalid telemetry response: unsupported ${field}`);
}

async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`API returned invalid JSON for ${path}`);
  }
}

export async function fetchDashboardData(signal: AbortSignal): Promise<DashboardData> {
  const [healthResponse, latestResponse, historyResponse] = await Promise.all([
    getJson("/health", signal),
    fetch(`${API_BASE}/api/v1/metrics/latest`, { headers: { Accept: "application/json" }, signal }),
    fetch(`${API_BASE}/api/v1/metrics/history?limit=60`, { headers: { Accept: "application/json" }, signal }),
  ]);

  if (!isRecord(healthResponse) || healthResponse.status !== "ok" || healthResponse.database !== "ok") {
    throw new Error("API health response is invalid or reports an unavailable database");
  }
  if (!historyResponse.ok) {
    throw new Error(`API request failed (${historyResponse.status}) for telemetry history`);
  }

  let latest: Telemetry | null = null;
  if (latestResponse.status !== 404) {
    if (!latestResponse.ok) {
      throw new Error(`API request failed (${latestResponse.status}) for latest telemetry`);
    }
    try {
      latest = parseTelemetry(await latestResponse.json() as unknown);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid telemetry response:")) throw error;
      throw new Error("API returned invalid JSON for latest telemetry");
    }
  }

  let historyJson: unknown;
  try {
    historyJson = await historyResponse.json() as unknown;
  } catch {
    throw new Error("API returned invalid JSON for telemetry history");
  }
  if (!Array.isArray(historyJson)) {
    throw new Error("Invalid telemetry response: history must be an array");
  }
  const history = historyJson.map(parseTelemetry);
  if (history.some((sample, index) => index > 0 && Date.parse(sample.timestamp) < Date.parse(history[index - 1].timestamp))) {
    throw new Error("Invalid telemetry response: history is not chronological");
  }

  return { health: { status: "ok", database: "ok" }, latest, history };
}