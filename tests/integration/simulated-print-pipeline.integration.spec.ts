import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BridgeRuntime } from "../../src/core/bridge-runtime";
import { RuntimeStore } from "../../src/core/runtime-store";
import { StarTsp1000LanAdapter } from "../../src/integrations/printers/star-tsp1000-lan/star-tsp1000-lan";
import { KitchenRouteService } from "../../src/main/kitchen-route-service";

const credential = {
  deviceId: "device_1",
  token: "device-token-not-written-to-output",
  restaurant: { id: "restaurant_1", displayName: "Weingut Jäckel" },
  issuedAt: "2026-08-22T12:00:00.000Z",
  appVersion: "0.1.0",
};

const leasedJob = {
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
      notes: "No onion",
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

describe("simulated bridge print pipeline", () => {
  let server: Server;
  let port = 0;
  let connections = 0;
  let writeConnections = 0;
  const buffers: Buffer[] = [];
  let resolveBuffer: (() => void) | null = null;

  beforeAll(async () => {
    server = createServer((socket) => {
      connections += 1;
      let receivedData = false;
      socket.on("data", (data) => {
        if (!receivedData) {
          receivedData = true;
          writeConnections += 1;
        }
        buffers.push(Buffer.from(data));
        resolveBuffer?.();
        resolveBuffer = null;
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Fake printer did not bind.");
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("prints once and retries only acknowledgement after simulated ack loss", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-e2e-"));
    const bufferReceived = new Promise<void>((resolve) => {
      resolveBuffer = resolve;
    });
    let resolveAcknowledged: () => void = () => undefined;
    const acknowledged = new Promise<void>((resolve) => {
      resolveAcknowledged = resolve;
    });
    let acknowledgementCount = 0;
    const client = {
      heartbeat: jest.fn().mockResolvedValue({
        heartbeatIntervalSeconds: 30,
        runtime: { kind: "ready", message: "Ready" },
      }),
      nextJob: jest
        .fn()
        .mockResolvedValueOnce(leasedJob)
        .mockResolvedValueOnce(leasedJob)
        .mockResolvedValue({ kind: "timeout", retryAfterMs: 1 }),
      acknowledge: jest.fn().mockImplementation(async () => {
        acknowledgementCount += 1;
        if (acknowledgementCount === 1) throw new Error("ACK_UNAVAILABLE");
        resolveAcknowledged();
      }),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const adapter = new StarTsp1000LanAdapter(undefined, true, async () => [
      { address: "127.0.0.1", family: 4 },
    ]);
    const route = new KitchenRouteService(
      join(directory, "adapter-config.json"),
      join(directory, "ledger.json"),
      client,
      undefined,
      adapter,
    );
    await route.saveConfiguration({
      host: "fake-printer.local",
      port,
      commandMode: "star_line",
      paperWidthMm: 80,
      encoding: "cp437",
      connectTimeoutMs: 1_000,
      writeTimeoutMs: 1_000,
      cutAfterPrint: true,
    });
    const store = new RuntimeStore(join(directory, "runtime.json"));
    const runtime = new BridgeRuntime(client, store, route, {
      appVersion: "0.1.0",
      heartbeatFallbackSeconds: 30,
      wait: jest.fn().mockResolvedValue(false),
    });

    try {
      await runtime.restore();
      await runtime.start(credential);
      await completesWithin(acknowledged, 2_000);
      await completesWithin(bufferReceived, 2_000);
      await completesWithin(waitForCompletedJob(runtime), 2_000);
      expect(client.acknowledge).toHaveBeenCalledTimes(2);
      expect(client.fail).not.toHaveBeenCalled();
      expect(connections).toBeGreaterThanOrEqual(2);
      expect(writeConnections).toBe(1);
      expect(Buffer.concat(buffers).toString("latin1")).toContain("A-100");
      expect(runtime.diagnostics().recentJobIds).toEqual(["job_1"]);
    } finally {
      await runtime.shutdown();
      await store.flush();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function completesWithin(value: Promise<void>, milliseconds: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      value,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Simulated pipeline did not complete.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForCompletedJob(runtime: BridgeRuntime): Promise<void> {
  while (runtime.diagnostics().recentJobIds.at(-1) !== "job_1") {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
