import { AutostartAdapter } from "../../src/main/autostart";
import {
  createShellSnapshot,
  isInstallerOrUpdaterLaunch,
} from "../../src/main/shell-state";

describe("Windows shell policy", () => {
  it("reads, updates, and applies an installer-selected autostart preference", () => {
    let enabled = false;
    const app = {
      getLoginItemSettings: jest.fn(() => ({ openAtLogin: enabled })),
      setLoginItemSettings: jest.fn(
        ({ openAtLogin }: { openAtLogin: boolean }) => {
          enabled = openAtLogin;
        },
      ),
    };
    const adapter = new AutostartAdapter(app);

    expect(adapter.isEnabled()).toBe(false);
    expect(adapter.applyInstallerPreference(["--bridge-autostart"])).toBe(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      args: ["--bridge-autostart"],
    });
    expect(adapter.setEnabled(false)).toBe(false);
  });

  it("keeps only truthful shell states and recognizes updater arguments", () => {
    expect(createShellSnapshot("paused", true)).toEqual({
      runtime: { kind: "paused" },
      autostartEnabled: true,
    });
    expect(isInstallerOrUpdaterLaunch(["--updated"])).toBe(true);
    expect(isInstallerOrUpdaterLaunch(["--bridge-autostart"])).toBe(false);
  });
});
