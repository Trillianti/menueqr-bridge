import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AdapterExecutionResult } from "../../src/contracts";
import { ExecutionLedger } from "../../src/core/execution-ledger";
import { PrintExecutor } from "../../src/core/print-executor";

const credential = {
  deviceId: "device-scenario",
  token: "device-token-kept-out-of-output",
  restaurant: { id: "restaurant-scenario", displayName: "Testküche" },
  issuedAt: "2026-08-28T10:00:00.000Z",
  appVersion: "0.1.1",
};

const renderOptions = {
  commandMode: "star_line" as const,
  paperWidthMm: 80 as const,
  encoding: "windows1252" as const,
  cutAfterPrint: true,
  timeZone: "Europe/Vienna",
};

describe("order delivery reliability scenario matrix", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "menuqr-delivery-matrix-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("prints 40 distinct queued orders once and suppresses every exact replay", async () => {
    const harness = createHarness(join(directory, "ledger.json"));
    const jobs = Array.from({ length: 40 }, (_, index) => leasedJob(index + 1));

    for (const job of jobs) {
      await expect(
        harness.executor.handoff(credential, job, new AbortController().signal),
      ).resolves.toEqual({ kind: "succeeded", jobId: job.job.id });
    }
    for (const job of [...jobs].reverse()) {
      await expect(
        harness.executor.handoff(credential, job, new AbortController().signal),
      ).resolves.toEqual({ kind: "succeeded", jobId: job.job.id });
    }

    expect(harness.adapter.execute).toHaveBeenCalledTimes(40);
    expect(harness.completion.acknowledge).toHaveBeenCalledTimes(40);
    expect(harness.completion.fail).not.toHaveBeenCalled();
    expect(new Set(harness.printedReferences).size).toBe(40);
  });

  it("keeps deduplication after an application restart", async () => {
    const ledgerPath = join(directory, "ledger.json");
    const first = createHarness(ledgerPath);
    const jobs = [leasedJob(1), leasedJob(2), leasedJob(3)];
    for (const job of jobs) {
      await first.executor.handoff(
        credential,
        job,
        new AbortController().signal,
      );
    }

    const restarted = createHarness(ledgerPath);
    for (const job of jobs) {
      await restarted.executor.handoff(
        credential,
        job,
        new AbortController().signal,
      );
    }

    expect(first.adapter.execute).toHaveBeenCalledTimes(3);
    expect(restarted.adapter.execute).not.toHaveBeenCalled();
    expect(restarted.completion.acknowledge).not.toHaveBeenCalled();
  });

  it("recovers acknowledgement after restart without printing the bon again", async () => {
    const ledgerPath = join(directory, "ledger.json");
    const first = createHarness(ledgerPath);
    first.completion.acknowledge.mockRejectedValueOnce(
      new Error("ACK_UNAVAILABLE"),
    );
    const job = leasedJob(7);

    await expect(
      first.executor.handoff(credential, job, new AbortController().signal),
    ).resolves.toMatchObject({ kind: "ack_pending" });

    const restarted = createHarness(ledgerPath);
    await expect(
      restarted.executor.handoff(
        credential,
        { ...job, lease: { ...job.lease, token: "replacement-lease" } },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ kind: "succeeded", jobId: job.job.id });

    expect(first.adapter.execute).toHaveBeenCalledTimes(1);
    expect(restarted.adapter.execute).not.toHaveBeenCalled();
    expect(restarted.completion.acknowledge).toHaveBeenCalledTimes(1);
  });

  it("retries a confirmed pre-write printer failure and then succeeds once", async () => {
    const harness = createHarness(join(directory, "ledger.json"));
    harness.adapter.execute
      .mockResolvedValueOnce({
        status: "retryable_failure",
        code: "PRINTER_OFFLINE",
        message: "Printer is offline.",
      })
      .mockResolvedValueOnce(success());
    const job = leasedJob(9);

    await expect(
      harness.executor.handoff(credential, job, new AbortController().signal),
    ).resolves.toMatchObject({
      kind: "retryable_failure",
      code: "PRINTER_OFFLINE",
    });
    await expect(
      harness.executor.handoff(
        credential,
        { ...job, lease: { ...job.lease, token: "second-lease" } },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ kind: "succeeded", jobId: job.job.id });

    expect(harness.adapter.execute).toHaveBeenCalledTimes(2);
    expect(harness.completion.fail).toHaveBeenCalledTimes(1);
    expect(harness.completion.acknowledge).toHaveBeenCalledTimes(1);
  });

  it("never prints a changed payload under an already-known job ID", async () => {
    const harness = createHarness(join(directory, "ledger.json"));
    const original = leasedJob(11);
    await harness.executor.handoff(
      credential,
      original,
      new AbortController().signal,
    );
    const corrupted = {
      ...original,
      job: {
        ...original.job,
        payload: { ...original.job.payload, tableNumber: 499 },
      },
    };

    await expect(
      harness.executor.handoff(
        credential,
        corrupted,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      kind: "terminal_failure",
      code: "PAYLOAD_INTEGRITY_MISMATCH",
    });

    expect(harness.adapter.execute).toHaveBeenCalledTimes(1);
    expect(harness.completion.fail).toHaveBeenCalledWith(
      credential,
      corrupted,
      "terminal_failure",
      "PAYLOAD_INTEGRITY_MISMATCH",
      expect.any(String),
      expect.any(AbortSignal),
    );
  });

  it("prints a follow-up as a separate linked bon containing only new positions", async () => {
    const harness = createHarness(join(directory, "ledger.json"));
    const first = leasedJob(20);
    const followUpBase = leasedJob(21);
    const followUp = {
      ...followUpBase,
      job: {
        ...followUpBase.job,
        payload: {
          ...followUpBase.job.payload,
          orderKind: "additional",
          serviceSequence: 2,
          rootOrderReference: first.job.payload.orderReference,
          previousOrderReference: first.job.payload.orderReference,
          items: [
            {
              itemId: "follow-up-drink",
              name: "Traubensaft",
              variation: null,
              notes: null,
              quantity: 2,
              unitPrice: "4.20",
              lineTotal: "8.40",
            },
          ],
          totalAmount: "8.40",
        },
      },
    };

    await harness.executor.handoff(
      credential,
      first,
      new AbortController().signal,
    );
    await harness.executor.handoff(
      credential,
      followUp,
      new AbortController().signal,
    );

    expect(harness.adapter.execute).toHaveBeenCalledTimes(2);
    const followUpText = harness.printedBonText[1] ?? "";
    expect(followUpText).toContain("NACHBESTELLUNG 2");
    expect(followUpText).toContain(
      `Zu Bestellung #${first.job.payload.orderReference}`,
    );
    expect(followUpText).toContain("2 x Traubensaft");
    expect(followUpText).not.toContain(`Gericht 20`);
  });
});

function createHarness(ledgerPath: string) {
  const printedReferences: string[] = [];
  const printedBonText: string[] = [];
  const adapter = {
    id: "scenario-printer",
    version: 1,
    capabilities: ["printer.kitchen"] as const,
    supportedJobSchemas: [1] as const,
    validateConfiguration: (value: unknown) => value as Record<string, never>,
    redactConfiguration: () => ({}),
    healthCheck: jest.fn(),
    execute: jest.fn(
      async (buffer: Uint8Array): Promise<AdapterExecutionResult> => {
        const text = Buffer.from(buffer).toString("latin1");
        printedBonText.push(text);
        const reference = text.match(/Bestellung #(\d+)/)?.[1];
        if (reference) printedReferences.push(reference);
        return success();
      },
    ),
  };
  const completion = {
    acknowledge: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
  };
  const executor = new PrintExecutor(
    adapter,
    {},
    renderOptions,
    new ExecutionLedger(ledgerPath),
    completion,
  );
  return {
    adapter,
    completion,
    executor,
    printedReferences,
    printedBonText,
  };
}

function leasedJob(index: number) {
  const unitCents = 500 + index * 37;
  const quantity = 1 + (index % 4);
  const totalCents = unitCents * quantity;
  return {
    kind: "job" as const,
    job: {
      id: `job-${index}`,
      type: "kitchen_order",
      schemaVersion: 1,
      expiresAt: "2026-08-28T11:00:00.000Z",
      payload: {
        schemaVersion: 1,
        jobType: "kitchen_order",
        jobId: `job-${index}`,
        restaurantId: "restaurant-scenario",
        restaurantName: "MenüQR Testküche",
        orderId: `order-${index}`,
        orderReference: String(10_000 + index),
        tableNumber: 1 + index,
        createdAt: "2026-08-28T10:00:00.000Z",
        currency: "EUR",
        notes: index % 2 === 0 ? "Gemeinsam servieren" : null,
        items: [
          {
            itemId: `item-${index}`,
            name: `Gericht ${index}`,
            variation: index % 3 === 0 ? "Groß" : null,
            notes: index % 5 === 0 ? "Ohne Zwiebeln" : null,
            quantity,
            unitPrice: cents(unitCents),
            lineTotal: cents(totalCents),
          },
        ],
        totalAmount: cents(totalCents),
      },
    },
    lease: {
      token: `lease-${index}`,
      expiresAt: "2026-08-28T10:01:00.000Z",
    },
  };
}

function success(): AdapterExecutionResult {
  return {
    status: "succeeded",
    code: "PRINT_WRITTEN",
    message: "Bon written.",
    metadata: { bytesWritten: 1 },
  };
}

function cents(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}
