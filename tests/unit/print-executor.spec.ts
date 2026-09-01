import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ExecutionLedger } from "../../src/core/execution-ledger";
import { PrintExecutor } from "../../src/core/print-executor";

const credential = {
  deviceId: "device_1",
  token: "device-token",
  restaurant: { id: "restaurant_1", displayName: "Weingut Jäckel" },
  issuedAt: "2026-08-22T12:00:00.000Z",
  appVersion: "0.1.0",
};
const job = {
  kind: "job" as const,
  job: {
    id: "job_1",
    type: "kitchen_order",
    schemaVersion: 1,
    expiresAt: "2026-08-22T12:30:00.000Z",
    payload: {
      schemaVersion: 1,
      jobType: "kitchen_order",
      jobId: "job_1",
      restaurantId: "restaurant_1",
      restaurantName: "Weingut Jäckel",
      orderId: "order_1",
      orderReference: "A-100",
      tableNumber: 7,
      createdAt: "2026-08-22T12:00:00.000Z",
      currency: "EUR",
      notes: null,
      items: [
        {
          itemId: "item_1",
          name: "Käse",
          variation: null,
          quantity: 1,
          unitPrice: "12.00",
          lineTotal: "12.00",
        },
      ],
      totalAmount: "12.00",
    },
  },
  lease: { token: "lease-token", expiresAt: "2026-08-22T12:01:00.000Z" },
};

describe("print executor", () => {
  async function setup() {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-exec-"));
    const adapter = {
      id: "test",
      version: 1,
      capabilities: ["printer.kitchen"] as const,
      supportedJobSchemas: [1] as const,
      validateConfiguration: (value: unknown) => value as {},
      redactConfiguration: () => ({}),
      healthCheck: jest.fn(),
      test: jest.fn().mockResolvedValue({
        status: "succeeded",
        code: "PRINT_WRITTEN",
        message: "test done",
      }),
      execute: jest.fn().mockResolvedValue({
        status: "succeeded",
        code: "PRINT_WRITTEN",
        message: "done",
        metadata: { bytesWritten: 10 },
      }),
    };
    const completion = {
      acknowledge: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const executor = new PrintExecutor(
      adapter,
      {},
      {
        commandMode: "esc_pos",
        paperWidthMm: 80,
        encoding: "cp437",
        cutAfterPrint: true,
      },
      new ExecutionLedger(join(directory, "ledger.json")),
      completion,
    );
    return { adapter, completion, executor };
  }

  it("writes once and retries only acknowledgement after ack loss", async () => {
    const { adapter, completion, executor } = await setup();
    completion.acknowledge.mockRejectedValueOnce(new Error("ACK_UNAVAILABLE"));
    await executor.handoff(credential, job, new AbortController().signal);
    await executor.handoff(credential, job, new AbortController().signal);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(completion.acknowledge).toHaveBeenCalledTimes(2);
  });

  it("fails terminally for a different payload replay instead of printing", async () => {
    const { adapter, completion, executor } = await setup();
    await executor.handoff(credential, job, new AbortController().signal);
    const mismatch = {
      ...job,
      job: {
        ...job.job,
        payload: { ...job.job.payload, totalAmount: "13.00" },
      },
    };
    await executor.handoff(credential, mismatch, new AbortController().signal);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(completion.fail).toHaveBeenCalledWith(
      credential,
      mismatch,
      "terminal_failure",
      "PAYLOAD_INTEGRITY_MISMATCH",
      expect.any(String),
      expect.any(AbortSignal),
    );
  });

  it("reports retryable printer failure without recording a physical write", async () => {
    const { adapter, completion, executor } = await setup();
    adapter.execute.mockResolvedValueOnce({
      status: "retryable_failure",
      code: "PRINTER_OFFLINE",
      message: "offline",
    });
    await executor.handoff(credential, job, new AbortController().signal);
    expect(completion.fail).toHaveBeenCalledWith(
      credential,
      job,
      "retryable_failure",
      "PRINTER_OFFLINE",
      "offline",
      expect.any(AbortSignal),
    );
  });

  it("uses the adapter-owned static test path for a cloud test-print job", async () => {
    const { adapter, completion, executor } = await setup();
    const testJob = {
      ...job,
      job: { ...job.job, id: "test_job_1", type: "test_print", payload: {} },
    };
    await expect(
      executor.handoff(credential, testJob, new AbortController().signal),
    ).resolves.toEqual({ kind: "succeeded", jobId: "test_job_1" });
    expect(adapter.test).toHaveBeenCalledTimes(1);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(completion.acknowledge).toHaveBeenCalledWith(
      credential,
      testJob,
      {},
      expect.any(AbortSignal),
    );
  });

  it("supports an adapter-specific text renderer for Windows printing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-text-"));
    const adapter = {
      id: "windows-test",
      version: 1,
      capabilities: ["printer.kitchen"] as const,
      supportedJobSchemas: [1] as const,
      validateConfiguration: (value: unknown) => value as {},
      redactConfiguration: () => ({}),
      healthCheck: jest.fn(),
      execute: jest.fn().mockResolvedValue({
        status: "succeeded",
        code: "WINDOWS_PRINT_JOB_ACCEPTED",
        message: "accepted",
      }),
    };
    const completion = {
      acknowledge: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const renderer = jest.fn(() => Buffer.from("TISCH 7\r\n", "utf8"));
    const executor = new PrintExecutor(
      adapter,
      {},
      {
        commandMode: "star_line",
        paperWidthMm: 80,
        encoding: "cp437",
        cutAfterPrint: true,
      },
      new ExecutionLedger(join(directory, "ledger.json")),
      completion,
      renderer,
    );
    await executor.handoff(credential, job, new AbortController().signal);
    expect(renderer).toHaveBeenCalledWith(job.job.payload, expect.any(Object));
    expect(adapter.execute).toHaveBeenCalledWith(
      Buffer.from("TISCH 7\r\n", "utf8"),
      {},
      expect.any(AbortSignal),
    );
  });
});
