import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { parseTelemetry, type Telemetry } from "./api";

const sample = {
  schema_version: "1.0" as const,
  timestamp: "2026-10-13T12:00:00Z",
  hostname: "edge-board",
  os: { system: "Linux", release: "6.1", version: "test", machine: "aarch64" },
  cpu_percent: 92,
  memory_percent: 41,
  disk_root_percent: 50,
  load_average: [0.2, 0.3, 0.4],
  uptime_seconds: 93_600,
  process_count: 42,
  cpu_temperature_c: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function installDashboardResponse({
  latest = sample,
  history = [sample],
}: {
  latest?: Telemetry | null;
  history?: Telemetry[];
} = {}) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/health")) return jsonResponse({ status: "ok", database: "ok" });
    if (path.endsWith("/latest")) return latest === null ? jsonResponse({ detail: "empty" }, 404) : jsonResponse(latest);
    if (path.includes("/history?limit=60")) return jsonResponse(history);
    return jsonResponse({ detail: "not found" }, 404);
  }));
}

describe("monitoring dashboard", () => {
  it("renders actual telemetry and threshold warnings", async () => {
    installDashboardResponse();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "edge-board" })).toBeInTheDocument();
    expect(screen.getByText("EdgeWatch")).toBeInTheDocument();
    expect(screen.getByText("92.0%")).toBeInTheDocument();
    expect(screen.getByText("1d 2h 0m")).toBeInTheDocument();
    expect(screen.getByText("Monitoring alert · threshold exceeded")).toBeInTheDocument();
    expect(screen.getByText("API connected")).toBeInTheDocument();
  });

  it("shows N/A for missing readings and accepts an optional negative temperature", async () => {
    const partial = { ...sample, cpu_percent: null, memory_percent: null, disk_root_percent: null, uptime_seconds: null, load_average: null, process_count: null, cpu_temperature_c: -2 };
    installDashboardResponse({ latest: partial, history: [partial] });
    render(<App />);

    expect(await screen.findByRole("img", { name: "CPU utilization: N/A, unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Memory utilization: N/A, unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Root filesystem: N/A, unavailable" })).toBeInTheDocument();
    expect(screen.getByText("-2.0 °C")).toBeInTheDocument();
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(2);
  });

  it("shows the empty state when the backend has no samples", async () => {
    installDashboardResponse({ latest: null, history: [] });
    render(<App />);

    expect((await screen.findAllByText("No telemetry received")).length).toBeGreaterThan(1);
    expect(screen.getAllByText("No history recorded")).toHaveLength(2);
    expect(screen.getByText("API connected")).toBeInTheDocument();
  });

  it("shows loading, reports API errors, and recovers on retry", async () => {
    let failing = true;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (failing) return Promise.reject(new Error("network unavailable"));
      const path = String(input);
      if (path.endsWith("/health")) return jsonResponse({ status: "ok", database: "ok" });
      if (path.endsWith("/latest")) return jsonResponse(sample);
      return jsonResponse([sample]);
    }));
    render(<App />);

    expect(screen.getByText("Connecting to the telemetry API…")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("network unavailable");
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("API connected")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "edge-board" })).toBeInTheDocument();
  });

  it("retains the last successful sample during a later refresh failure", async () => {
    let failing = false;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (failing) return Promise.reject(new Error("temporary network failure"));
      const path = String(input);
      if (path.endsWith("/health")) return jsonResponse({ status: "ok", database: "ok" });
      if (path.endsWith("/latest")) return jsonResponse(sample);
      return jsonResponse([sample]);
    }));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "edge-board" })).toBeInTheDocument();
    failing = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh telemetry now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("temporary network failure");
    expect(screen.getByRole("heading", { name: "edge-board" })).toBeInTheDocument();
    expect(screen.getByText("92.0%")).toBeInTheDocument();
    expect(screen.getByText("Showing last good sample")).toBeInTheDocument();
  });

  it("rejects unexpected telemetry and checks all three backend endpoints", async () => {
    expect(() => parseTelemetry({ ...sample, cpu_percent: "12.5" })).toThrow("cpu_percent");
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/health")) return jsonResponse({ status: "ok", database: "ok" });
      if (path.endsWith("/latest")) return jsonResponse(sample);
      return jsonResponse([sample]);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findByRole("heading", { name: "edge-board" });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
      expect.arrayContaining([
        "/health",
        "/api/v1/metrics/latest",
        "/api/v1/metrics/history?limit=60",
      ]),
    );
  });
});