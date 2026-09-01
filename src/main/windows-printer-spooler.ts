import { spawn } from "node:child_process";

import type {
  WindowsPrinterSpooler,
  WindowsPrinterSummary,
} from "../integrations/printers/star-tsp1000-lan/star-tsp1000-lan";
import type { DiagnosticLogEvent } from "./diagnostic-log";

type PowerShellRunOptions = {
  input?: string;
  environment?: Record<string, string>;
  signal?: AbortSignal;
};

export type PowerShellRunner = (
  script: string,
  options?: PowerShellRunOptions,
) => Promise<string>;

const LIST_PRINTERS_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Printer |
  Select-Object Name, DriverName, PortName, PrinterStatus |
  ConvertTo-Json -Compress
`;

const PRINT_TEXT_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$printerName = $env:MENUEQR_WINDOWS_PRINTER_NAME
$printer = Get-Printer -Name $printerName -ErrorAction Stop
$text = [Console]::In.ReadToEnd()
$text | Out-Printer -Name $printer.Name
`;

export class PowerShellWindowsPrinterSpooler
  implements WindowsPrinterSpooler
{
  constructor(
    private readonly runPowerShell: PowerShellRunner = runPowerShellProcess,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly onEvent?: (
      event: DiagnosticLogEvent,
    ) => void | Promise<void>,
  ) {}

  async listPrinters(): Promise<readonly WindowsPrinterSummary[]> {
    const startedAt = Date.now();
    void this.emit({
      event: "windows_spooler.list_started",
      state: "running",
    });
    this.assertWindows();
    try {
      const output = await this.runPowerShell(LIST_PRINTERS_SCRIPT);
      if (!output.trim()) {
        void this.emit({
          event: "windows_spooler.list_completed",
          state: "empty",
          details: { count: 0, durationMs: Date.now() - startedAt },
        });
        return [];
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(output);
      } catch {
        throw windowsPrinterError("WINDOWS_PRINTER_LIST_INVALID");
      }
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const printers = entries
        .map(parsePrinter)
        .filter((printer): printer is WindowsPrinterSummary => printer !== null)
        .sort((left, right) => left.name.localeCompare(right.name, "de"));
      void this.emit({
        event: "windows_spooler.list_completed",
        state: "succeeded",
        details: {
          count: printers.length,
          durationMs: Date.now() - startedAt,
        },
      });
      return printers;
    } catch (error) {
      void this.emit({
        event: "windows_spooler.list_failed",
        code: windowsErrorCode(error),
        state: "failed",
        details: {
          durationMs: Date.now() - startedAt,
          exitCode: windowsExitCode(error),
        },
      });
      throw error;
    }
  }

  async printText(
    printerName: string,
    text: string,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now();
    void this.emit({
      event: "windows_spooler.print_started",
      state: "running",
      details: {
        characters: text.length,
        lines: text.split(/\r?\n/).length,
      },
    });
    this.assertWindows();
    if (!safePrinterName(printerName) || !text || text.length > 64 * 1024) {
      throw windowsPrinterError("WINDOWS_PRINT_INVALID");
    }
    try {
      await this.runPowerShell(PRINT_TEXT_SCRIPT, {
        input: text,
        environment: { MENUEQR_WINDOWS_PRINTER_NAME: printerName },
        signal,
      });
      void this.emit({
        event: "windows_spooler.print_completed",
        code: "WINDOWS_PRINT_JOB_ACCEPTED",
        state: "succeeded",
        details: { durationMs: Date.now() - startedAt },
      });
    } catch (error) {
      void this.emit({
        event: "windows_spooler.print_failed",
        code: windowsErrorCode(error),
        state: "failed",
        details: {
          durationMs: Date.now() - startedAt,
          exitCode: windowsExitCode(error),
        },
      });
      if (signal.aborted) throw new Error("CANCELED");
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "WINDOWS_PRINT_INVALID"
      ) {
        throw error;
      }
      throw windowsPrinterError("WINDOWS_PRINT_FAILED");
    }
  }

  private assertWindows(): void {
    if (this.platform !== "win32") {
      throw windowsPrinterError("WINDOWS_SPOOLER_UNAVAILABLE");
    }
  }

  private async emit(event: DiagnosticLogEvent): Promise<void> {
    await this.onEvent?.(event);
  }
}

function windowsErrorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : "WINDOWS_PRINT_FAILED";
}

function windowsExitCode(error: unknown): number {
  const exitCode = (error as { exitCode?: unknown } | undefined)?.exitCode;
  return typeof exitCode === "number" ? exitCode : -1;
}

function parsePrinter(value: unknown): WindowsPrinterSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const printer = value as Record<string, unknown>;
  if (!safePrinterName(printer.Name)) return null;
  return {
    name: printer.Name,
    driverName: safeMetadata(printer.DriverName),
    portName: safeMetadata(printer.PortName),
    status: safeMetadata(printer.PrinterStatus),
  };
}

function safePrinterName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function safeMetadata(value: unknown): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).length > 256 ||
    /[\u0000-\u001f\u007f]/.test(String(value))
  ) {
    return "";
  }
  return String(value);
}

function windowsPrinterError(
  code: string,
  exitCode?: number,
): Error & { code: string; exitCode?: number } {
  return Object.assign(new Error(code), {
    code,
    ...(exitCode === undefined ? {} : { exitCode }),
  });
}

function runPowerShellProcess(
  script: string,
  options: PowerShellRunOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      {
        env: { ...process.env, ...options.environment },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      settle(windowsPrinterError("WINDOWS_SPOOLER_TIMEOUT"));
    }, 15_000);
    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(Buffer.concat(stdout).toString("utf8").trim());
    };
    const onAbort = () => {
      child.kill();
      settle(new Error("CANCELED"));
    };
    child.once("error", () =>
      settle(windowsPrinterError("WINDOWS_SPOOLER_UNAVAILABLE")),
    );
    child.once("close", (code) => {
      if (code === 0) settle();
      else settle(windowsPrinterError("WINDOWS_POWERSHELL_FAILED", code ?? -1));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > 256 * 1024) {
        child.kill();
        settle(windowsPrinterError("WINDOWS_SPOOLER_OUTPUT_TOO_LARGE"));
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    // Intentionally do not retain or surface stderr: it can contain local
    // printer names or driver details. Exit codes are sufficient for UI errors.
    child.stderr.resume();
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdin.end(options.input ?? "", "utf8");
  });
}
