import type { DeviceCodeResponse, PairingStatus } from "../contracts";
import type { RedactedCredentialState } from "./credential-store";

export type PairingState =
  | { kind: "unpaired" }
  | { kind: "requesting_code" }
  | {
      kind: "waiting_for_approval";
      userCode: string;
      expiresAt: string;
      pollingIntervalSeconds: number;
    }
  | {
      kind: "slow_down";
      userCode: string;
      expiresAt: string;
      pollingIntervalSeconds: number;
    }
  | {
      kind: "paired";
      credential: Exclude<RedactedCredentialState, { kind: "unpaired" }>;
    }
  | { kind: "denied"; message: string }
  | { kind: "revoked"; message: string }
  | { kind: "expired"; message: string }
  | { kind: "network_error"; message: string }
  | { kind: "secure_storage_unavailable"; message: string }
  | { kind: "secure_storage_corrupt"; message: string };

export function waitingState(code: DeviceCodeResponse): PairingState {
  return {
    kind: "waiting_for_approval",
    userCode: code.userCode,
    expiresAt: code.expiresAt,
    pollingIntervalSeconds: code.pollingIntervalSeconds,
  };
}

export function applyPairingStatus(
  current: PairingState,
  status: PairingStatus,
  credential: Exclude<RedactedCredentialState, { kind: "unpaired" }> | null,
): PairingState {
  const waiting =
    current.kind === "waiting_for_approval" || current.kind === "slow_down";
  if (status.kind === "approved") {
    if (!credential)
      throw new Error("Approved pairing requires stored credentials.");
    return { kind: "paired", credential };
  }
  if (status.kind === "denied")
    return { kind: "denied", message: status.message };
  if (status.kind === "expired" || status.kind === "consumed") {
    return { kind: "expired", message: status.message };
  }
  if (!waiting) return current;
  if (status.kind === "slow_down") {
    return {
      ...current,
      kind: "slow_down",
      pollingIntervalSeconds: status.pollingIntervalSeconds,
    };
  }
  return {
    ...current,
    kind: "waiting_for_approval",
    pollingIntervalSeconds: status.pollingIntervalSeconds,
  };
}

export function isPairingTerminal(state: PairingState): boolean {
  return [
    "unpaired",
    "paired",
    "denied",
    "expired",
    "revoked",
    "secure_storage_unavailable",
    "secure_storage_corrupt",
  ].includes(state.kind);
}
