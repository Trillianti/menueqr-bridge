import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import {
  createServer as createTcpServer,
  type Server as TcpServer,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  BridgeCredential,
  CredentialStore,
} from "../../src/core/credential-store";
import { BridgeRuntime } from "../../src/core/bridge-runtime";
import { RuntimeStore } from "../../src/core/runtime-store";
import { StarTsp1000LanAdapter } from "../../src/integrations/printers/star-tsp1000-lan/star-tsp1000-lan";
import { HttpPairingApi } from "../../src/main/pairing-api";
import { DesktopPairingService } from "../../src/main/pairing-service";
import { KitchenRouteService } from "../../src/main/kitchen-route-service";

const credential: BridgeCredential = {
  deviceId: "device_1",
  token: "device-token-not-persisted-in-test-output",
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

describe("full simulated bridge E2E", () => {
  it("pairs, creates a synthetic table order, prints it once, and recovers an ack loss", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-full-e2e-"));
    const backend = new FakeBridgeBackend();
    const printer = new FakePrinter();
    await backend.start();
    await printer.start();
    const api = new HttpPairingApi(backend.baseUrl);
    const credentials = new MemoryCredentialStore();
    const adapter = new StarTsp1000LanAdapter(undefined, true, async () => [
      { address: "127.0.0.1", family: 4 },
    ]);
    const route = new KitchenRouteService(
      join(directory, "adapter-config.json"),
      join(directory, "ledger.json"),
      api,
      undefined,
      adapter,
    );
    await route.saveConfiguration({
      host: "fake-printer.local",
      port: printer.port,
      commandMode: "star_line",
      paperWidthMm: 80,
      encoding: "cp437",
      connectTimeoutMs: 1_000,
      writeTimeoutMs: 1_000,
      cutAfterPrint: true,
    });
    const runtimeStore = new RuntimeStore(join(directory, "runtime.json"));
    const runtime = new BridgeRuntime(api, runtimeStore, route, {
      appVersion: "0.1.0",
      heartbeatFallbackSeconds: 30,
      wait: jest.fn().mockResolvedValue(false),
    });
    let paired!: () => void;
    const pairedReady = new Promise<void>((resolve) => {
      paired = resolve;
    });
    const pairing = new DesktopPairingService(
      api,
      credentials,
      { openExternal: jest.fn().mockResolvedValue(undefined) },
      {
        appVersion: "0.1.0",
        deviceFingerprint: "b2a8b955-0841-4a22-a9d4-3c733e4a9091",
        deviceName: "Test kitchen PC",
        verificationHosts: ["menueqr.de"],
        wait: jest.fn().mockResolvedValue(true),
        onCredentialSaved: async (saved) => {
          await runtime.start(saved);
          paired();
        },
      },
    );

    try {
      await runtime.restore();
      await pairing.begin();
      await completesWithin(pairedReady, 2_000, "pairing");
      await completesWithin(backend.firstPoll, 2_000, "first poll");

      await fetch(`${backend.baseUrl}/test/orders`, { method: "POST" });

      await completesWithin(backend.acknowledged, 2_000, "acknowledgement");
      await completesWithin(printer.received, 2_000, "printer write");
      await completesWithin(
        waitForCompletedJob(runtime),
        2_000,
        "runtime state",
      );

      expect(backend.deviceCodeRequests).toBe(1);
      expect(backend.syntheticOrders).toBe(1);
      expect(backend.polls).toBe(2);
      expect(backend.acknowledgements).toBe(2);
      expect(backend.failures).toBe(0);
      expect(printer.connections).toBeGreaterThanOrEqual(2);
      expect(printer.writeConnections).toBe(1);
      expect(printer.buffer.toString("latin1")).toContain("A-100");
      expect(runtime.diagnostics().recentJobIds).toEqual(["job_1"]);
    } finally {
      await runtime.shutdown();
      await runtimeStore.flush();
      await backend.stop();
      await printer.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

class MemoryCredentialStore implements CredentialStore {
  private value: BridgeCredential | null = null;

  async read(): Promise<BridgeCredential | null> {
    return this.value;
  }

  async save(value: BridgeCredential): Promise<void> {
    this.value = value;
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

class FakePrinter {
  private server: TcpServer | null = null;
  private resolveReceived: (() => void) | null = null;
  readonly received = new Promise<void>((resolve) => {
    this.resolveReceived = resolve;
  });
  port = 0;
  connections = 0;
  writeConnections = 0;
  buffer = Buffer.alloc(0);

  async start(): Promise<void> {
    this.server = createTcpServer((socket) => {
      this.connections += 1;
      let receivedData = false;
      socket.on("data", (data) => {
        if (!receivedData) {
          receivedData = true;
          this.writeConnections += 1;
        }
        this.buffer = Buffer.concat([this.buffer, data]);
        this.resolveReceived?.();
        this.resolveReceived = null;
      });
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, "127.0.0.1", resolve),
    );
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Fake printer did not bind.");
    this.port = address.port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server!.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

class FakeBridgeBackend {
  private server: HttpServer | null = null;
  private waitForJob: (() => void) | null = null;
  private resolvePoll: (() => void) | null = null;
  private resolveAcknowledged: (() => void) | null = null;
  readonly firstPoll = new Promise<void>((resolve) => {
    this.resolvePoll = resolve;
  });
  readonly acknowledged = new Promise<void>((resolve) => {
    this.resolveAcknowledged = resolve;
  });
  baseUrl = "";
  deviceCodeRequests = 0;
  syntheticOrders = 0;
  polls = 0;
  acknowledgements = 0;
  failures = 0;
  private jobAvailable = false;

  async start(): Promise<void> {
    this.server = createHttpServer(
      (request, response) => void this.handle(request, response),
    );
    await new Promise<void>((resolve) =>
      this.server!.listen(0, "127.0.0.1", resolve),
    );
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Fake bridge backend did not bind.");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server!.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const path = request.url ?? "";
    if (request.method === "POST" && path === "/bridge/v1/device-codes") {
      this.deviceCodeRequests += 1;
      return respond(response, 200, {
        deviceCode: "device-code",
        userCode: "ABCD-1234",
        verificationUri: "https://menueqr.de/dashboard/settings/bridge",
        verificationUriComplete:
          "https://menueqr.de/dashboard/settings/bridge?code=ABCD-1234",
        expiresAt: "2099-08-22T12:10:00.000Z",
        pollingIntervalSeconds: 1,
      });
    }
    if (
      request.method === "GET" &&
      path === "/bridge/v1/device-codes/device-code/token"
    ) {
      return respond(response, 200, {
        status: "approved",
        device: {
          id: credential.deviceId,
          token: credential.token,
          restaurant: credential.restaurant,
        },
      });
    }
    if (request.method === "POST" && path === "/bridge/v1/heartbeat") {
      return respond(response, 200, {
        heartbeatIntervalSeconds: 30,
        runtime: { kind: "ready", message: "Ready" },
      });
    }
    if (
      request.method === "GET" &&
      path === "/bridge/v1/jobs/next?waitSeconds=25"
    ) {
      this.polls += 1;
      this.resolvePoll?.();
      this.resolvePoll = null;
      if (this.jobAvailable) return respond(response, 200, job);
      this.waitForJob = () => respond(response, 200, job);
      response.once("close", () => {
        if (this.waitForJob) this.waitForJob = null;
      });
      return;
    }
    if (request.method === "POST" && path === "/bridge/v1/jobs/job_1/ack") {
      this.acknowledgements += 1;
      if (this.acknowledgements === 1)
        return respond(response, 503, {
          error: { message: "ACK_UNAVAILABLE" },
        });
      this.jobAvailable = false;
      this.resolveAcknowledged?.();
      this.resolveAcknowledged = null;
      return respond(response, 200, { status: "succeeded" });
    }
    if (request.method === "POST" && path === "/bridge/v1/jobs/job_1/fail") {
      this.failures += 1;
      return respond(response, 200, { status: "retry_scheduled" });
    }
    if (request.method === "POST" && path === "/test/orders") {
      this.syntheticOrders += 1;
      this.jobAvailable = true;
      const waiting = this.waitForJob;
      this.waitForJob = null;
      if (waiting) waiting();
      respond(response, 200, { orderId: "order_1" });
      return;
    }
    respond(response, 404, { error: { message: "Not found" } });
  }
}

function respond(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(status >= 400 ? data : { success: true, data }));
}

async function completesWithin(
  value: Promise<void>,
  milliseconds: number,
  label = "pipeline",
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      value,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Simulated E2E ${label} did not complete.`)),
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
