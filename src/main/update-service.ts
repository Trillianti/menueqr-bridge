import type { ProgressInfo, UpdateInfo } from "electron-updater";

import type { DiagnosticLogEvent } from "./diagnostic-log";

export type BridgeUpdateSnapshot =
  | { kind: "disabled"; currentVersion: string }
  | { kind: "idle"; currentVersion: string }
  | { kind: "checking"; currentVersion: string }
  | { kind: "downloading"; currentVersion: string; version: string; percent: number }
  | { kind: "downloaded"; currentVersion: string; version: string }
  | { kind: "error"; currentVersion: string };

export type UpdateClient = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(
    event:
      | "checking-for-update"
      | "update-not-available"
      | "update-available"
      | "download-progress"
      | "update-downloaded"
      | "error",
    listener: (...args: unknown[]) => void,
  ): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
};

export type UpdateServiceOptions = {
  currentVersion: string;
  enabled: boolean;
  checkIntervalMs?: number;
  onDownloaded?: (version: string) => void | Promise<void>;
  onEvent?: (event: DiagnosticLogEvent) => void | Promise<void>;
};

export class BridgeUpdateService {
  private snapshotState: BridgeUpdateSnapshot;
  private started = false;
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly updater: UpdateClient,
    private readonly options: UpdateServiceOptions,
  ) {
    this.snapshotState = options.enabled
      ? { kind: "idle", currentVersion: options.currentVersion }
      : { kind: "disabled", currentVersion: options.currentVersion };
  }

  snapshot(): BridgeUpdateSnapshot {
    return this.snapshotState;
  }

  start(): void {
    if (this.started || !this.options.enabled) return;
    this.started = true;
    this.updater.autoDownload = true;
    // The operator chooses when to restart. A kitchen-service process must not
    // silently install an update while staff are working.
    this.updater.autoInstallOnAppQuit = false;
    this.registerEvents();
    void this.check();
    this.checkTimer = setInterval(
      () => void this.check(),
      this.options.checkIntervalMs ?? 6 * 60 * 60 * 1_000,
    );
    this.checkTimer.unref?.();
  }

  stop(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
  }

  async check(): Promise<BridgeUpdateSnapshot> {
    if (!this.options.enabled) return this.snapshot();
    if (
      this.snapshotState.kind === "checking" ||
      this.snapshotState.kind === "downloading" ||
      this.snapshotState.kind === "downloaded"
    ) {
      return this.snapshot();
    }
    this.snapshotState = {
      kind: "checking",
      currentVersion: this.options.currentVersion,
    };
    await this.emit("update.checking");
    try {
      await this.updater.checkForUpdates();
    } catch {
      this.snapshotState = {
        kind: "error",
        currentVersion: this.options.currentVersion,
      };
      await this.emit("update.check_failed", "CHECK_FAILED");
    }
    return this.snapshot();
  }

  install(): boolean {
    if (this.snapshotState.kind !== "downloaded") return false;
    void this.emit("update.install_requested", "DOWNLOADED");
    this.updater.quitAndInstall(false, true);
    return true;
  }

  private registerEvents(): void {
    this.updater.on("checking-for-update", () => {
      this.snapshotState = {
        kind: "checking",
        currentVersion: this.options.currentVersion,
      };
    });
    this.updater.on("update-not-available", () => {
      this.snapshotState = {
        kind: "idle",
        currentVersion: this.options.currentVersion,
      };
      void this.emit("update.not_available");
    });
    this.updater.on("update-available", (info: unknown) => {
      const version = updateVersion(info) ?? this.options.currentVersion;
      this.snapshotState = {
        kind: "downloading",
        currentVersion: this.options.currentVersion,
        version,
        percent: 0,
      };
      void this.emit("update.available", "AVAILABLE", version);
    });
    this.updater.on("download-progress", (progress: unknown) => {
      const previous = this.snapshotState;
      if (previous.kind !== "downloading") return;
      this.snapshotState = {
        ...previous,
        percent: boundedPercent((progress as ProgressInfo).percent),
      };
    });
    this.updater.on("update-downloaded", (info: unknown) => {
      const version = updateVersion(info) ?? this.options.currentVersion;
      this.snapshotState = {
        kind: "downloaded",
        currentVersion: this.options.currentVersion,
        version,
      };
      void this.emit("update.downloaded", "DOWNLOADED", version);
      void Promise.resolve(this.options.onDownloaded?.(version)).catch(
        () => undefined,
      );
    });
    this.updater.on("error", () => {
      this.snapshotState = {
        kind: "error",
        currentVersion: this.options.currentVersion,
      };
      void this.emit("update.error", "UPDATER_ERROR");
    });
  }

  private async emit(
    event: string,
    code?: string,
    version?: string,
  ): Promise<void> {
    await this.options.onEvent?.({
      event,
      ...(code ? { code } : {}),
      ...(version ? { state: version } : {}),
    });
  }
}

function updateVersion(value: unknown): string | null {
  const version = (value as UpdateInfo | undefined)?.version;
  return typeof version === "string" && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)
    ? version
    : null;
}

function boundedPercent(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.round(Math.max(0, Math.min(100, numeric)));
}
