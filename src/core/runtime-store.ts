import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import type { DesktopRuntimeState } from "./runtime-state";

export type StoredRuntimeState = {
  paused: boolean;
  lastState: DesktopRuntimeState | null;
  recentJobIds: string[];
  recentErrorCodes: string[];
  recentFailedJobIds: string[];
};

const EMPTY: StoredRuntimeState = {
  paused: false,
  lastState: null,
  recentJobIds: [],
  recentErrorCodes: [],
  recentFailedJobIds: [],
};

export class RuntimeStore {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(): Promise<StoredRuntimeState> {
    try {
      return validate(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { ...EMPTY };
      return { ...EMPTY };
    }
  }

  async write(value: StoredRuntimeState): Promise<void> {
    const safe = validate(value);
    this.writes = this.writes
      .catch(() => undefined)
      .then(() => this.writeAtomically(safe));
    return this.writes;
  }

  async flush(): Promise<void> {
    await this.writes.catch(() => undefined);
  }

  private async writeAtomically(value: StoredRuntimeState): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, this.filePath);
  }
}

function validate(value: unknown): StoredRuntimeState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ...EMPTY };
  const input = value as Partial<StoredRuntimeState>;
  return {
    paused: input.paused === true,
    lastState:
      input.lastState &&
      typeof input.lastState === "object" &&
      typeof input.lastState.kind === "string"
        ? input.lastState
        : null,
    recentJobIds: Array.isArray(input.recentJobIds)
      ? input.recentJobIds
          .filter((id): id is string => typeof id === "string")
          .slice(-20)
      : [],
    recentErrorCodes: Array.isArray(input.recentErrorCodes)
      ? input.recentErrorCodes
          .filter((code): code is string => typeof code === "string")
          .slice(-20)
      : [],
    recentFailedJobIds: Array.isArray(input.recentFailedJobIds)
      ? input.recentFailedJobIds
          .filter((id): id is string => typeof id === "string")
          .slice(-20)
      : [],
  };
}
