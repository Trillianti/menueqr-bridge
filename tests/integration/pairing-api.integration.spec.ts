import { createServer, type Server } from "node:http";

import { HttpPairingApi } from "../../src/main/pairing-api";

describe("pairing API client", () => {
  let server: Server;
  let baseUrl = "";
  const requests: Array<{ path?: string; authorization?: string }> = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push({
        path: request.url,
        authorization: request.headers.authorization,
      });
      response.setHeader("content-type", "application/json");
      if (request.url === "/bridge/v1/device-codes") {
        response.end(
          JSON.stringify({
            success: true,
            data: {
              deviceCode: "device-code",
              userCode: "ABCD-1234",
              verificationUri: "https://menueqr.de/dashboard/settings/bridge",
              verificationUriComplete:
                "https://menueqr.de/dashboard/settings/bridge?code=ABCD-1234",
              expiresAt: "2026-08-22T12:10:00.000Z",
              pollingIntervalSeconds: 5,
            },
          }),
        );
        return;
      }
      if (request.url === "/bridge/v1/device-codes/device-code/token") {
        response.end(
          JSON.stringify({
            success: true,
            data: { status: "authorization_pending", pollingIntervalSeconds: 5 },
          }),
        );
        return;
      }
      if (request.url === "/bridge/v1/device-codes/approved-device/token") {
        response.end(
          JSON.stringify({
            success: true,
            data: {
              status: "approved",
              device: {
                id: "device_1",
                token: "device-token-value",
                restaurant: { id: "restaurant_1", displayName: "Weingut Jäckel" },
              },
            },
          }),
        );
        return;
      }
      if (request.url === "/bridge/v1/heartbeat") {
        if (request.headers.authorization === "Bearer revoked-device-token") {
          response.statusCode = 401;
          response.end(
            JSON.stringify({
              success: false,
              error: {
                code: "BRIDGE_DEVICE_REVOKED",
                message: "Bridge device was revoked.",
              },
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            success: true,
            data: {
              heartbeatIntervalSeconds: 30,
              runtime: { kind: "ready", message: "Ready" },
            },
          }),
        );
        return;
      }
      if (request.url === "/bridge/v1/jobs/next?waitSeconds=25") {
        response.end(
          JSON.stringify({
            success: true,
            data: { kind: "timeout", retryAfterMs: 900 },
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({ success: true, data: { status: "revoked" } }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Pairing test server did not start.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("uses bounded versioned routes and bearer-only disconnect authorization", async () => {
    const client = new HttpPairingApi(baseUrl);
    await expect(
      client.createDeviceCode({
        displayName: "Kitchen PC",
        deviceFingerprint: "b2a8b955-0841-4a22-a9d4-3c733e4a9091",
        platform: "windows",
        appVersion: "0.1.0",
        requestedCapabilities: ["printer.kitchen"],
        supportedContractVersions: [1],
      }),
    ).resolves.toMatchObject({ userCode: "ABCD-1234" });
    await expect(client.pollForToken("device-code")).resolves.toEqual({
      kind: "authorization_pending",
      pollingIntervalSeconds: 5,
    });
    await client.revokeCurrentDevice("device-token-value");
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/bridge/v1/device-codes" }),
        expect.objectContaining({
          path: "/bridge/v1/device-codes/device-code/token",
        }),
        expect.objectContaining({
          path: "/bridge/v1/disconnect",
          authorization: "Bearer device-token-value",
        }),
      ]),
    );
  });

  it("keeps heartbeat and long polling outbound, typed, and bearer-scoped", async () => {
    const client = new HttpPairingApi(baseUrl);
    const credential = {
      deviceId: "device_1",
      token: "device-token-value",
      restaurant: { id: "restaurant_1", displayName: "Weingut Jäckel" },
      issuedAt: "2026-08-22T12:00:00.000Z",
      appVersion: "0.1.0",
    };
    const signal = new AbortController().signal;
    await expect(
      client.heartbeat(
        credential,
        {
          appVersion: "0.1.0",
          runtimeState: "ready",
          supportedContractVersions: [1],
          adapterHealth: [],
          lastCompletedJobId: null,
          lastFailedJobId: null,
          clientTimestamp: "2026-08-22T12:00:00.000Z",
        },
        signal,
      ),
    ).resolves.toMatchObject({ runtime: { kind: "ready" } });
    await expect(client.nextJob(credential, signal)).resolves.toEqual({
      kind: "timeout",
      retryAfterMs: 900,
    });
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/bridge/v1/heartbeat",
          authorization: "Bearer device-token-value",
        }),
        expect.objectContaining({
          path: "/bridge/v1/jobs/next?waitSeconds=25",
          authorization: "Bearer device-token-value",
        }),
      ]),
    );
  });

  it("adapts the backend approval response before the desktop stores its credential", async () => {
    const client = new HttpPairingApi(baseUrl);
    await expect(client.pollForToken("approved-device")).resolves.toMatchObject({
      kind: "approved",
      token: {
        deviceId: "device_1",
        token: "device-token-value",
        restaurant: { id: "restaurant_1", displayName: "Weingut Jäckel" },
      },
    });
  });

  it("turns a revoked credential response into a local revoked runtime state", async () => {
    const client = new HttpPairingApi(baseUrl);
    await expect(
      client.heartbeat(
        {
          deviceId: "device_1",
          token: "revoked-device-token",
          restaurant: { id: "restaurant_1", displayName: "Weingut Jäckel" },
          issuedAt: "2026-08-22T12:00:00.000Z",
          appVersion: "0.1.0",
        },
        {
          appVersion: "0.1.0",
          runtimeState: "ready",
          supportedContractVersions: [1],
          adapterHealth: [],
          lastCompletedJobId: null,
          lastFailedJobId: null,
          clientTimestamp: "2026-08-22T12:00:00.000Z",
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ runtime: { kind: "revoked" } });
  });
});
