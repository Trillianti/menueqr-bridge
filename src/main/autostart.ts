export type LoginItemSettings = {
  openAtLogin?: boolean;
};

export type LoginItemApp = {
  getLoginItemSettings(): LoginItemSettings;
  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    args?: string[];
  }): void;
};

export class AutostartAdapter {
  constructor(private readonly electronApp: LoginItemApp) {}

  isEnabled(): boolean {
    return this.electronApp.getLoginItemSettings().openAtLogin === true;
  }

  setEnabled(enabled: boolean): boolean {
    this.electronApp.setLoginItemSettings({
      openAtLogin: enabled,
      args: enabled ? ["--bridge-autostart"] : [],
    });
    return this.isEnabled();
  }

  applyInstallerPreference(argv: readonly string[]): boolean {
    if (!argv.includes("--bridge-autostart")) return this.isEnabled();
    return this.setEnabled(true);
  }
}
