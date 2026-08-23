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
    });
    const entries = await logs.recent();
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain("rawtoken_");
    expect(serialized).not.toContain("192.168.1.42");
    expect(serialized).not.toContain("kitchen.local");
    expect(serialized).not.toContain("guest@example.com");
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "runtime.state" }),
        expect.objectContaining({ event: "job.outcome", jobId: "job_1" }),
      ]),
    );
  });

  it("writes an explicit local snapshot without device tokens or raw printer host", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "menuqr-bridge-diagnostics-"),
    );
    const logs = new DiagnosticLog(join(directory, "logs"));
    await logs.append({ event: "runtime.state", state: "ready" });
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
    expect(JSON.stringify(snapshot)).not.toContain("secret-device-token");
    await expect(service.export()).resolves.toMatchObject({
      fileName: expect.stringContaining("menuqr-bridge-diagnostics-"),
    });
    const { fileName } = await service.export();
    const file = await readFile(join(directory, fileName), "utf8");
    expect(file).not.toContain("secret-device-token");
    expect(file).not.toContain("192.168.");
    expect(file).toContain("hostFingerprint");
  });
});
