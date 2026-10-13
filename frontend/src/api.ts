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

interface Health {
  status: "ok";
  database: "ok";
}

const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";
const API_BASE = configuredBase.replace(/\/$/, "");

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function fetchDashboardData(): Promise<{ health: Health; history: Telemetry[] }> {
  const [health, history] = await Promise.all([
    getJson<Health>("/health"),
    getJson<Telemetry[]>("/api/v1/metrics/history?limit=60"),
  ]);
  return { health, history };
}