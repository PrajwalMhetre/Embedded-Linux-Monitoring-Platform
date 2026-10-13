import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "./App";

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

describe("monitoring dashboard", () => {
  it("renders actual telemetry and threshold warnings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: async () => url === "/health" ? { status: "ok", database: "ok" } : [sample],
    })));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "edge-board" })).toBeInTheDocument();
    expect(screen.getByText("92.0%")).toBeInTheDocument();
    expect(screen.getByText("1d 2h")).toBeInTheDocument();
    expect(screen.getByText("Resource threshold exceeded")).toBeInTheDocument();
    expect(screen.getByText("API CONNECTED")).toBeInTheDocument();
  });

  it("shows an API error instead of fabricated metrics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Telemetry API unavailable");
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("shows the empty state when the backend has no samples", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: async () => url === "/health" ? { status: "ok", database: "ok" } : [],
    })));
    render(<App />);

    expect(await screen.findByText("No telemetry samples recorded yet")).toBeInTheDocument();
    expect(screen.getByText("API CONNECTED")).toBeInTheDocument();
  });
});