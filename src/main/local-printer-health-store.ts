import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import type { AdapterHealth } from "../contracts";

type PrinterHealthFile = {
  version: 1;
  printers: Record<string, AdapterHealth>;
};

const EMPTY: PrinterHealthFile = { version: 1, printers: {} };

export class LocalPrinterHealthStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<Record<string, AdapterHealth>> {
    try {
      const parsed: unknown = JSON.parse(
        await fs.readFile(this.filePath, "utf8"),
      );
      if (!isPrinterHealthFile(parsed)) {
        throw new Error("Invalid printer health file.");
      }
      return parsed.printers;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async write(printers: Record<string, AdapterHealth>): Promise<void> {
    const value: PrinterHealthFile = { version: 1, printers };
    if (!isPrinterHealthFile(value)) {
      throw new Error("Invalid printer health file.");
    }
    await fs.mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, this.filePath);
  }
}

function isPrinterHealthFile(value: unknown): value is PrinterHealthFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Partial<PrinterHealthFile>;
  if (
    file.version !== 1 ||
    !file.printers ||
    typeof file.printers !== "object" ||
    Array.isArray(file.printers)
  ) {
    return false;
  }
  return Object.entries(file.printers).every(
    ([id, health]) =>
      /^[a-zA-Z0-9_-]{1,80}$/.test(id) && isAdapterHealth(health),
  );
}

function isAdapterHealth(value: unknown): value is AdapterHealth {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const health = value as Partial<AdapterHealth>;
  return Boolean(
    ["ready", "degraded", "offline", "misconfigured"].includes(
      health.status ?? "",
    ) &&
      typeof health.code === "string" &&
      health.code.length <= 80 &&
      typeof health.message === "string" &&
      health.message.length <= 500 &&
      typeof health.checkedAt === "string" &&
      !Number.isNaN(Date.parse(health.checkedAt)),
  );
}
