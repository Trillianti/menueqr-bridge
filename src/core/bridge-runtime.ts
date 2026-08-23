import type { BridgeCredential } from "./credential-store";
import type {
  HeartbeatRequest,
  HeartbeatResponse,
  RedactedAdapterHealth,
} from "../contracts";
import type { DesktopRuntimeState } from "./runtime-state";
import { runtimeState } from "./runtime-state";
import type { RuntimeStore, StoredRuntimeState } from "./runtime-store";

export type RuntimePollResult =
  | {
      kind: "job";
      job: {
        id: string;
        type: string;
        schemaVersion: number;
        payload: unknown;
        expiresAt: string;
      };
      lease: { token: string; expiresAt: string };
    }
  | { kind: "timeout"; retryAfterMs: number }
  | { kind: "update_required"; code: string; message: string };

export type BridgeRuntimeClient = {
  heartbeat(
    credential: BridgeCredential,
    request: HeartbeatRequest,
    signal: AbortSignal,
  ): Promise<HeartbeatResponse>;
  nextJob(
    credential: BridgeCredential,
    signal: AbortSignal,
  ): Promise<RuntimePollResult>;
};

export type JobExecutionPort = {
  handoff(
    credential: BridgeCredential,
    job: Extract<RuntimePollResult, { kind: "job" }>,
    signal: AbortSignal,
  ): Promise<JobExecutionOutcome>;
  readiness?(): Promise<ExecutionReadiness>;
  adapterHealth?(): Promise<readonly RedactedAdapterHealth[]>;
};

export type ExecutionReadiness =
  { ready: true } | { ready: false; code: string; message: string };

export type JobExecutionOutcome =
  | { kind: "succeeded"; jobId: string }
  | { kind: "ack_pending"; jobId: string; code: string; message: string }
  | {
      kind: "retryable_failure" | "terminal_failure";
      jobId: string;
      code: string;
      message: string;
    };

export type BridgeRuntimeOptions = {
  appVersion: string;
  heartbeatFallbackSeconds: number;
  onRevoked?: () => void | Promise<void>;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<boolean>;
  log?: (event: {
    event: string;
    code?: string;
    message?: string;
    jobId?: string;
    state?: string;
  }) => void | Promise<void>;
};

export class BridgeRuntime {
  private state: DesktopRuntimeState = runtimeState("stopped");
  private controller: AbortController | null = null;
  private readonly backgroundTasks = new Set<Promise<void>>();
  private pendingPersistence: Promise<void> = Promise.resolve();
  private paused = false;
  private persisted: StoredRuntimeState = {
    paused: false,
    lastState: null,
    recentJobIds: [],
    recentErrorCodes: [],
    recentFailedJobIds: [],
  };

  constructor(
    private readonly client: BridgeRuntimeClient,
    private readonly store: Pick<RuntimeStore, "read" | "write">,
    private readonly executor: JobExecutionPort,
    private readonly options: BridgeRuntimeOptions,
  ) {}

  async restore(): Promise<DesktopRuntimeState> {
    const stored = await this.store.read();
    this.persisted = {
      paused: stored.paused === true,
      lastState: stored.lastState ?? null,
      recentJobIds: Array.isArray(stored.recentJobIds)
        ? stored.recentJobIds.slice(-20)
        : [],
      recentErrorCodes: Array.isArray(stored.recentErrorCodes)
        ? stored.recentErrorCodes.slice(-20)
        : [],
      recentFailedJobIds: Array.isArray(stored.recentFailedJobIds)
        ? stored.recentFailedJobIds.slice(-20)
        : [],
    };
    this.paused = this.persisted.paused;
    this.state = this.paused
      ? runtimeState("paused")
      : (this.persisted.lastState ?? runtimeState("stopped"));
    return this.state;
  }

  snapshot(): DesktopRuntimeState {
    return this.state;
  }
  diagnostics(): Pick<
    StoredRuntimeState,
    "recentJobIds" | "recentErrorCodes" | "recentFailedJobIds"
  > & { runtime: DesktopRuntimeState } {
    return {
      runtime: this.state,
      recentJobIds: [...this.persisted.recentJobIds],
      recentErrorCodes: [...this.persisted.recentErrorCodes],
      recentFailedJobIds: [...this.persisted.recentFailedJobIds],
    };
  }
  isRunning(): boolean {
    return this.controller !== null && !this.controller.signal.aborted;
  }

  async start(
    credential: BridgeCredential | null,
  ): Promise<DesktopRuntimeState> {
    if (!credential) return this.transition("stopped");
    if (this.paused) return this.transition("paused");
    if (this.isRunning()) return this.state;
    if (!(await this.isExecutionReady())) return this.state;
    this.controller = new AbortController();
    this.transition("starting");
    this.track(this.heartbeatLoop(credential, this.controller.signal));
    this.track(this.pollLoop(credential, this.controller.signal));
    return this.state;
  }

  async setPaused(paused: boolean): Promise<DesktopRuntimeState> {
    this.paused = paused;
    if (paused) {
      this.stop();
      return this.transition("paused");
    }
    return this.transition("stopped");
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
  }

  async shutdown(timeoutMs = 2_000): Promise<void> {
    this.stop();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.backgroundTasks]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    await this.queuePersist();
  }

  private async heartbeatLoop(
    credential: BridgeCredential,
    signal: AbortSignal,
  ): Promise<void> {
    let intervalSeconds = this.options.heartbeatFallbackSeconds;
    while (!signal.aborted && this.canPoll()) {
      try {
        const response = await this.client.heartbeat(
          credential,
          await this.heartbeatRequest(),
          signal,
        );
        intervalSeconds = response.heartbeatIntervalSeconds || intervalSeconds;
        if (!this.applyHeartbeat(response)) return;
      } catch (error) {
        if (signal.aborted) return;
        this.transition("offline", "NETWORK_UNAVAILABLE", redactedError(error));
        intervalSeconds = Math.min(
          60,
          Math.max(intervalSeconds * 2, this.options.heartbeatFallbackSeconds),
        );
      }
      const waited = await (this.options.wait ?? waitFor)(
        intervalSeconds * 1_000,
        signal,
      );
      if (!waited) return;
    }
  }

  private async pollLoop(
    credential: BridgeCredential,
    signal: AbortSignal,
  ): Promise<void> {
    let retryMs = 1_000;
    while (!signal.aborted && this.canPoll()) {
      try {
        if (!(await this.isExecutionReady())) return;
        this.transition("polling");
        const result = await this.client.nextJob(credential, signal);
        if (signal.aborted) return;
        retryMs = 1_000;
        if (result.kind === "timeout") {
          this.transition("ready");
          const waited = await (this.options.wait ?? waitFor)(
            result.retryAfterMs,
            signal,
          );
          if (!waited) return;
          continue;
        }
        if (result.kind === "update_required") {
          this.transition("update_required", result.code, result.message);
          this.stop();
          return;
        }
        this.transition("processing");
        const outcome = await this.executor.handoff(credential, result, signal);
        await this.recordExecutionOutcome(outcome);
      } catch (error) {
        if (signal.aborted) return;
        const message = redactedError(error);
        const code = message.includes("auth")
          ? "AUTHENTICATION_ERROR"
          : "NETWORK_UNAVAILABLE";
        this.transition(
          code === "AUTHENTICATION_ERROR" ? "authentication_error" : "offline",
          code,
          message,
        );
        this.persisted.recentErrorCodes = [
          ...this.persisted.recentErrorCodes,
          code,
        ].slice(-20);
        await this.queuePersist();
        const waited = await (this.options.wait ?? waitFor)(
          jitter(retryMs),
          signal,
        );
        if (!waited) return;
        retryMs = Math.min(60_000, retryMs * 2);
      }
    }
  }

  private async heartbeatRequest(): Promise<HeartbeatRequest> {
    return {
      appVersion: this.options.appVersion,
      runtimeState: this.state.kind === "degraded" ? "degraded" : "ready",
      supportedContractVersions: [1],
      adapterHealth: await this.adapterHealth(),
      lastCompletedJobId: this.persisted.recentJobIds.at(-1) ?? null,
      lastFailedJobId: this.persisted.recentFailedJobIds.at(-1) ?? null,
      clientTimestamp: new Date().toISOString(),
    };
  }

  private async isExecutionReady(): Promise<boolean> {
    if (!this.executor.readiness) return true;
    try {
      const readiness = await this.executor.readiness();
      if (readiness.ready) return true;
      this.transition(
        "fatal_configuration_error",
        readiness.code,
        readiness.message,
      );
      return false;
    } catch {
      this.transition(
        "fatal_configuration_error",
        "PRINTER_CONFIGURATION_INVALID",
        "The local printer configuration cannot be used.",
      );
      return false;
    }
  }

  private async adapterHealth(): Promise<readonly RedactedAdapterHealth[]> {
    if (!this.executor.adapterHealth) return [];
    try {
      return await this.executor.adapterHealth();
    } catch {
      return [];
    }
  }

  private async recordExecutionOutcome(
    outcome: JobExecutionOutcome,
  ): Promise<void> {
    if (outcome.kind === "succeeded") {
      this.persisted.recentJobIds = [
        ...this.persisted.recentJobIds,
        outcome.jobId,
      ].slice(-20);
      await this.queuePersist();
      this.transition("ready");
      void this.options.log?.({
        event: "job.completed",
        jobId: outcome.jobId,
        state: outcome.kind,
      });
      return;
    }
    this.persisted.recentFailedJobIds = [
      ...this.persisted.recentFailedJobIds,
      outcome.jobId,
    ].slice(-20);
    this.persisted.recentErrorCodes = [
      ...this.persisted.recentErrorCodes,
      outcome.code,
    ].slice(-20);
    await this.queuePersist();
    this.transition("degraded", outcome.code, outcome.message);
    void this.options.log?.({
      event: "job.outcome",
      jobId: outcome.jobId,
      code: outcome.code,
      message: outcome.message,
      state: outcome.kind,
    });
  }

  private applyHeartbeat(response: HeartbeatResponse): boolean {
    if (response.runtime.kind === "feature_required") {
      this.transition(
        "feature_required",
        "PRO_REQUIRED",
        response.runtime.message,
      );
      this.stop();
      return false;
    }
    if (response.runtime.kind === "update_required") {
      this.transition(
        "update_required",
        "UPDATE_REQUIRED",
        response.runtime.message,
      );
      this.stop();
      return false;
    }
    if (response.runtime.kind === "revoked") {
      this.transition("revoked", "REVOKED", response.runtime.message);
      this.stop();
      void this.options.onRevoked?.();
      return false;
    }
    this.transition(
      response.runtime.kind === "degraded" ? "degraded" : "ready",
    );
    return true;
  }

  private canPoll(): boolean {
    return (
      !this.paused &&
      ![
        "feature_required",
        "update_required",
        "revoked",
        "authentication_error",
        "fatal_configuration_error",
      ].includes(this.state.kind)
    );
  }
  private transition(
    kind: DesktopRuntimeState["kind"],
    code?: string,
    message?: string,
  ): DesktopRuntimeState {
    this.state = runtimeState(kind, code, message);
    void this.options.log?.({
      event: "runtime.state",
      state: kind,
      ...(code ? { code } : {}),
      ...(message ? { message } : {}),
    });
    void this.queuePersist();
    return this.state;
  }

  private track(task: Promise<void>): void {
    this.backgroundTasks.add(task);
    void task.finally(() => this.backgroundTasks.delete(task));
  }

  private queuePersist(): Promise<void> {
    this.pendingPersistence = this.pendingPersistence
      .catch(() => undefined)
      .then(() => this.persist());
    return this.pendingPersistence;
  }

  private async persist(): Promise<void> {
    this.persisted = {
      ...this.persisted,
      paused: this.paused,
      lastState: this.state,
    };
    await this.store.write(this.persisted);
  }
}

function jitter(milliseconds: number): number {
  return (
    milliseconds +
    ((milliseconds * 17) % Math.max(1, Math.floor(milliseconds * 0.2)))
  );
}
function redactedError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Runtime request failed.";
  return message
    .replace(/(?:Bearer\s+)?[A-Za-z0-9._-]{20,}/g, "[redacted]")
    .replace(/\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[redacted]")
    .replace(/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, "[redacted]")
    .replace(/\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g, "[redacted]")
    .slice(0, 240);
}
function waitFor(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => cleanup(true), milliseconds);
    const onAbort = () => cleanup(false);
    const cleanup = (result: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    if (signal.aborted) cleanup(false);
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}
