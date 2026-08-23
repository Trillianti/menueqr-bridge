import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";

const FINGERPRINT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DeviceFingerprintStore {
  constructor(private readonly path: string) {}

  async readOrCreate(): Promise<string> {
    try {
      const value = (await fs.readFile(this.path, "utf8")).trim();
      if (FINGERPRINT_PATTERN.test(value)) return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const fingerprint = randomUUID();
    await fs.mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.path, `${fingerprint}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return fingerprint;
  }
}
