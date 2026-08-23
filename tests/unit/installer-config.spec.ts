import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = require(join(__dirname, "../..", "package.json")) as {
  scripts: Record<string, string>;
};

const packageRoot = join(__dirname, "../..");

describe("Windows installer configuration", () => {
  const builderConfig = readFileSync(
    join(packageRoot, "electron-builder.yml"),
    "utf8",
  );
  const installerScript = readFileSync(
    join(packageRoot, "installer", "installer.nsh"),
    "utf8",
  );

  it("uses an assisted per-user NSIS installer with no automatic publishing", () => {
    expect(builderConfig).not.toContain("publish: never");
    expect(packageJson.scripts["package:win"]).toContain("--publish never");
    expect(builderConfig).not.toContain("toolsets:");
    expect(builderConfig).toContain("icon: assets/app-icon.png");
    expect(builderConfig).toContain("from: assets/menueqr-tray-windows.png");
    expect(builderConfig).toContain("to: menueqr-tray-windows.png");
    expect(builderConfig).toContain("to: bridge-logo.svg");
    expect(builderConfig).toContain("oneClick: false");
    expect(builderConfig).toContain("perMachine: false");
    expect(builderConfig).toContain("allowElevation: false");
    expect(builderConfig).toContain("include: installer/installer.nsh");
    expect(builderConfig).toContain("deleteAppDataOnUninstall: false");
  });

  it("asks explicitly about autostart and local-data removal", () => {
    expect(installerScript).toMatch(
      /!ifndef BUILD_UNINSTALLER[\s\S]*Function StartMenuQrBridge[\s\S]*!endif/,
    );
    expect(installerScript).toMatch(
      /Var \/GLOBAL BridgeLaunchTarget[\s\S]*StrCpy \$BridgeLaunchTarget "\$launchLink"[\s\S]*Function StartMenuQrBridge[\s\S]*\$BridgeLaunchTarget/,
    );
    expect(installerScript).not.toContain("${isUpdated}");
    expect(installerScript).not.toContain("${StdUtils.");
    expect(installerScript).toContain("MenüQR Bridge mit Windows starten");
    expect(installerScript).toContain("--bridge-autostart");
    expect(installerScript).toContain("WriteRegStr HKCU");
    expect(installerScript).toContain("Lokale MenüQR Bridge-Einstellungen");
    expect(installerScript).toContain("DeleteRegValue HKCU");
  });
});
