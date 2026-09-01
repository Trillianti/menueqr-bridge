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
    expect(builderConfig).toContain(
      "artifactName: MenueQR-Bridge-${version}-Setup.${ext}",
    );
  });

  it("asks explicitly about autostart and local-data removal", () => {
    expect(installerScript).toMatch(
      /!ifndef BUILD_UNINSTALLER[\s\S]*Function StartMenuQrBridge[\s\S]*!endif/,
    );
    expect(installerScript).toMatch(
      /Var \/GLOBAL BridgeLaunchTarget[\s\S]*StrCpy \$BridgeLaunchTarget "\$launchLink"[\s\S]*Function StartMenuQrBridge[\s\S]*\$BridgeLaunchTarget/,
    );
    expect(installerScript).not.toContain("${StdUtils.");
    expect(installerScript).toContain("MenüQR Bridge mit Windows starten");
    expect(installerScript).toContain("--bridge-autostart");
    expect(installerScript).toContain("WriteRegStr HKCU");
    expect(installerScript).toContain("Lokale MenüQR Bridge-Einstellungen");
    expect(installerScript).toContain("DeleteRegValue HKCU");
    expect(installerScript).toMatch(
      /!macro customUnInstall[\s\S]*\$\{IfNot\} \$\{isUpdated\}[\s\S]*DeleteRegValue HKCU[\s\S]*MessageBox[\s\S]*RMDir \/r "\$APPDATA[\s\S]*RMDir \/r "\$LOCALAPPDATA[\s\S]*\$\{EndIf\}[\s\S]*!macroend/,
    );
  });

  it("force-stops every Bridge image before replacing files without elevation", () => {
    expect(installerScript).toMatch(
      /!macro customInit[\s\S]*Call StopRunningMenuQrBridge[\s\S]*!macroend/,
    );
    expect(installerScript).toContain(
      'taskkill.exe" /F /IM "${PRODUCT_FILENAME}.exe"',
    );
    expect(installerScript).toContain("IntCmp $0 5");
    expect(installerScript).not.toMatch(/taskkill[^\r\n]*\s\/T(?:\s|$)/i);
    expect(builderConfig).toContain("perMachine: false");
    expect(builderConfig).toContain("allowElevation: false");
    expect(builderConfig).toContain("deleteAppDataOnUninstall: false");
  });

  it("bypasses legacy uninstallers only for updates without touching user data", () => {
    expect(installerScript).toMatch(
      /!macro customInit[\s\S]*\$\{If\} \$\{isUpdated\}[\s\S]*Call PrepareMenuQrBridgeUpdate[\s\S]*\$\{EndIf\}[\s\S]*!macroend/,
    );
    expect(installerScript).toMatch(
      /Function PrepareMenuQrBridgeUpdate[\s\S]*FileExists[^\r\n]*\$INSTDIR[\s\S]*DeleteRegKey SHELL_CONTEXT "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{UNINSTALL_APP_KEY\}"[\s\S]*RMDir \/r "\$INSTDIR"[\s\S]*FunctionEnd/,
    );
    const updatePreparation = installerScript.slice(
      installerScript.indexOf("Function PrepareMenuQrBridgeUpdate"),
      installerScript.indexOf("FunctionEnd", installerScript.indexOf("Function PrepareMenuQrBridgeUpdate")) + "FunctionEnd".length,
    );
    expect(updatePreparation).not.toContain("$APPDATA");
    expect(updatePreparation).not.toContain("$LOCALAPPDATA");
    expect(updatePreparation).not.toContain("CurrentVersion\\Run");
  });
});
