import {
  BridgeRuntime,
  type ExecutionReadiness,
} from "../../src/core/bridge-runtime";

describe("bridge runtime", () => {
  const credential = {
    deviceId: "device_1",
    token: "never-in-state",
    restaurant: { id: "restaurant_1", displayName: "Weingut Jäckel" },
    issuedAt: "2026-08-22T12:00:00.000Z",
    appVersion: "0.1.0",
  };

  function setup() {
    const client = {
      heartbeat: jest.fn().mockResolvedValue({
        heartbeatIntervalSeconds: 30,
        runtime: { kind: "ready", message: "Ready" },
      }),
      nextJob: jest
        .fn()
        .mockResolvedValue({ kind: "timeout", retryAfterMs: 1 }),
    };
    const store = {
      read: jest.fn().mockResolvedValue({
        paused: false,
        lastState: null,
        recentJobIds: [],
        recentErrorCodes: [],
        recentFailedJobIds: [],
      }),
      write: jest.fn().mockResolvedValue(undefined),
    };
    const executor = {
      handoff: jest.fn().mockResolvedValue({
        kind: "succeeded",
        jobId: "job_1",
      }),
      readiness: undefined as (() => Promise<ExecutionReadiness>) | undefined,
      adapterHealth: jest.fn().mockResolvedValue([
        {
          adapterId: "printer.star-tsp1000-lan",
          status: "ready",
          code: "TCP_READY",
        },
      ]),
    };
    const onRevoked = jest.fn();
    const wait = jest.fn().mockResolvedValue(false);
    const runtime = new BridgeRuntime(client, store, executor, {
      appVersion: "0.1.0",
      heartbeatFallbackSeconds: 30,
      wait,
      onRevoked,
    });
    return { runtime, client, store, executor, onRevoked, wait };
  }

  it("starts only when paired and launches one heartbeat and one polling loop", async () => {
    const { runtime, client, wait } = setup();
    await runtime.restore();
    await expect(runtime.start(null)).resolves.toMatchObject({
      kind: "stopped",
    });
    await runtime.start(credential);
    await new Promise((resolve) => setImmediate(resolve));
    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(client.heartbeat.mock.calls[0]?.[1]).toEqual({
      appVersion: "0.1.0",
      runtimeState: "ready",
      supportedContractVersions: [1],
      adapterHealth: [
        {
          adapterId: "printer.star-tsp1000-lan",
          status: "ready",
          code: "TCP_READY",
        },
      ],
      lastCompletedJobId: null,
      lastFailedJobId: null,
      clientTimestamp: expect.any(String),
    });
    expect(client.heartbeat.mock.calls[0]?.[1]).not.toHaveProperty(
      "capabilities",
    );
    expect(client.nextJob).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(5_000, expect.any(AbortSignal));
    expect(JSON.stringify(runtime.snapshot())).not.toContain(credential.token);
    runtime.stop();
  });

  it("stops polling distinctly when the server requires Pro or an update", async () => {
    const { runtime, client } = setup();
    client.heartbeat.mockResolvedValueOnce({
      heartbeatIntervalSeconds: 30,
      runtime: {
        kind: "feature_required",
        message: "Pro required",
        requiredPlan: "pro",
      },
    });
    await runtime.start(credential);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runtime.snapshot()).toMatchObject({
      kind: "feature_required",
      code: "PRO_REQUIRED",
    });
    expect(runtime.isRunning()).toBe(false);
  });

  it("forgets the local pairing when the server revokes this device", async () => {
    const { runtime, client, onRevoked } = setup();
    client.heartbeat.mockResolvedValueOnce({
      heartbeatIntervalSeconds: 30,
      runtime: { kind: "revoked", message: "Device revoked" },
    });

    await runtime.start(credential);
    await new Promise((resolve) => setImmediate(resolve));

    expect(runtime.snapshot()).toMatchObject({ kind: "revoked", code: "REVOKED" });
    expect(runtime.isRunning()).toBe(false);
    expect(onRevoked).toHaveBeenCalledTimes(1);
  });

  it("hands a leased job to the fake execution port without printing", async () => {
    const { runtime, client, executor, store } = setup();
    client.nextJob.mockResolvedValueOnce({
      kind: "job",
      job: {
        id: "job_1",
        type: "kitchen_order",
        schemaVersion: 1,
        payload: { safe: true },
        expiresAt: "2026-08-22T12:30:00.000Z",
      },
      lease: { token: "lease-token", expiresAt: "2026-08-22T12:01:00.000Z" },
    });
    await runtime.start(credential);
    await new Promise((resolve) => setImmediate(resolve));
    expect(executor.handoff).toHaveBeenCalledWith(
      credential,
      expect.objectContaining({
        job: expect.objectContaining({ id: "job_1" }),
      }),
      expect.any(AbortSignal),
    );
    expect(store.write).toHaveBeenCalled();
    runtime.stop();
  });

  it("cancels active requests immediately on pause", async () => {
    const { runtime } = setup();
    await runtime.start(credential);
    await expect(runtime.setPaused(true)).resolves.toMatchObject({
      kind: "paused",
    });
    expect(runtime.isRunning()).toBe(false);
  });

  it("keeps checking authorization without polling jobs before the local execution route is configured", async () => {
    const { runtime, client, executor } = setup();
    executor.readiness = jest.fn().mockResolvedValue({
      ready: false,
      code: "PRINTER_NOT_CONFIGURED",
      message: "Configure the printer.",
    });
    await runtime.start(credential);
    await new Promise((resolve) => setImmediate(resolve));
    expect(runtime.snapshot()).toMatchObject({
      kind: "fatal_configuration_error",
      code: "PRINTER_NOT_CONFIGURED",
    });
    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(client.nextJob).not.toHaveBeenCalled();

    (executor.readiness as jest.Mock).mockResolvedValue({ ready: true });
    await runtime.start(credential);
    await new Promise((resolve) => setImmediate(resolve));
    expect(client.heartbeat).toHaveBeenCalledTimes(2);
    expect(client.nextJob).toHaveBeenCalledTimes(1);
    runtime.stop();
  });

  it("persists a failed job reference instead of presenting it as completed", async () => {
    const { runtime, client, executor, store } = setup();
    executor.handoff.mockResolvedValueOnce({
      kind: "retryable_failure",
      jobId: "job_failed",
      code: "PRINTER_OFFLINE",
      message: "Printer is unavailable.",
    });
    client.nextJob.mockResolvedValueOnce({
      kind: "job",
      job: {
        id: "job_failed",
        type: "kitchen_order",
        schemaVersion: 1,
        payload: { safe: true },
        expiresAt: "2026-08-22T12:30:00.000Z",
      },
      lease: { token: "lease-token", expiresAt: "2026-08-22T12:01:00.000Z" },
    });
    await runtime.start(credential);
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.write).toHaveBeenCalledWith(
      expect.objectContaining({
        recentFailedJobIds: ["job_failed"],
        recentJobIds: [],
        recentErrorCodes: ["PRINTER_OFFLINE"],
      }),
    );
    runtime.stop();
  });
});
