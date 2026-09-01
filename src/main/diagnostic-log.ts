import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export type DiagnosticDetail = string | number | boolean | null;

export type DiagnosticLogEvent = {
  event: string;
  code?: string;
  message?: string;
  jobId?: string;
  adapterId?: string;
  state?: string;
  details?: Record<string, DiagnosticDetail>;
};

export type DiagnosticLogEntry = DiagnosticLogEvent & { timestamp: string };

export class DiagnosticLog {
  private appendQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly directory: string,
    private readonly maxFiles = 10,
    private readonly maxBytes = 1024 * 1024,
  ) {}

  async append(event: DiagnosticLogEvent): Promise<void> {
    const write = this.appendQueue
      .catch(() => undefined)
      .then(() => this.appendNow(event));
    // Diagnostics must never crash or stall kitchen printing when the disk is
    // full, locked, or temporarily unavailable.
    this.appendQueue = write.catch(() => undefined);
    return this.appendQueue;
  }

  private async appendNow(event: DiagnosticLogEvent): Promise<void> {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...sanitizeEvent(event),
    });
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const current = this.currentPath();
    try {
      if (
        (await fs.stat(current)).size + Buffer.byteLength(entry) + 1 >
        this.maxBytes
      ) {
        await this.rotate();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.appendFile(this.currentPath(), `${entry}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  async recent(maxEntries = 80): Promise<DiagnosticLogEntry[]> {
    await this.appendQueue.catch(() => undefined);
    const files = Array.from({ length: this.maxFiles }, (_, index) =>
      index === 0 ? this.currentPath() : this.rotatedPath(index),
    ).reverse();
    const entries: DiagnosticLogEntry[] = [];
    for (const filePath of files) {
      try {
        const lines = (await fs.readFile(filePath, "utf8")).split("\n");
        for (const line of lines) {
          if (!line) continue;
          const parsed = JSON.parse(line) as unknown;
          if (isLogEntry(parsed)) entries.push(sanitizeEntry(parsed));
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
      }
    }
    return entries.slice(-Math.max(1, Math.min(maxEntries, 10_000)));
  }

  async all(): Promise<DiagnosticLogEntry[]> {
    return this.recent(10_000);
  }

  path(): string {
    return this.directory;
  }

  private currentPath(): string {
    return join(this.directory, "bridge.log");
  }

  private rotatedPath(index: number): string {
    return join(this.directory, `bridge.${index}.log`);
  }

  private async rotate(): Promise<void> {
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const source =
        index === 1 ? this.currentPath() : this.rotatedPath(index - 1);
      const target = this.rotatedPath(index);
      try {
        await fs.rename(source, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}\b/gi, "Bearer [redacted]")
    .replace(
      /\b(?:token|secret|password|authorization)\s*[=:]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]")
    .replace(
      /\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
      "[redacted-local-address]",
    )
    .replace(/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, "[redacted-local-address]")
    .replace(
      /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g,
      "[redacted-local-address]",
    )
    .replace(/\b(?:localhost|[a-z0-9-]+\.local)\b/gi, "[redacted-local-host]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

function sanitizeEvent(event: DiagnosticLogEvent): DiagnosticLogEvent {
  return {
    event: sanitizeIdentifier(event.event, "unknown"),
    ...(event.code ? { code: sanitizeIdentifier(event.code, "UNKNOWN") } : {}),
    ...(event.message ? { message: redactDiagnosticText(event.message) } : {}),
    ...(event.jobId
      ? { jobId: fingerprintDiagnosticId(event.jobId) }
      : {}),
    ...(event.adapterId
      ? { adapterId: sanitizeIdentifier(event.adapterId, "redacted") }
      : {}),
    ...(event.state
      ? { state: sanitizeIdentifier(event.state, "unknown") }
      : {}),
    ...(event.details ? { details: sanitizeDetails(event.details) } : {}),
  };
}

function sanitizeDetails(
  details: Record<string, DiagnosticDetail>,
): Record<string, DiagnosticDetail> {
  return Object.fromEntries(
    Object.entries(details)
      .slice(0, 32)
      .map(([key, value]) => {
        const safeKey = sanitizeIdentifier(key, "detail");
        if (typeof value !== "string") return [safeKey, value];
        const safeOperationalValue = [
          "transport",
          "jobType",
          "layout",
          "phase",
          "operation",
        ].includes(safeKey);
        return [
          safeKey,
          safeOperationalValue
            ? sanitizeIdentifier(value, "unknown")
            : fingerprintDiagnosticId(value),
        ];
      }),
  );
}

export function fingerprintDiagnosticId(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function sanitizeIdentifier(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 96);
  return normalized || fallback;
}

function isLogEntry(value: unknown): value is DiagnosticLogEntry {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { timestamp?: unknown }).timestamp === "string" &&
    typeof (value as { event?: unknown }).event === "string",
  );
}

function sanitizeEntry(value: DiagnosticLogEntry): DiagnosticLogEntry {
  return {
    timestamp: value.timestamp,
    ...sanitizeEvent(value),
  };
}
