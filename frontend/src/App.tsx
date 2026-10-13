import { useEffect, useState, type CSSProperties } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  Cpu,
  HardDrive,
  MemoryStick,
  Radio,
  RefreshCw,
  Server,
  Wifi,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchDashboardData, type Telemetry } from "./api";

const REFRESH_MS = 15_000;
const thresholds = {
  cpu: readThreshold(import.meta.env.VITE_CPU_WARNING_THRESHOLD, 85),
  memory: readThreshold(import.meta.env.VITE_MEMORY_WARNING_THRESHOLD, 85),
  disk: readThreshold(import.meta.env.VITE_DISK_WARNING_THRESHOLD, 90),
};

function readThreshold(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : fallback;
}

function formatPercent(value: number | null): string {
  return value === null ? "--" : `${value.toFixed(1)}%`;
}

function formatUptime(seconds: number | null): string {
  if (seconds === null) return "--";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function MetricGauge({
  label,
  value,
  threshold,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | null;
  threshold: number;
  icon: typeof Cpu;
  tone: "green" | "blue" | "orange";
}) {
  const isHigh = value !== null && value >= threshold;
  const gaugeStyle = { "--value": `${value ?? 0}`, "--gauge-color": `var(--${tone})` } as CSSProperties;
  return (
    <article className={`metric-panel ${isHigh ? "metric-panel--warning" : ""}`}>
      <div className="metric-panel__head">
        <span className="metric-icon"><Icon size={17} strokeWidth={1.8} /></span>
        <span className="metric-label">{label}</span>
        {isHigh && <AlertTriangle className="warning-icon" size={16} aria-label="Threshold exceeded" />}
      </div>
      <div className="gauge-row">
        <div className="gauge" style={gaugeStyle} aria-label={`${label}: ${formatPercent(value)}`}>
          <span>{formatPercent(value)}</span>
        </div>
        <div className="gauge-note">
          <span className="metric-caption">{isHigh ? "Above threshold" : "Current load"}</span>
          <span className="threshold-caption">Alert at {threshold}%</span>
        </div>
      </div>
      <div className="metric-track" aria-hidden="true">
        <span style={{ width: `${value ?? 0}%` }} />
      </div>
    </article>
  );
}

function HistoryChart({ history }: { history: Telemetry[] }) {
  const chartData = history.map((item) => ({
    time: formatTime(item.timestamp),
    cpu: item.cpu_percent,
    memory: item.memory_percent,
  }));
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: -22, bottom: 0 }}>
          <CartesianGrid stroke="#e6eae6" vertical={false} />
          <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: "#7a8580", fontSize: 10 }} minTickGap={34} />
          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: "#7a8580", fontSize: 10 }} tickFormatter={(value: number) => `${value}%`} />
          <Tooltip contentStyle={{ border: "1px solid #e2e8e3", borderRadius: 4, fontSize: 12 }} />
          <Line type="monotone" dataKey="cpu" name="CPU" stroke="var(--green)" strokeWidth={2} dot={false} connectNulls />
          <Line type="monotone" dataKey="memory" name="Memory" stroke="var(--blue)" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function App() {
  const [history, setHistory] = useState<Telemetry[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (active) setRefreshing(true);
      try {
        const result = await fetchDashboardData();
        if (!active) return;
        setHistory(result.history);
        setConnected(result.health.status === "ok" && result.health.database === "ok");
        setError(null);
        setLastUpdated(new Date());
      } catch (cause) {
        if (!active) return;
        setConnected(false);
        setError(cause instanceof Error ? cause.message : "Unable to reach the telemetry API");
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const latest = history.at(-1);
  const warningCandidates: Array<[string, number | null, number]> = latest
    ? [
        ["CPU", latest.cpu_percent, thresholds.cpu],
        ["Memory", latest.memory_percent, thresholds.memory],
        ["Root disk", latest.disk_root_percent, thresholds.disk],
      ]
    : [];
  const warnings = warningCandidates.filter(
    (item): item is [string, number, number] => item[1] !== null && item[1] >= item[2],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Activity size={17} /></span><span>FIELDNOTE<span className="brand-sub">DEVICE OBSERVABILITY</span></span></div>
        <div className="sidebar-label">WORKSPACE</div>
        <div className="nav-item nav-item--active"><Server size={17} /><span>Device overview</span><span className="nav-count">01</span></div>
        <div className="sidebar-foot"><span className="sidebar-foot__dot" /> LOCAL MONITORING</div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">Fleet <span>/</span> Device overview</div>
          <div className="topbar-right">
            <span className={`connection ${connected ? "connection--up" : ""}`}><span />{connected ? "API CONNECTED" : "API DISCONNECTED"}</span>
            <button className="icon-button" type="button" onClick={() => window.location.reload()} aria-label="Reload dashboard" title="Reload dashboard"><RefreshCw size={16} /></button>
          </div>
        </header>

        <div className="content-wrap">
          <section className="page-heading">
            <div>
              <div className="eyebrow">DEVICE / 01</div>
              <h1>{latest?.hostname ?? "Device overview"}</h1>
              <p>{latest ? `${latest.os.system} ${latest.os.release} · ${latest.os.machine}` : "Waiting for the first telemetry sample"}</p>
            </div>
            <div className="updated-block"><span className="eyebrow">LAST SAMPLE RECEIVED</span><strong>{latest ? formatTime(latest.timestamp) : "--"}</strong><span className="updated-sub">{lastUpdated ? `Synced ${lastUpdated.toLocaleTimeString()}` : "No sync yet"}</span></div>
          </section>

          {error && <div className="notice notice--error" role="alert"><Wifi size={17} /><span><strong>Telemetry API unavailable</strong>{error}</span><a href="/health">Check health</a></div>}
          {warnings.length > 0 && <div className="notice notice--warning" role="status"><AlertTriangle size={17} /><span><strong>Resource threshold exceeded</strong>{warnings.map(([name, value]) => `${name} ${value.toFixed(1)}%`).join(" · ")}</span></div>}

          <section className="section-block">
            <div className="section-title"><h2>Resource utilization</h2><span>LIVE SNAPSHOT</span></div>
            {loading ? <div className="loading-line">Connecting to telemetry source…</div> : history.length === 0 ? <div className="empty-state"><Radio size={20} /><span>No telemetry samples recorded yet</span></div> : (
              <div className="metric-grid">
                <MetricGauge label="CPU utilization" value={latest?.cpu_percent ?? null} threshold={thresholds.cpu} icon={Cpu} tone="green" />
                <MetricGauge label="Memory utilization" value={latest?.memory_percent ?? null} threshold={thresholds.memory} icon={MemoryStick} tone="blue" />
                <MetricGauge label="Root filesystem" value={latest?.disk_root_percent ?? null} threshold={thresholds.disk} icon={HardDrive} tone="orange" />
              </div>
            )}
          </section>

          <div className="details-chart-grid">
            <section className="detail-panel">
              <div className="section-title"><h2>System details</h2><span>HOST STATUS</span></div>
              <dl className="detail-list">
                <div><dt><Activity size={15} /> Uptime</dt><dd>{latest ? formatUptime(latest.uptime_seconds) : "--"}</dd></div>
                <div><dt><Activity size={15} /> Load average</dt><dd>{latest?.load_average?.map((value) => value.toFixed(2)).join(" / ") ?? "--"}</dd></div>
                <div><dt><Server size={15} /> Processes</dt><dd>{latest?.process_count ?? "--"}</dd></div>
                <div><dt><Cpu size={15} /> CPU temperature</dt><dd>{latest?.cpu_temperature_c == null ? "--" : `${latest.cpu_temperature_c.toFixed(1)} °C`}</dd></div>
                <div><dt><ArrowDownToLine size={15} /> Platform</dt><dd>{latest?.os.machine ?? "--"}</dd></div>
              </dl>
            </section>
            <section className="chart-panel">
              <div className="section-title"><div><h2>Performance history</h2><p>CPU and memory · last 60 samples</p></div><span className="chart-legend"><i className="legend-green" /> CPU <i className="legend-blue" /> MEMORY</span></div>
              {!loading && history.length > 0 ? <HistoryChart history={history} /> : <div className="chart-empty">{loading ? "Loading samples…" : "Chart available after telemetry arrives"}</div>}
            </section>
          </div>
          <footer className="page-footer"><span><MemoryStick size={14} /> EMBEDDED LINUX MONITOR</span><span>{refreshing ? "SYNCING" : "AUTO-REFRESH · 15 SEC"}</span></footer>
        </div>
      </main>
    </div>
  );
}