import { PowerShellWindowsPrinterSpooler } from "../../src/main/windows-printer-spooler";

describe("Windows printer spooler", () => {
  it("lists installed Windows printers without requiring administrator access", async () => {
    const runner = jest.fn().mockResolvedValue(
      JSON.stringify([
        {
          Name: "Star TSP1000 (TSP 1045) (Hoffest)",
          DriverName: "Star TSP1000",
          PortName: "192.168.178.55",
          PrinterStatus: "Normal",
        },
      ]),
    );
    const spooler = new PowerShellWindowsPrinterSpooler(runner, "win32");
    await expect(spooler.listPrinters()).resolves.toEqual([
      {
        name: "Star TSP1000 (TSP 1045) (Hoffest)",
        driverName: "Star TSP1000",
        portName: "192.168.178.55",
        status: "Normal",
      },
    ]);
  });

  it("passes bon text through stdin and the printer name through the environment", async () => {
    const runner = jest.fn().mockResolvedValue("");
    const onEvent = jest.fn();
    const spooler = new PowerShellWindowsPrinterSpooler(
      runner,
      "win32",
      onEvent,
    );
    const signal = new AbortController().signal;
    await spooler.printText(
      "Star TSP1000 (TSP 1045) (Hoffest)",
      "TISCH 4\r\n2 x Schnitzel\r\n",
      { paperWidthMm: 80, copies: 2 },
      signal,
    );
    const script = runner.mock.calls[0]?.[0] as string;
    expect(script).toContain("PrintDocument");
    expect(script).toContain("PrintableArea");
    expect(script).toContain("symmetricHalfWidth");
    expect(script).toContain("$eventArgs.HasMorePages = $false");
    expect(script).toContain(
      "for ($copyIndex = 0; $copyIndex -lt $copies; $copyIndex += 1)",
    );
    expect(script).not.toContain("$state.CopyIndex");
    expect(script).not.toContain("Out-Printer");
    expect(runner).toHaveBeenCalledWith(
      expect.not.stringContaining("Hoffest"),
      {
        input: "TISCH 4\r\n2 x Schnitzel\r\n",
        environment: {
          MENUEQR_WINDOWS_PRINTER_NAME:
            "Star TSP1000 (TSP 1045) (Hoffest)",
          MENUEQR_WINDOWS_PAPER_WIDTH_MM: "80",
          MENUEQR_WINDOWS_COPIES: "2",
        },
        signal,
      },
    );
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "windows_spooler.print_started",
        details: expect.objectContaining({
          characters: 24,
          lines: 3,
          paperWidthMm: 80,
          copies: 2,
        }),
      }),
    );
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "windows_spooler.print_completed",
        code: "WINDOWS_PRINT_JOB_ACCEPTED",
      }),
    );
  });

  it("rejects unsupported paper or copy settings before starting PowerShell", async () => {
    const runner = jest.fn().mockResolvedValue("");
    const spooler = new PowerShellWindowsPrinterSpooler(runner, "win32");
    await expect(
      spooler.printText(
        "Star TSP1000",
        "TEST\r\n",
        { paperWidthMm: 80, copies: 3 as never },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "WINDOWS_PRINT_INVALID" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("fails closed outside Windows", async () => {
    const spooler = new PowerShellWindowsPrinterSpooler(jest.fn(), "darwin");
    await expect(spooler.listPrinters()).rejects.toMatchObject({
      code: "WINDOWS_SPOOLER_UNAVAILABLE",
    });
  });
});
