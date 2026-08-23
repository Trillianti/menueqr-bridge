import { promises as fs } from "node:fs";
import { arch, platform, release } from "node:os";
import { join } from "node:path";

import type { BridgeRuntime } from "../core/bridge-runtime";
import type { CredentialStore } from "../core/credential-store";
import type { AutostartAdapter } from "./autostart";
import type { DiagnosticLog, DiagnosticLogEntry } from "./diagnostic-log";
import type { KitchenRouteService } from "./kitchen-route-service";

export type BridgeDiagnosticsSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  application: {
    appVersion: string;
    electronVersion: string | undefined;
    platform: string;
    release: string;
    architecture: string;
  };
  pairedRestaurant: { id: string; displayName: string } | null;
  deviceId: string | null;
  autostartEnabled: boolean;
  runtime: ReturnType<BridgeRuntime["diagnostics"]>;
  printer: Awaited<ReturnType<KitchenRouteService["diagnostics"]>>;
  logs: DiagnosticLogEntry[];
};

export class DiagnosticsService {
  constructor(
    private readonly directory: string,
    private readonly appVersion: string,
    private readonly credentials: CredentialStore,
    private readonly runtime: BridgeRuntime,
    private readonly route: KitchenRouteService,
    private readonly autostart: Pick<AutostartAdapter, "isEnabled">,
    private readonly logs: DiagnosticLog,
  ) {}

  async snapshot(): Promise<BridgeDiagnosticsSnapshot> {
    const credential = await this.credentials.read().catch(() => null);
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      application: {
        appVersion: this.appVersion,
        electronVersion: process.versions.electron,
        platform: platform(),
        release: release(),
        architecture: arch(),
      },
      pairedRestaurant: credential?.restaurant ?? null,
      deviceId: credential?.deviceId ?? null,
      autostartEnabled: this.autostart.isEnabled(),
      runtime: this.runtime.diagnostics(),
      printer: await this.route.diagnostics(),
      logs: await this.logs.recent(),
    };
  }

  async export(): Promise<{ fileName: string }> {
    const snapshot = await this.snapshot();
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const fileName = `menuqr-bridge-diagnostics-${safeTimestamp(snapshot.generatedAt)}.json`;
    await fs.writeFile(
      join(this.directory, fileName),
      JSON.stringify(snapshot, null, 2),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    return { fileName };
  }

  path(): string {
    return this.directory;
  }
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
