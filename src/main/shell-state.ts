export type ShellRuntimeKind =
  "unpaired" | "starting" | "paused" | "shell_error";

export type BridgeShellSnapshot = {
  runtime: { kind: ShellRuntimeKind };
  autostartEnabled: boolean;
};

export function createShellSnapshot(
  runtime: ShellRuntimeKind,
  autostartEnabled: boolean,
): BridgeShellSnapshot {
  return { runtime: { kind: runtime }, autostartEnabled };
}

export function isInstallerOrUpdaterLaunch(argv: readonly string[]): boolean {
  return argv.some((argument) =>
    ["--squirrel-firstrun", "--updated", "--updating", "--uninstall"].includes(
      argument,
    ),
  );
}
