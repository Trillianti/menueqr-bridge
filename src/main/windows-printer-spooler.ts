import { spawn } from "node:child_process";

import type {
  WindowsPrintOptions,
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
$paperWidthMm = 0
$copies = 0
if (-not [int]::TryParse($env:MENUEQR_WINDOWS_PAPER_WIDTH_MM, [ref]$paperWidthMm) -or $paperWidthMm -notin @(80, 82)) {
  throw 'WINDOWS_PRINT_INVALID_PAPER_WIDTH'
}
if (-not [int]::TryParse($env:MENUEQR_WINDOWS_COPIES, [ref]$copies) -or $copies -notin @(1, 2)) {
  throw 'WINDOWS_PRINT_INVALID_COPIES'
}

Add-Type -AssemblyName System.Drawing

$allLines = @($text -split "\\r?\\n")
$lineCount = $allLines.Count
while ($lineCount -gt 0 -and $allLines[$lineCount - 1] -eq '') {
  $lineCount -= 1
}
if ($lineCount -le 0) {
  throw 'WINDOWS_PRINT_EMPTY'
}
$lines = @($allLines | Select-Object -First $lineCount)
$columns = if ($paperWidthMm -eq 82) { 50 } else { 48 }
# Keep the 48/50-column receipt layout unchanged, but size the font as if two
# additional columns existed. This moves right-aligned dates, times, prices and
# currencies safely inside printer drivers that over-report the right edge.
$rightSafetyColumns = 2
$requestedWidth = [int][Math]::Round(($paperWidthMm / 25.4) * 100.0)
# A receipt-sized custom page prevents the default Windows text pipeline from
# adding A4-like margins and a long blank tail.
$requestedHeight = [int][Math]::Min(32760, [Math]::Max(100, ($lineCount * 14) + 24))

$document = [System.Drawing.Printing.PrintDocument]::new()
$document.DocumentName = 'MenüQR Küchenbon'
$document.PrintController = [System.Drawing.Printing.StandardPrintController]::new()
$document.PrinterSettings.PrinterName = $printer.Name
if (-not $document.PrinterSettings.IsValid) {
  throw 'WINDOWS_PRINTER_NOT_FOUND'
}
$document.PrinterSettings.Copies = 1
$document.OriginAtMargins = $false
$document.DefaultPageSettings.Margins = [System.Drawing.Printing.Margins]::new(0, 0, 0, 0)
$document.DefaultPageSettings.Color = $false
$document.DefaultPageSettings.Landscape = $false
$document.DefaultPageSettings.PaperSize = [System.Drawing.Printing.PaperSize]::new(
  "MenueQR $paperWidthMm mm",
  $requestedWidth,
  $requestedHeight
)

$handler = [System.Drawing.Printing.PrintPageEventHandler]{
  param($sender, $eventArgs)

  $graphics = $eventArgs.Graphics
  $graphics.PageUnit = [System.Drawing.GraphicsUnit]::Display
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
  $graphics.TranslateTransform(
    [single](-$eventArgs.PageSettings.HardMarginX),
    [single](-$eventArgs.PageSettings.HardMarginY)
  )

  $pageWidth = [single]$eventArgs.PageBounds.Width
  $targetWidth = [single][Math]::Min($pageWidth, $requestedWidth)
  $pageLeft = [single][Math]::Max(0, ($pageWidth - $targetWidth) / 2.0)
  $pageCenter = [single]($pageLeft + ($targetWidth / 2.0))
  $printable = $eventArgs.PageSettings.PrintableArea
  $printableLeft = [single][Math]::Max($pageLeft, $printable.Left)
  $printableRight = [single][Math]::Min($pageLeft + $targetWidth, $printable.Right)
  $symmetricHalfWidth = [single][Math]::Min(
    $pageCenter - $printableLeft,
    $printableRight - $pageCenter
  )
  if ($symmetricHalfWidth -le 4) {
    throw 'WINDOWS_PRINTABLE_AREA_TOO_NARROW'
  }

  $sidePadding = [single][Math]::Max(1, [Math]::Min(4, $symmetricHalfWidth * 0.02))
  $drawLeft = [single]($pageCenter - $symmetricHalfWidth + $sidePadding)
  $drawWidth = [single](($symmetricHalfWidth * 2.0) - ($sidePadding * 2.0))
  $drawTop = [single][Math]::Max($printable.Top + 3, 3)

  $format = [System.Drawing.StringFormat]::GenericTypographic.Clone()
  $format.FormatFlags = $format.FormatFlags -bor [System.Drawing.StringFormatFlags]::NoWrap -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces
  $format.Trimming = [System.Drawing.StringTrimming]::None
  $probeFont = [System.Drawing.Font]::new(
    'Consolas',
    10,
    [System.Drawing.FontStyle]::Regular,
    [System.Drawing.GraphicsUnit]::Point
  )
  try {
    $probe = '0' * ($columns + $rightSafetyColumns)
    $probeSize = $graphics.MeasureString($probe, $probeFont, 10000, $format)
    $fontSize = [single][Math]::Max(
      6,
      [Math]::Min(11, $probeFont.Size * ($drawWidth / $probeSize.Width) * 0.985)
    )
  } finally {
    $probeFont.Dispose()
  }

  $font = [System.Drawing.Font]::new(
    'Consolas',
    $fontSize,
    [System.Drawing.FontStyle]::Regular,
    [System.Drawing.GraphicsUnit]::Point
  )
  try {
    $lineHeight = [single]($font.GetHeight($graphics) * 1.08)
    $y = $drawTop
    foreach ($line in $lines) {
      $bounds = [System.Drawing.RectangleF]::new($drawLeft, $y, $drawWidth, $lineHeight)
      $graphics.DrawString($line, $font, [System.Drawing.Brushes]::Black, $bounds, $format)
      $y += $lineHeight
    }
  } finally {
    $font.Dispose()
    $format.Dispose()
  }

  $eventArgs.HasMorePages = $false
}

$document.add_PrintPage($handler)
try {
  # The Star driver cuts at the end of a Windows print job, not reliably at a
  # page boundary. Submit every requested bon as its own job so two copies are
  # physically separated by the cutter.
  for ($copyIndex = 0; $copyIndex -lt $copies; $copyIndex += 1) {
    $document.Print()
  }
} finally {
  $document.remove_PrintPage($handler)
  $document.Dispose()
}
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
    options: WindowsPrintOptions,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now();
    void this.emit({
      event: "windows_spooler.print_started",
      state: "running",
      details: {
        characters: text.length,
        lines: text.split(/\r?\n/).length,
        paperWidthMm: options.paperWidthMm,
        copies: options.copies,
      },
    });
    this.assertWindows();
    if (
      !safePrinterName(printerName) ||
      !text ||
      text.length > 64 * 1024 ||
      ![80, 82].includes(options.paperWidthMm) ||
      ![1, 2].includes(options.copies)
    ) {
      throw windowsPrinterError("WINDOWS_PRINT_INVALID");
    }
    try {
      await this.runPowerShell(PRINT_TEXT_SCRIPT, {
        input: text,
        environment: {
          MENUEQR_WINDOWS_PRINTER_NAME: printerName,
          MENUEQR_WINDOWS_PAPER_WIDTH_MM: String(options.paperWidthMm),
          MENUEQR_WINDOWS_COPIES: String(options.copies),
        },
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
