import { BridgeUpdateService, type UpdateClient } from "../../src/main/update-service";

class FakeUpdater implements UpdateClient {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  checkCalls = 0;
  installCalls: Array<[boolean | undefined, boolean | undefined]> = [];
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  async checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1;
    return undefined;
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installCalls.push([isSilent, isForceRunAfter]);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

describe("BridgeUpdateService", () => {
  it("stays disabled when the installed app has no release update manifest", async () => {
    const updater = new FakeUpdater();
    const service = new BridgeUpdateService(updater, {
      currentVersion: "0.1.0",
      enabled: false,
    });

    service.start();
    await service.check();

    expect(service.snapshot()).toEqual({ kind: "disabled", currentVersion: "0.1.0" });
    expect(updater.checkCalls).toBe(0);
    expect(updater.autoDownload).toBe(false);
  });

  it("downloads a verified release in the background and waits for an explicit restart", async () => {
    const updater = new FakeUpdater();
    const onDownloaded = jest.fn();
    const onEvent = jest.fn();
    const service = new BridgeUpdateService(updater, {
      currentVersion: "0.1.0",
      enabled: true,
      onDownloaded,
      onEvent,
    });

    service.start();
    await Promise.resolve();
    updater.emit("update-available", { version: "0.2.0" });
    updater.emit("download-progress", { percent: 47.7 });

    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(service.snapshot()).toEqual({
      kind: "downloading",
      currentVersion: "0.1.0",
      version: "0.2.0",
      percent: 48,
    });

    updater.emit("update-downloaded", { version: "0.2.0" });
    expect(service.snapshot()).toEqual({
      kind: "downloaded",
      currentVersion: "0.1.0",
      version: "0.2.0",
    });
    expect(onDownloaded).toHaveBeenCalledWith("0.2.0");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "update.download_progress",
        details: { percent: 48 },
      }),
    );
    expect(service.install()).toBe(true);
    expect(service.snapshot()).toEqual({
      kind: "installing",
      currentVersion: "0.1.0",
      version: "0.2.0",
    });
    expect(updater.installCalls).toEqual([[true, true]]);
  });

  it("does not restart when no update has been downloaded", () => {
    const updater = new FakeUpdater();
    const service = new BridgeUpdateService(updater, {
      currentVersion: "0.1.0",
      enabled: true,
    });

    expect(service.install()).toBe(false);
    expect(updater.installCalls).toEqual([]);
  });

  it("returns to an actionable error state when the installer cannot start", () => {
    const updater = new FakeUpdater();
    updater.quitAndInstall = jest.fn(() => {
      throw new Error("installer failed");
    });
    const service = new BridgeUpdateService(updater, {
      currentVersion: "0.1.0",
      enabled: true,
    });
    service.start();
    updater.emit("update-available", { version: "0.2.0" });
    updater.emit("update-downloaded", { version: "0.2.0" });
    expect(service.install()).toBe(false);
    expect(service.snapshot()).toEqual({
      kind: "error",
      currentVersion: "0.1.0",
      code: "INSTALL_LAUNCH_FAILED",
    });
  });

  it("checks periodically without overlapping an active download", async () => {
    jest.useFakeTimers();
    const updater = new FakeUpdater();
    const service = new BridgeUpdateService(updater, {
      currentVersion: "0.1.0",
      enabled: true,
      checkIntervalMs: 60_000,
    });

    service.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(updater.checkCalls).toBe(1);

    updater.emit("update-not-available");
    await jest.advanceTimersByTimeAsync(60_000);
    expect(updater.checkCalls).toBe(2);

    updater.emit("update-available", { version: "0.2.0" });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(updater.checkCalls).toBe(2);

    service.stop();
    updater.emit("update-not-available");
    await jest.advanceTimersByTimeAsync(60_000);
    expect(updater.checkCalls).toBe(2);
    jest.useRealTimers();
  });
});
