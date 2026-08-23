export type DesktopRuntimeKind =
  | "stopped"
  | "starting"
  | "ready"
  | "polling"
  | "processing"
  | "offline"
  | "degraded"
  | "feature_required"
  | "update_required"
  | "revoked"
  | "authentication_error"
  | "fatal_configuration_error"
  | "paused";

export type DesktopRuntimeState = {
  kind: DesktopRuntimeKind;
  code?: string;
  message?: string;
  updatedAt: string;
};

export function runtimeState(
  kind: DesktopRuntimeKind,
  code?: string,
  message?: string,
): DesktopRuntimeState {
  return {
    kind,
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    updatedAt: new Date().toISOString(),
  };
}
