import {
  fingerprintHost,
  isAllowedLocalHost,
  normalizeSocketError,
  StarTsp1000LanAdapter,
} from "../../src/integrations/printers/star-tsp1000-lan/star-tsp1000-lan";

describe("Star TSP1000 LAN configuration", () => {
  const adapter = new StarTsp1000LanAdapter();
  const valid = {
    host: "192.168.1.20",
    port: 9100,
    commandMode: "star_line" as const,
    paperWidthMm: 80 as const,
    encoding: "cp437" as const,
    connectTimeoutMs: 3_000,
    writeTimeoutMs: 5_000,
    cutAfterPrint: true,
  };

  it("allows private LAN addresses and local hostnames but rejects unsafe targets", () => {
    expect(isAllowedLocalHost("192.168.1.20")).toBe(true);
    expect(isAllowedLocalHost("printer.local")).toBe(true);
    expect(isAllowedLocalHost("localhost")).toBe(false);
    expect(isAllowedLocalHost("127.0.0.1")).toBe(false);
    expect(isAllowedLocalHost("8.8.8.8")).toBe(false);
    expect(isAllowedLocalHost("http://192.168.1.20")).toBe(false);
    expect(() =>
      adapter.validateConfiguration({ ...valid, host: "0.0.0.0" }),
    ).toThrow("INVALID_CONFIGURATION");
  });

  it("redacts the local host and normalizes stable socket error codes", () => {
    const redacted = adapter.redactConfiguration(valid);
    expect(redacted).toMatchObject({
      hostFingerprint: fingerprintHost(valid.host),
      port: 9100,
      commandMode: "star_line",
    });
    expect(JSON.stringify(redacted)).not.toContain(valid.host);
    expect(
      normalizeSocketError(
        Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
      ),
    ).toBe("PRINTER_OFFLINE");
    expect(
      normalizeSocketError(
        Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
      ),
    ).toBe("SOCKET_TIMEOUT");
    expect(
      normalizeSocketError(
        Object.assign(new Error("reset"), { code: "ECONNRESET" }),
      ),
    ).toBe("SOCKET_RESET");
  });

  it("reports a successful health check only as TCP connectivity", async () => {
    const adapterWithInvalid = new StarTsp1000LanAdapter();
    await expect(
      adapterWithInvalid.healthCheck({ ...valid, host: "8.8.8.8" }),
    ).resolves.toMatchObject({
      status: "misconfigured",
      code: "INVALID_CONFIGURATION",
    });
  });

  it("rejects hostname configuration that resolves outside the private LAN", async () => {
    const resolver = jest
      .fn()
      .mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    const adapterWithPublicResolution = new StarTsp1000LanAdapter(
      undefined,
      false,
      resolver,
    );
    await expect(
      adapterWithPublicResolution.healthCheck({
        ...valid,
        host: "printer.local",
      }),
    ).resolves.toMatchObject({
      status: "misconfigured",
      code: "INVALID_CONFIGURATION",
    });
  });

  it("discovers only reachable printers on active private /24 networks", async () => {
    const probe = jest.fn(async (host: string) =>
      ["192.168.8.4", "192.168.8.9", "192.168.8.25"].includes(host),
    );
    const reverseDns = jest.fn(async (host: string) =>
      host === "192.168.8.9" ? ["Kitchen-printer.local."] : [],
    );
    const adapterWithDiscovery = new StarTsp1000LanAdapter(
      undefined,
      false,
      undefined,
      () =>
        ({
          ethernet: [
            {
              address: "192.168.8.4",
              family: "IPv4",
              internal: false,
            },
          ],
          loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
          vpn0: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
        }) as never,
      probe,
      reverseDns,
    );

    await expect(
      adapterWithDiscovery.discover(new AbortController().signal),
    ).resolves.toEqual([
      {
        id: "star-lan:192.168.8.4:9100",
        displayName: "Netzwerkdrucker (192.168.8.4)",
        host: "192.168.8.4",
        port: 9100,
      },
      {
        id: "star-lan:192.168.8.9:9100",
        displayName: "Kitchen-printer.local",
        host: "192.168.8.9",
        port: 9100,
      },
      {
        id: "star-lan:192.168.8.25:9100",
        displayName: "Netzwerkdrucker (192.168.8.25)",
        host: "192.168.8.25",
        port: 9100,
      },
    ]);
    expect(probe).toHaveBeenCalledWith(
      "192.168.8.1",
      9100,
      350,
      expect.any(AbortSignal),
    );
    expect(probe).toHaveBeenCalledWith(
      "192.168.8.4",
      9100,
      350,
      expect.any(AbortSignal),
    );
    expect(probe).not.toHaveBeenCalledWith(
      "127.0.0.1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(reverseDns).toHaveBeenCalledTimes(3);
    expect(reverseDns).toHaveBeenCalledWith("192.168.8.9");
    expect(probe).not.toHaveBeenCalledWith(
      "10.8.0.1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
