import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";

export type LocalJobState =
  | "received"
  | "in_flight"
  | "printed"
  | "ack_pending"
  | "succeeded"
  | "terminal"
  | "ambiguous";
export type LocalJobRecord = {
  jobId: string;
  payloadHash: string;
  state: LocalJobState;
  updatedAt: string;
  completedAt?: string;
  errorCode?: string;
};
type LedgerFile = { entries: LocalJobRecord[] };

export class ExecutionLedger {
  constructor(
    private readonly filePath: string,
    private readonly maxEntries = 200,
  ) {}

  async get(jobId: string): Promise<LocalJobRecord | null> {
    return (
      (await this.read()).entries.find((entry) => entry.jobId === jobId) ?? null
    );
  }

  async assertPayload(
    jobId: string,
    payload: unknown,
  ): Promise<LocalJobRecord | null> {
    const existing = await this.get(jobId);
    if (existing && existing.payloadHash !== hashPayload(payload)) {
      throw new Error("PAYLOAD_INTEGRITY_MISMATCH");
    }
    return existing;
  }

  async record(
    jobId: string,
    payload: unknown,
    state: LocalJobState,
    errorCode?: string,
  ): Promise<LocalJobRecord> {
    const file = await this.read();
    const payloadHash = hashPayload(payload);
    const existing = file.entries.find((entry) => entry.jobId === jobId);
    if (existing && existing.payloadHash !== payloadHash)
      throw new Error("PAYLOAD_INTEGRITY_MISMATCH");
    const next: LocalJobRecord = {
      jobId,
      payloadHash,
      state,
      updatedAt: new Date().toISOString(),
      ...(state === "succeeded"
        ? { completedAt: new Date().toISOString() }
        : {}),
      ...(errorCode ? { errorCode } : {}),
    };
    const entries = [
      ...file.entries.filter((entry) => entry.jobId !== jobId),
      next,
    ].slice(-this.maxEntries);
    await this.write({ entries });
    return next;
  }

  async prune(before: Date): Promise<void> {
    const file = await this.read();
    await this.write({
      entries: file.entries
        .filter(
          (entry) =>
            entry.state === "ack_pending" ||
            Date.parse(entry.updatedAt) >= before.getTime(),
        )
        .slice(-this.maxEntries),
    });
  }

  async recent(
    limit = 20,
  ): Promise<
    Array<Pick<LocalJobRecord, "jobId" | "state" | "updatedAt" | "errorCode">>
  > {
    return (await this.read()).entries.slice(-Math.max(1, Math.min(limit, 50)));
  }

  private async read(): Promise<LedgerFile> {
    try {
      const value = JSON.parse(
        await fs.readFile(this.filePath, "utf8"),
      ) as LedgerFile;
      return {
        entries: Array.isArray(value.entries)
          ? value.entries.filter(isRecord).slice(-this.maxEntries)
          : [],
      };
    } catch {
      return { entries: [] };
    }
  }

  private async write(value: LedgerFile): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporary, this.filePath);
  }
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function isRecord(value: unknown): value is LocalJobRecord {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { jobId?: unknown }).jobId === "string" &&
    typeof (value as { payloadHash?: unknown }).payloadHash === "string" &&
    typeof (value as { state?: unknown }).state === "string",
  );
}
