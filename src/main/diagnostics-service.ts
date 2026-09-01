import { promises as fs } from "node:fs";
import { arch, platform, release } from "node:os";
import { basename, dirname, join } from "node:path";

import type { BridgeRuntime } from "../core/bridge-runtime";
import type { CredentialStore } from "../core/credential-store";
import type { AutostartAdapter } from "./autostart";
import {
  fingerprintDiagnosticId,
  type DiagnosticLog,
  type DiagnosticLogEntry,
} from "./diagnostic-log";
import type { KitchenRouteService } from "./kitchen-route-service";

export type BridgeDiagnosticsSnapshot = {
  schemaVersion: 2;
  generatedAt: string;
  application: {
    appVersion: string;
    electronVersion: string | undefined;
    platform: string;
    release: string;
    architecture: string;
  };
  pairedRestaurant: { fingerprint: string } | null;
  deviceFingerprint: string | null;
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

  async snapshot(
    includeCompleteLog = false,
  ): Promise<BridgeDiagnosticsSnapshot> {
    const credential = await this.credentials.read().catch(() => null);
    const runtime = this.runtime.diagnostics();
    const printer = await this.route.diagnostics();
    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      application: {
        appVersion: this.appVersion,
        electronVersion: process.versions.electron,
        platform: platform(),
        release: release(),
        architecture: arch(),
      },
      pairedRestaurant: credential
        ? { fingerprint: fingerprintDiagnosticId(credential.restaurant.id) }
        : null,
      deviceFingerprint: credential
        ? fingerprintDiagnosticId(credential.deviceId)
        : null,
      autostartEnabled: this.autostart.isEnabled(),
      runtime: {
        ...runtime,
        recentJobIds: runtime.recentJobIds.map(fingerprintDiagnosticId),
        recentFailedJobIds: runtime.recentFailedJobIds.map(
          fingerprintDiagnosticId,
        ),
      },
      printer: {
        ...printer,
        recentJobs: printer.recentJobs.map((job) => ({
          ...job,
          jobId: fingerprintDiagnosticId(job.jobId),
        })),
      },
      logs: includeCompleteLog
        ? await this.logs.all()
        : await this.logs.recent(200),
    };
  }

  suggestedFileName(now = new Date()): string {
    return `menuqr-bridge-diagnostics-${safeTimestamp(now.toISOString())}.json`;
  }

  async export(destinationPath?: string): Promise<{ fileName: string }> {
    const snapshot = await this.snapshot(true);
    const fileName = this.suggestedFileName(new Date(snapshot.generatedAt));
    const outputPath = destinationPath ?? join(this.directory, fileName);
    await fs.mkdir(destinationPath ? dirname(destinationPath) : this.directory, {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(
      outputPath,
      JSON.stringify(snapshot, null, 2),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    return { fileName: destinationPath ? basename(outputPath) : fileName };
  }

  path(): string {
    return this.directory;
  }
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
