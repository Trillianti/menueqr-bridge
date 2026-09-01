import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IntegrationAdapter } from "../../src/contracts";
import { KitchenRouteService } from "../../src/main/kitchen-route-service";

describe("kitchen route service", () => {
  function discoveryAdapter(
    candidates: Array<{
      id: string;
      displayName: string;
      host: string;
      port: number;
    }>,
  ): IntegrationAdapter<any, Uint8Array> {
    return {
      id: "printer.star-tsp1000-lan",
      version: 2,
      capabilities: ["printer.kitchen"],
      supportedJobSchemas: [1],
      validateConfiguration(value: unknown) {
        const input = value as Partial<typeof configuration>;
        if (!input.host || !input.port)
          throw new Error("INVALID_CONFIGURATION");
        return {
          transport: input.transport ?? "raw_tcp",
          windowsPrinterName: input.windowsPrinterName ?? null,
          host: input.host,
          port: input.port,
          commandMode: input.commandMode ?? "star_line",
          paperWidthMm: input.paperWidthMm ?? 80,
          encoding: input.encoding ?? "cp437",
          connectTimeoutMs: input.connectTimeoutMs ?? 3000,
          writeTimeoutMs: input.writeTimeoutMs ?? 5000,
          cutAfterPrint: input.cutAfterPrint ?? true,
          bonLayoutProfile: input.bonLayoutProfile ?? "detailed",
        };
      },
      redactConfiguration: () => ({ adapter: "test" }),
      healthCheck: jest.fn().mockResolvedValue({
        status: "ready",
        code: "TCP_READY",
        message: "Printer TCP connection succeeded.",
        checkedAt: "2026-08-23T20:00:00.000Z",
      }),
      execute: jest.fn(),
      test: jest.fn().mockResolvedValue({
        status: "succeeded",
        code: "PRINT_WRITTEN",
        message: "Confirmation bon printed.",
      }),
      discover: jest.fn().mockResolvedValue(candidates),
    };
  }

  async function setup(adapter?: IntegrationAdapter<any, Uint8Array>) {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-route-"));
    const completion = {
      acknowledge: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    return {
      completion,
      route: new KitchenRouteService(
        join(directory, "adapter-config.json"),
        join(directory, "ledger.json"),
        completion,
        undefined,
        adapter,
      ),
      directory,
    };
  }

  const configuration = {
    transport: "raw_tcp" as const,
    windowsPrinterName: null,
    host: "192.168.1.30",
    port: 9100,
    commandMode: "star_line" as const,
    paperWidthMm: 80 as const,
    encoding: "cp437" as const,
    connectTimeoutMs: 3000,
    writeTimeoutMs: 5000,
    cutAfterPrint: true,
    bonLayoutProfile: "detailed" as const,
  };

  it("keeps an unconfigured route out of job polling", async () => {
    const { route } = await setup();
    await expect(route.readiness()).resolves.toMatchObject({
      ready: false,
      code: "PRINTER_NOT_CONFIGURED",
    });
    await expect(route.snapshot()).resolves.toMatchObject({
      configured: false,
      configuration: null,
    });
  });

  it("stores validated local-only printer settings and sends no host to heartbeat", async () => {
    const { route } = await setup(discoveryAdapter([]));
    await expect(route.saveConfiguration(configuration)).resolves.toMatchObject(
      {
        configured: true,
        configuration,
      },
    );
    await expect(route.readiness()).resolves.toEqual({ ready: true });
    const health = await route.adapterHealth();
    expect(JSON.stringify(health)).not.toContain(configuration.host);
    expect(health[0]).not.toHaveProperty("checkedAt");
    expect(health).toEqual([
      expect.objectContaining({
        adapterId: "printer.star-tsp1000-lan",
        code: "TCP_READY",
      }),
    ]);
  });

  it("restores the last confirmed printer health after a restart", async () => {
    const adapter = discoveryAdapter([]);
    const { route, completion, directory } = await setup(adapter);
    const saved = await route.saveConfiguration(configuration);
    await expect(
      route.checkConnection(saved.activePrinterId as string),
    ).resolves.toMatchObject({ status: "ready", code: "TCP_READY" });

    const restored = new KitchenRouteService(
      join(directory, "adapter-config.json"),
      join(directory, "ledger.json"),
      completion,
      undefined,
      adapter,
    );
    const restoredSnapshot = await restored.snapshot();
    expect(restoredSnapshot.health).toMatchObject({
      status: "ready",
      code: "TCP_READY",
    });
    expect(restoredSnapshot.printers[0]?.health).toMatchObject({
      status: "ready",
      code: "TCP_READY",
    });
  });

  it("keeps a known-good status through one transient failure and reports the second", async () => {
    const adapter = discoveryAdapter([]);
    const healthCheck = adapter.healthCheck as jest.Mock;
    const offline = {
      status: "offline",
      code: "ECONNREFUSED",
      message: "Printer connection was refused.",
      checkedAt: "2026-08-23T20:01:00.000Z",
    };
    healthCheck
      .mockResolvedValueOnce({
        status: "ready",
        code: "TCP_READY",
        message: "Printer TCP connection succeeded.",
        checkedAt: "2026-08-23T20:00:00.000Z",
      })
      .mockResolvedValueOnce(offline)
      .mockResolvedValueOnce(offline);
    const { route } = await setup(adapter);
    const transition = jest.fn();
    route.setHealthTransitionListener(transition);
    const saved = await route.saveConfiguration(configuration);
    await route.checkConnection(saved.activePrinterId as string);

    await expect(route.adapterHealth()).resolves.toEqual([
      expect.objectContaining({ status: "ready", code: "TCP_READY" }),
    ]);
    expect(transition).not.toHaveBeenCalled();

    await expect(route.adapterHealth()).resolves.toEqual([
      expect.objectContaining({ status: "offline", code: "ECONNREFUSED" }),
    ]);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        active: true,
        previous: expect.objectContaining({ status: "ready" }),
        current: expect.objectContaining({ status: "offline" }),
      }),
    );
  });

  it("stores multiple printers, switches the active route, and removes them independently", async () => {
    const { route, completion, directory } = await setup();
    const first = await route.saveConfiguration(configuration);
    const firstId = first.activePrinterId;
    expect(firstId).toEqual(expect.any(String));

    const secondConfiguration = { ...configuration, host: "192.168.1.31" };
    const second = await route.saveConfiguration(secondConfiguration);
    const secondId = second.activePrinterId;
    expect(secondId).not.toBe(firstId);
    expect(second.printers).toHaveLength(2);
    expect(second.configuration).toEqual(secondConfiguration);

    await expect(
      route.activateConfiguration(firstId as string),
    ).resolves.toMatchObject({
      activePrinterId: firstId,
      configuration,
    });
    const editedSecondConfiguration = { ...secondConfiguration, port: 9101 };
    await expect(
      route.saveConfiguration(editedSecondConfiguration, secondId as string),
    ).resolves.toMatchObject({
      activePrinterId: firstId,
      configuration,
      printers: expect.arrayContaining([
        expect.objectContaining({
          id: secondId,
          configuration: editedSecondConfiguration,
          active: false,
        }),
      ]),
    });
    await expect(
      route.deleteConfiguration(firstId as string),
    ).resolves.toMatchObject({
      activePrinterId: secondId,
      configuration: editedSecondConfiguration,
      printers: [expect.objectContaining({ id: secondId, active: true })],
    });

    const restored = new KitchenRouteService(
      join(directory, "adapter-config.json"),
      join(directory, "ledger.json"),
      completion,
    );
    await expect(restored.snapshot()).resolves.toMatchObject({
      activePrinterId: secondId,
      configuration: editedSecondConfiguration,
      printers: [expect.objectContaining({ id: secondId, active: true })],
    });
    await expect(
      restored.deleteConfiguration(secondId as string),
    ).resolves.toMatchObject({
      configured: false,
      activePrinterId: null,
      printers: [],
    });
  });

  it("auto-selects one discovered printer but persists it only after test confirmation", async () => {
    const candidate = {
      id: "star-lan:192.168.1.42:9100",
      displayName: "Network printer at 192.168.1.42",
      host: "192.168.1.42",
      port: 9100,
    };
    const adapter = discoveryAdapter([candidate]);
    const { route, completion, directory } = await setup(adapter);

    await expect(
      route.discoverLocalPrinters(new AbortController().signal),
    ).resolves.toEqual({
      candidates: [candidate],
      selectedCandidateId: candidate.id,
    });
    await expect(route.confirmSelectedDiscoveredPrinter()).rejects.toThrow(
      "PRINTER_DISCOVERY_CONFIRMATION_REQUIRED",
    );
    await expect(
      route.testSelectedDiscoveredPrinter(new AbortController().signal),
    ).resolves.toMatchObject({ status: "succeeded" });
    await expect(
      route.confirmSelectedDiscoveredPrinter(undefined, "kitchen"),
    ).resolves.toMatchObject({
      configured: true,
      configuration: expect.objectContaining({
        host: candidate.host,
        bonLayoutProfile: "kitchen",
      }),
    });
    const restored = new KitchenRouteService(
      join(directory, "adapter-config.json"),
      join(directory, "ledger.json"),
      completion,
      undefined,
      adapter,
    );
    await expect(restored.snapshot()).resolves.toMatchObject({
      configured: true,
      configuration: expect.objectContaining({
        host: candidate.host,
        bonLayoutProfile: "kitchen",
      }),
    });
  });

  it("requires a choice when several printers are discovered", async () => {
    const first = {
      id: "star-lan:192.168.1.42:9100",
      displayName: "Network printer at 192.168.1.42",
      host: "192.168.1.42",
      port: 9100,
    };
    const second = {
      id: "star-lan:192.168.1.43:9100",
      displayName: "Network printer at 192.168.1.43",
      host: "192.168.1.43",
      port: 9100,
    };
    const { route } = await setup(discoveryAdapter([first, second]));
    await expect(
      route.discoverLocalPrinters(new AbortController().signal),
    ).resolves.toEqual({
      candidates: [first, second],
      selectedCandidateId: null,
    });
    expect(route.selectDiscoveredPrinter(second.id)).toEqual({
      candidates: [first, second],
      selectedCandidateId: second.id,
    });
  });
});
