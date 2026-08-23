import type { BridgeRuntimeState, DiagnosticsSnapshot } from "../contracts";

export const FOUNDATION_RUNTIME_STATE: BridgeRuntimeState = {
  kind: "unpaired"
};

export function getFoundationDiagnostics(appVersion: string): DiagnosticsSnapshot {
  return {
    generatedAt: new Date(0).toISOString(),
    appVersion,
    runtime: FOUNDATION_RUNTIME_STATE,
    pairedRestaurant: null,
    adapters: [],
    recentJobIds: [],
    recentErrorCodes: []
  };
}
