import type {
  DeviceCodeRequest,
  DeviceCodeResponse,
  PairingStatus,
} from "../contracts";
import type { PairingApi } from "./pairing-service";
import type {
  BridgeRuntimeClient,
  RuntimePollResult,
  RuntimeSessionWatchResult,
} from "../core/bridge-runtime";
import type { BridgeCredential } from "../core/credential-store";
import type { PrinterSupportRequest } from "./pairing-service";
import type { HeartbeatRequest, HeartbeatResponse } from "../contracts";

export class HttpPairingApi implements PairingApi, BridgeRuntimeClient {
  constructor(private readonly apiBaseUrl: string) {}

  async createDeviceCode(
    request: DeviceCodeRequest,
  ): Promise<DeviceCodeResponse> {
    return this.request("/bridge/v1/device-codes", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async pollForToken(deviceCode: string): Promise<PairingStatus> {
    try {
      const payload = await this.request<unknown>(
        `/bridge/v1/device-codes/${encodeURIComponent(deviceCode)}/token`,
      );
      return toPairingStatus(payload);
    } catch (error) {
      if (error instanceof BridgeApiError) {
        if (error.code === "BRIDGE_PAIRING_DENIED")
          return { kind: "denied", message: error.message };
        if (error.code === "BRIDGE_PAIRING_EXPIRED")
          return { kind: "expired", message: error.message };
        if (error.code === "BRIDGE_PAIRING_CONSUMED")
          return { kind: "consumed", message: error.message };
      }
      throw error;
    }
  }

  async revokeCurrentDevice(token: string): Promise<void> {
    await this.request("/bridge/v1/disconnect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async submitPrinterSupportRequest(
    credential: BridgeCredential,
    request: PrinterSupportRequest,
  ): Promise<void> {
    await this.request("/bridge/v1/printer-support-requests", {
      method: "POST",
      headers: { authorization: `Bearer ${credential.token}` },
      body: JSON.stringify(request),
    });
  }

  async heartbeat(
    credential: BridgeCredential,
    request: HeartbeatRequest,
    signal: AbortSignal,
  ): Promise<HeartbeatResponse> {
    try {
      return await this.request("/bridge/v1/heartbeat", {
        method: "POST",
        body: JSON.stringify(request),
        headers: { authorization: `Bearer ${credential.token}` },
        signal,
      });
    } catch (error) {
      if (error instanceof BridgeApiError && error.code === "BRIDGE_DEVICE_REVOKED") {
        return {
          serverTimestamp: new Date().toISOString(),
          acceptedContractVersions: [],
          heartbeatIntervalSeconds: 5,
          runtime: { kind: "revoked", message: error.message },
        };
      }
      throw error;
    }
  }

  async nextJob(
    credential: BridgeCredential,
    signal: AbortSignal,
  ): Promise<RuntimePollResult> {
    return this.request("/bridge/v1/jobs/next?waitSeconds=25", {
      headers: { authorization: `Bearer ${credential.token}` },
      signal,
    });
  }

  async watchSession(
    credential: BridgeCredential,
    signal: AbortSignal,
  ): Promise<RuntimeSessionWatchResult> {
    try {
      return await this.request("/bridge/v1/session/watch?waitSeconds=25", {
        headers: { authorization: `Bearer ${credential.token}` },
        signal,
      });
    } catch (error) {
      if (
        error instanceof BridgeApiError &&
        error.code === "BRIDGE_DEVICE_REVOKED"
      ) {
        return { kind: "revoked", message: error.message };
      }
      throw error;
    }
  }

  async acknowledge(
    credential: BridgeCredential,
    job: Extract<RuntimePollResult, { kind: "job" }>,
    metadata: Record<string, string | number | boolean | null>,
    signal: AbortSignal,
  ): Promise<void> {
    await this.request(
      `/bridge/v1/jobs/${encodeURIComponent(job.job.id)}/ack`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${credential.token}` },
        body: JSON.stringify({ leaseToken: job.lease.token, metadata }),
        signal,
      },
    );
  }

  async fail(
    credential: BridgeCredential,
    job: Extract<RuntimePollResult, { kind: "job" }>,
    kind: "retryable_failure" | "terminal_failure",
    code: string,
    message: string,
    signal: AbortSignal,
  ): Promise<void> {
    await this.request(
      `/bridge/v1/jobs/${encodeURIComponent(job.job.id)}/fail`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${credential.token}` },
        body: JSON.stringify({
          leaseToken: job.lease.token,
          kind,
          code,
          message,
        }),
        signal,
      },
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const onAbort = () => controller.abort();
    if (init.signal?.aborted) onAbort();
    else init.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(`${this.apiBaseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: T;
        error?: { code?: string; message?: string };
      } | null;
      if (!response.ok)
        throw new BridgeApiError(
          safeRequestMessage(
            payload?.error?.message ??
              `Bridge request failed (${response.status}).`,
          ),
          payload?.error?.code,
        );
      return (payload?.data ?? payload) as T;
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", onAbort);
    }
  }
}

class BridgeApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BridgeApiError";
  }
}

function toPairingStatus(value: unknown): PairingStatus {
  if (!value || typeof value !== "object")
    throw new Error("Pairing response is invalid.");
  const payload = value as Record<string, unknown>;
  const status = payload.status;
  const pollingIntervalSeconds = payload.pollingIntervalSeconds;

  if (
    (status === "authorization_pending" || status === "slow_down") &&
    typeof pollingIntervalSeconds === "number"
  ) {
    return { kind: status, pollingIntervalSeconds };
  }

  if (status === "approved") {
    const device = payload.device as Record<string, unknown> | undefined;
    const restaurant = device?.restaurant as Record<string, unknown> | undefined;
    if (
      typeof device?.id !== "string" ||
      typeof device.token !== "string" ||
      typeof restaurant?.id !== "string" ||
      typeof restaurant.displayName !== "string"
    ) {
      throw new Error("Approved pairing response is invalid.");
    }
    return {
      kind: "approved",
      token: {
        deviceId: device.id,
        token: device.token,
        restaurant: {
          id: restaurant.id,
          displayName: restaurant.displayName,
        },
        issuedAt: new Date().toISOString(),
      },
    };
  }

  throw new Error("Pairing response is invalid.");
}

function safeRequestMessage(value: string): string {
  return value
    .replace(/(?:Bearer\s+)?[A-Za-z0-9._-]{20,}/g, "[redacted]")
    .replace(/\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[redacted]")
    .replace(/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, "[redacted]")
    .slice(0, 240);
}
