import { useEffect, useState, type CSSProperties } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  Clock3,
  Cpu,
  Database,
  HardDrive,
  MemoryStick,
  Radio,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
  type LucideIcon,
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

const POLL_INTERVAL_MS = 5_000;
const thresholds = {
  cpu: readThreshold(import.meta.env.VITE_CPU_WARNING_THRESHOLD, 85),
  memory: readThreshold(import.meta.env.VITE_MEMORY_WARNING_THRESHOLD, 85),
  disk: readThreshold(import.meta.env.VITE_DISK_WARNING_THRESHOLD, 90),
};

type ResourceKind = "cpu" | "memory" | "disk";
type MetricKey = "cpu_percent" | "memory_percent";

function readThreshold(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : fallback;
}

function formatPercent(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)}%`;
}

function formatUptime(seconds: number | null): string {
  if (seconds === null) return "N/A";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
}

function formatDateTime(value: string | Date | null): string {
  if (value === null) return "N/A";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatChartTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(
    new Date(timestamp),
  );
}

function ResourceCard({
  label,
  value,
  threshold,
  icon: Icon,
  kind,
}: {
  label: string;
  value: number | null;
  threshold: number;
  icon: LucideIcon;
  kind: ResourceKind;
}) {
  const unavailable = value === null;
  const warning = !unavailable && value >= threshold;
  const statusLabel = unavailable ? "Unavailable" : warning ? "Warning" : "Normal";
  const gaugeStyle = {
    "--reading": `${value ?? 0}`,
    "--gauge-color": `var(--${kind})`,
  } as CSSProperties;

  return (
    <article className={`resource-card resource-card--${kind} ${warning ? "is-warning" : ""} ${unavailable ? "is-unavailable" : ""}`}>
      <div className="resource-card__top">
        <span className="resource-icon"><Icon size={17} aria-hidden="true" /></span>
        <span className="resource-label">{label}</span>
        <span className={`state-label ${warning ? "state-label--warning" : ""} ${unavailable ? "state-label--unavailable" : ""}`}>
          {warning && <AlertTriangle size={13} aria-hidden="true" />}
          {!warning && !unavailable && <Check size={13} aria-hidden="true" />}
          {statusLabel}
        </span>
      </div>
      <div className="resource-card__reading">
        <div
          className="gauge"
          style={gaugeStyle}
          role="img"
          aria-label={`${label}: ${formatPercent(value)}, ${statusLabel.toLowerCase()}`}
        >
          <span>{formatPercent(value)}</span>
        </div>
        <div className="resource-card__meta">
          <span>{warning ? "Monitoring alert" : unavailable ? "No reading" : "Current utilization"}</span>
          <strong>Threshold {threshold}%</strong>
        </div>
      </div>
      <div className="resource-track" aria-hidden="true">
        {value !== null && <span style={{ width: `${value}%` }} />}
      </div>
    </article>
  );
}

function DetailCard({
  label,
  value,
  unit,
  icon: Icon,
  unavailable = false,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: LucideIcon;
  unavailable?: boolean;
}) {
  return (
    <article className={`detail-card ${unavailable ? "is-unavailable" : ""}`}>
      <span className="detail-card__icon"><Icon size={16} aria-hidden="true" /></span>
      <span className="detail-card__label">{label}</span>
      <strong className="detail-card__value">{value}</strong>
      {unit && <span className="detail-card__unit">{unit}</span>}
    </article>
  );
}

function HistoryChart({
  history,
  metric,
  title,
  color,
}: {
  history: Telemetry[];
  metric: MetricKey;
  title: string;
  color: string;
}) {
  const chartData = history.map((sample) => ({
    timestamp: sample.timestamp,
    value: sample[metric],
  }));
  const hasValue = chartData.some((point) => point.value !== null);

  return (
    <section className="chart-panel" aria-label={`${title} history chart`}>
      <div className="chart-panel__heading">
        <div>
          <h3>{title}</h3>
          <p>Last {history.length} sample{history.length === 1 ? "" : "s"} · 0–100%</p>
        </div>
        <span className="chart-key"><i style={{ background: color }} />{title}</span>
      </div>
      {history.length === 0 || !hasValue ? (
        <div className="chart-empty"><Radio size={17} aria-hidden="true" /><span>{history.length === 0 ? "No history recorded" : "No readings available"}</span></div>
      ) : (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 12, right: 10, left: 2, bottom: 0 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatChartTime}
                minTickGap={36}
                tick={{ fill: "var(--text-dim)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(reading: number) => `${reading}%`}
                tick={{ fill: "var(--text-dim)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={42}
              />
              <Tooltip
                labelFormatter={(label) => formatDateTime(String(label))}
                formatter={(reading) => [reading === null ? "N/A" : `${Number(reading).toFixed(1)}%`, title]}
                contentStyle={{
                  background: "var(--panel-raised)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 6,
                  color: "var(--text-primary)",
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                name={title}
                stroke={color}
                strokeWidth={2}
                dot={chartData.length < 4 ? { r: 3, fill: color, strokeWidth: 0 } : false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof fetchDashboardData>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const poll = async () => {
      if (stopped) return;
      controller = new AbortController();
      try {
        const next = await fetchDashboardData(controller.signal);
        if (stopped) return;
        setDashboard(next);
        setConnected(true);
        setError(null);
        setLastRefresh(new Date());
      } catch (cause) {
        if (stopped || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setConnected(false);
        setError(cause instanceof Error ? cause.message : "Unable to reach the telemetry API");
      } finally {
        if (!stopped) {
          setLoading(false);
          timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [refreshKey]);

  const history = dashboard?.history ?? [];
  const latest = dashboard?.latest ?? history.at(-1) ?? null;
  const warningCandidates: Array<[string, number | null, number]> = latest
    ? [
        ["CPU", latest.cpu_percent, thresholds.cpu],
        ["Memory", latest.memory_percent, thresholds.memory],
        ["Root filesystem", latest.disk_root_percent, thresholds.disk],
      ]
    : [];
  const warningItems = warningCandidates.filter(
    (item): item is [string, number, number] => item[1] !== null && item[1] >= item[2],
  );
  const connectionText = !connected ? (loading ? "Connecting" : "API unavailable") : "API connected";
  const telemetryText = connected
    ? latest
      ? "Telemetry available"
      : "No telemetry received"
    : latest
      ? "Showing last good sample"
      : "Telemetry unavailable";

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="EdgeWatch dashboard home">
          <span className="brand-mark"><Activity size={19} aria-hidden="true" /></span>
          <span className="brand-copy"><strong>EdgeWatch</strong><small>EMBEDDED LINUX MONITORING PLATFORM</small></span>
        </a>
        <div className="topbar__right">
          <div className={`connection-badge ${connected ? "is-connected" : "is-disconnected"}`} role="status">
            {connected ? <Wifi size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}
            <span>{connectionText}</span>
          </div>
          <button
            className="refresh-button"
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            aria-label="Refresh telemetry now"
            title="Refresh telemetry now"
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <main id="overview" className="main-content">
        <section className="device-heading">
          <div className="device-heading__main">
            <div className="eyebrow"><span className="eyebrow-dot" /> LIVE DEVICE MONITOR</div>
            <h1>{latest?.hostname ?? "Device overview"}</h1>
            <p className="device-platform">
              <Server size={15} aria-hidden="true" />
              {latest ? `${latest.os.system} ${latest.os.release} · ${latest.os.machine}` : "No device data available"}
            </p>
          </div>
          <div className="refresh-meta">
            <span className="meta-label">LAST SUCCESSFUL REFRESH</span>
            <strong>{formatDateTime(lastRefresh)}</strong>
            <span className="refresh-interval">Polling every 5 seconds</span>
          </div>
        </section>

        {!connected && !loading && (
          <div className="notice notice--error" role="alert">
            <WifiOff size={17} aria-hidden="true" />
            <div><strong>Backend connection unavailable</strong><span>{error ?? "The API did not return a healthy response."} Last good telemetry is retained while reconnecting.</span></div>
            <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button>
          </div>
        )}
        {connected && !latest && (
          <div className="notice notice--neutral" role="status">
            <Radio size={17} aria-hidden="true" />
            <div><strong>No telemetry received</strong><span>The API is healthy, but no device sample is stored yet.</span></div>
          </div>
        )}
        {warningItems.length > 0 && (
          <div className="notice notice--warning" role="status">
            <AlertTriangle size={17} aria-hidden="true" />
            <div>
              <strong>Monitoring alert · threshold exceeded</strong>
              <span>{warningItems.map(([name, value]) => `${name} ${value.toFixed(1)}%`).join(" · ")} · Advisory only; not a hardware fault diagnosis.</span>
            </div>
          </div>
        )}
        {error && connected && (
          <div className="notice notice--warning" role="status">
            <AlertTriangle size={17} aria-hidden="true" />
            <div><strong>Refresh issue</strong><span>{error} Showing the last successful sample.</span></div>
          </div>
        )}

        <section className="section-block" aria-labelledby="resources-heading">
          <div className="section-heading">
            <div><span className="section-kicker">SYSTEM RESOURCES</span><h2 id="resources-heading">Utilization</h2></div>
            <span className={`telemetry-state ${connected && latest ? "is-live" : "is-unavailable"}`}>
              <span className="state-pip" />{telemetryText}
            </span>
          </div>
          {loading && !dashboard && <div className="loading-state" role="status">Connecting to the telemetry API…</div>}
          <div className="resource-grid">
            <ResourceCard label="CPU utilization" value={latest?.cpu_percent ?? null} threshold={thresholds.cpu} icon={Cpu} kind="cpu" />
            <ResourceCard label="Memory utilization" value={latest?.memory_percent ?? null} threshold={thresholds.memory} icon={MemoryStick} kind="memory" />
            <ResourceCard label="Root filesystem" value={latest?.disk_root_percent ?? null} threshold={thresholds.disk} icon={HardDrive} kind="disk" />
          </div>
        </section>

        <section className="section-block" aria-labelledby="details-heading">
          <div className="section-heading">
            <div><span className="section-kicker">DEVICE HEALTH</span><h2 id="details-heading">System details</h2></div>
            <span className="last-sample"><Clock3 size={14} aria-hidden="true" /> Last telemetry: {formatDateTime(latest?.timestamp ?? null)}</span>
          </div>
          <div className="details-grid">
            <DetailCard label="System uptime" value={formatUptime(latest?.uptime_seconds ?? null)} icon={Clock3} unavailable={latest?.uptime_seconds == null} />
            <DetailCard label="1-minute load average" value={latest?.load_average?.[0]?.toFixed(2) ?? "N/A"} icon={Activity} unavailable={latest?.load_average == null} />
            <DetailCard label="Running processes" value={latest?.process_count?.toLocaleString() ?? "N/A"} icon={Database} unavailable={latest?.process_count == null} />
            <DetailCard label="CPU temperature" value={latest?.cpu_temperature_c == null ? "N/A" : `${latest.cpu_temperature_c.toFixed(1)} °C`} icon={Cpu} unavailable={latest?.cpu_temperature_c == null} />
          </div>
        </section>

        <section className="section-block" aria-labelledby="history-heading">
          <div className="section-heading">
            <div><span className="section-kicker">RECENT TELEMETRY</span><h2 id="history-heading">Performance history</h2></div>
            <span className="history-count">{history.length} / 60 samples</span>
          </div>
          <div className="chart-grid">
            <HistoryChart history={history} metric="cpu_percent" title="CPU utilization" color="var(--cpu)" />
            <HistoryChart history={history} metric="memory_percent" title="Memory utilization" color="var(--memory)" />
          </div>
        </section>

        <footer className="dashboard-footer">
          <span><span className="footer-mark" />EDGEWATCH · LOCAL DEVICE OBSERVABILITY</span>
          <span>{lastRefresh ? `Updated ${formatDateTime(lastRefresh)}` : "Awaiting first successful refresh"}</span>
        </footer>
      </main>
    </div>
  );
}
