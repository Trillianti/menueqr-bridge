import { DesktopPairingService } from "../../src/main/pairing-service";
import type {
  BridgeCredential,
  CredentialStore,
} from "../../src/core/credential-store";

describe("desktop pairing service", () => {
  const credential: BridgeCredential = {
    deviceId: "device_1",
    token: "never-render-me",
    restaurant: { id: "restaurant_1", displayName: "Weingut Jäckel" },
    issuedAt: "2026-08-22T12:01:00.000Z",
    appVersion: "0.1.0",
  };

  function setup() {
    const api = {
      createDeviceCode: jest.fn().mockResolvedValue({
        deviceCode: "code_1",
        userCode: "ABCD-1234",
        verificationUri:
          "https://www.menueqr.de/dashboard/settings/integrations",
        verificationUriComplete:
          "https://www.menueqr.de/dashboard/settings/integrations?code=ABCD-1234",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        pollingIntervalSeconds: 1,
      }),
      pollForToken: jest.fn().mockResolvedValue({
        kind: "approved",
        token: {
          deviceId: credential.deviceId,
          token: credential.token,
          restaurant: credential.restaurant,
          issuedAt: credential.issuedAt,
        },
      }),
      revokeCurrentDevice: jest.fn().mockResolvedValue(undefined),
      submitPrinterSupportRequest: jest.fn().mockResolvedValue(undefined),
    };
    let stored: BridgeCredential | null = null;
    const store: CredentialStore = {
      read: jest.fn(async () => stored),
      save: jest.fn(async (value) => {
        stored = value;
      }),
      clear: jest.fn(async () => {
        stored = null;
      }),
    };
    const opener = { openExternal: jest.fn().mockResolvedValue(undefined) };
    const service = new DesktopPairingService(api, store, opener, {
      appVersion: "0.1.0",
      deviceFingerprint: "b2a8b955-0841-4a22-a9d4-3c733e4a9091",
      deviceName: "Kitchen PC",
      verificationHosts: ["www.menueqr.de"],
      wait: jest.fn().mockResolvedValue(false),
    });
    return { api, store, opener, service };
  }

  it("issues a trusted code before opening the browser and never exposes a device token", async () => {
    const { service, opener } = setup();
    const state = await service.begin();
    expect(opener.openExternal).not.toHaveBeenCalled();
    await service.openPairingBrowser();
    expect(opener.openExternal).toHaveBeenCalledWith(
      "https://www.menueqr.de/dashboard/settings/integrations?code=ABCD-1234",
    );
    expect(state).toMatchObject({
      kind: "waiting_for_approval",
      userCode: "ABCD-1234",
    });
    expect(JSON.stringify(state)).not.toContain("never-render-me");
  });

  it("rejects an untrusted verification URL before opening the browser", async () => {
    const { service, api, opener } = setup();
    api.createDeviceCode.mockResolvedValueOnce({
      deviceCode: "code_1",
      userCode: "ABCD-1234",
      verificationUri: "https://evil.example",
      verificationUriComplete: "https://evil.example",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      pollingIntervalSeconds: 1,
    });
    await expect(service.begin()).resolves.toMatchObject({
      kind: "network_error",
    });
    expect(opener.openExternal).not.toHaveBeenCalled();
  });

  it("permits a private HTTP verification URL only when local development is explicit", async () => {
    const { service, api, opener } = setup();
    api.createDeviceCode.mockResolvedValueOnce({
      deviceCode: "code_1",
      userCode: "ABCD-1234",
      verificationUri: "http://192.168.0.12:3000/dashboard/settings/bridge",
      verificationUriComplete:
        "http://192.168.0.12:3000/dashboard/settings/bridge?code=ABCD-1234",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      pollingIntervalSeconds: 1,
    });
    const localService = new DesktopPairingService(
      api,
      {
        read: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
      },
      opener,
      {
        appVersion: "0.1.0",
        deviceFingerprint: "b2a8b955-0841-4a22-a9d4-3c733e4a9091",
        deviceName: "Kitchen PC",
        verificationHosts: ["192.168.0.12"],
        allowInsecureLocalVerification: true,
        wait: jest.fn().mockResolvedValue(false),
      },
    );

    await expect(localService.begin()).resolves.toMatchObject({
      kind: "waiting_for_approval",
    });
    expect(opener.openExternal).not.toHaveBeenCalled();
    await localService.openPairingBrowser();
    expect(opener.openExternal).toHaveBeenCalledWith(
      "http://192.168.0.12:3000/dashboard/settings/bridge?code=ABCD-1234",
    );
  });

  it("clears local encrypted credentials even when server revocation cannot finish", async () => {
    const { service, api, store } = setup();
    (store.read as jest.Mock).mockResolvedValue(credential);
    api.revokeCurrentDevice.mockRejectedValueOnce(new Error("offline"));
    await expect(service.disconnect()).resolves.toMatchObject({
      state: { kind: "unpaired" },
      serverCleanupPending: true,
    });
    expect(store.clear).toHaveBeenCalled();
  });

  it("clears the local credential without asking the server again after remote revocation", async () => {
    const { service, api, store } = setup();
    await service.clearRevokedCredential();

    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(api.revokeCurrentDevice).not.toHaveBeenCalled();
    expect(service.snapshot()).toEqual({ kind: "unpaired" });
  });

  it("sends a printer support request only through the paired credential", async () => {
    const { service, api, store } = setup();
    (store.read as jest.Mock).mockResolvedValue(credential);

    await service.requestPrinterSupport({
      model: "Epson TM-T20III",
      note: "LAN",
    });

    expect(api.submitPrinterSupportRequest).toHaveBeenCalledWith(credential, {
      model: "Epson TM-T20III",
      note: "LAN",
    });
  });
});
