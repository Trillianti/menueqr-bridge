import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import type {
  AdapterConfigFileStore,
  AdapterConfigurationFile,
} from "../integrations/adapter-config-store";

const EMPTY: AdapterConfigurationFile = { adapters: {} };

export class LocalAdapterConfigFileStore implements AdapterConfigFileStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<AdapterConfigurationFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!isConfigurationFile(parsed)) throw new Error("Invalid config file.");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
      throw error;
    }
  }

  async write(value: AdapterConfigurationFile): Promise<void> {
    if (!isConfigurationFile(value)) throw new Error("Invalid config file.");
    await fs.mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, this.filePath);
  }
}

function isConfigurationFile(
  value: unknown,
): value is AdapterConfigurationFile {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "adapters" in value &&
    typeof (value as { adapters?: unknown }).adapters === "object" &&
    (value as { adapters?: unknown }).adapters !== null &&
    !Array.isArray((value as { adapters?: unknown }).adapters),
  );
}
