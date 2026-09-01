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
    const spooler = new PowerShellWindowsPrinterSpooler(runner, "win32");
    const signal = new AbortController().signal;
    await spooler.printText(
      "Star TSP1000 (TSP 1045) (Hoffest)",
      "TISCH 4\r\n2 x Schnitzel\r\n",
      signal,
    );
    expect(runner).toHaveBeenCalledWith(
      expect.not.stringContaining("Hoffest"),
      {
        input: "TISCH 4\r\n2 x Schnitzel\r\n",
        environment: {
          MENUEQR_WINDOWS_PRINTER_NAME:
            "Star TSP1000 (TSP 1045) (Hoffest)",
        },
        signal,
      },
    );
  });

  it("fails closed outside Windows", async () => {
    const spooler = new PowerShellWindowsPrinterSpooler(jest.fn(), "darwin");
    await expect(spooler.listPrinters()).rejects.toMatchObject({
      code: "WINDOWS_SPOOLER_UNAVAILABLE",
    });
  });
});
