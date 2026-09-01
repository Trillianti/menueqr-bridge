import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DiagnosticLog } from "../../src/main/diagnostic-log";
import { DiagnosticsService } from "../../src/main/diagnostics-service";

describe("diagnostics", () => {
  it("redacts secrets, personal data, and local topology before rotating logs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-log-"));
    const logs = new DiagnosticLog(directory, 2, 180);
    await logs.append({
      event: "runtime.state",
      code: "NETWORK_UNAVAILABLE",
      message:
        "Authorization=Bearer abcdefghijklmnopqrstuvwxyz rawtoken_abcdefghijklmnopqrstuvwxyz 192.168.1.42 kitchen.local guest@example.com",
    });
    await logs.append({
      event: "job.outcome",
      jobId: "job_1",
      message: "A deliberately long safe message to force a bounded rotation.",
      details: {
        transport: "windows_spooler",
        printer: "Star TSP1000 (Hoffest)",
      },
    });
    const entries = await logs.recent();
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain("rawtoken_");
    expect(serialized).not.toContain("192.168.1.42");
    expect(serialized).not.toContain("kitchen.local");
    expect(serialized).not.toContain("guest@example.com");
    expect(serialized).not.toContain("Hoffest");
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "runtime.state" }),
        expect.objectContaining({
          event: "job.outcome",
          jobId: expect.stringMatching(/^sha256:/),
          details: expect.objectContaining({
            transport: "windows_spooler",
          }),
        }),
      ]),
    );
  });

  it("serializes concurrent events without losing the operational trace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-log-queue-"));
    const logs = new DiagnosticLog(directory);
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        logs.append({
          event: "operation.step",
          code: `STEP_${index}`,
          details: { index },
        }),
      ),
    );
    const entries = await logs.all();
    expect(entries).toHaveLength(50);
    expect(entries.map((entry) => entry.details?.index)).toEqual(
      Array.from({ length: 50 }, (_, index) => index),
    );
  });

  it("writes an explicit local snapshot without device tokens or raw printer host", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "menuqr-bridge-diagnostics-"),
    );
    const logs = new DiagnosticLog(join(directory, "logs"));
    await logs.append({ event: "runtime.state", state: "ready" });
    await Promise.all(
      Array.from({ length: 225 }, (_, index) =>
        logs.append({
          event: "debug.step",
          code: `STEP_${index}`,
          details: { index },
        }),
      ),
    );
    const service = new DiagnosticsService(
      directory,
      "0.1.0",
      {
        read: jest.fn().mockResolvedValue({
          deviceId: "device_1",
          token: "secret-device-token-should-not-export",
          restaurant: { id: "restaurant_1", displayName: "Weingut Jäckel" },
          issuedAt: "2026-08-22T12:00:00.000Z",
          appVersion: "0.1.0",
        }),
      } as any,
      {
        diagnostics: jest.fn().mockReturnValue({
          runtime: { kind: "ready" },
          recentJobIds: ["job_1"],
          recentErrorCodes: [],
          recentFailedJobIds: [],
        }),
      } as any,
      {
        diagnostics: jest.fn().mockResolvedValue({
          adapterId: "printer.star-tsp1000-lan",
          configured: true,
          configuration: { hostFingerprint: "abc123", port: 9100 },
          lastHealth: null,
          recentJobs: [],
        }),
      } as any,
      { isEnabled: jest.fn().mockReturnValue(true) },
      logs,
    );
    const snapshot = await service.snapshot();
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("secret-device-token");
    expect(serialized).not.toContain("Weingut Jäckel");
    expect(serialized).not.toContain("restaurant_1");
    expect(serialized).not.toContain("device_1");
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.logs).toHaveLength(200);
    await expect(service.export()).resolves.toMatchObject({
      fileName: expect.stringContaining("menuqr-bridge-diagnostics-"),
    });
    const { fileName } = await service.export();
    const file = await readFile(join(directory, fileName), "utf8");
    expect(file).not.toContain("secret-device-token");
    expect(file).not.toContain("192.168.");
    expect(file).toContain("hostFingerprint");

    const explicitPath = join(directory, "export", "complete-log.json");
    await expect(service.export(explicitPath)).resolves.toEqual({
      fileName: "complete-log.json",
    });
    const complete = JSON.parse(await readFile(explicitPath, "utf8")) as {
      schemaVersion: number;
      logs: unknown[];
    };
    expect(complete.schemaVersion).toBe(2);
    expect(complete.logs).toHaveLength(226);
  });
});
