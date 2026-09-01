import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(__dirname, "../..");
const packageJson = require(join(packageRoot, "package.json")) as {
  scripts: Record<string, string>;
};

describe("Windows update release configuration", () => {
  const releaseConfig = readFileSync(
    join(packageRoot, "electron-builder.release.yml"),
    "utf8",
  );
  const workflow = readFileSync(
    join(packageRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const releaseWorkflow = readFileSync(
    join(packageRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );
  const publisher = readFileSync(
    join(packageRoot, "scripts", "publish-updates.mjs"),
    "utf8",
  );
  const mainProcess = readFileSync(
    join(packageRoot, "src", "main", "index.ts"),
    "utf8",
  );
  const installerConfig = readFileSync(
    join(packageRoot, "electron-builder.yml"),
    "utf8",
  );

  it("generates stable GitHub update metadata without requiring elevation", () => {
    expect(releaseConfig).toContain("extends: ./electron-builder.yml");
    expect(releaseConfig).toContain("forceCodeSigning: false");
    expect(releaseConfig).toContain("provider: github");
    expect(releaseConfig).toContain("owner: Trillianti");
    expect(releaseConfig).toContain("repo: menueqr-bridge");
    expect(packageJson.scripts["package:win:update"]).toContain(
      "--publish never",
    );
  });

  it("shuts down printing before a per-user update and preserves user data", () => {
    const installHandler = mainProcess.slice(
      mainProcess.indexOf("BRIDGE_FOUNDATION_CHANNELS.installUpdate"),
      mainProcess.indexOf("function validateDiscoveredPrinterConfirmation"),
    );
    expect(installHandler.indexOf("await runtime.shutdown()"))
      .toBeGreaterThan(-1);
    expect(installHandler.indexOf("await runtime.shutdown()"))
      .toBeLessThan(installHandler.indexOf("updates.install()"));
    expect(installerConfig).toContain("perMachine: false");
    expect(installerConfig).toContain("allowElevation: false");
    expect(installerConfig).toContain("deleteAppDataOnUninstall: false");
  });

  it("keeps CI separate from the protected automatic release pipeline", () => {
    expect(workflow).not.toContain("publish-windows-update:");
    expect(releaseWorkflow).toContain("types: [published]");
    expect(releaseWorkflow).toContain("resolve-release-intent.mjs");
    expect(releaseWorkflow).toContain("npm run package:win:update");
    expect(releaseWorkflow).toContain('$_.Name -eq "latest.yml"');
    expect(releaseWorkflow).toContain('$_.Name -like "*-Setup.exe.blockmap"');
    expect(releaseWorkflow).not.toContain("npm run publish:updates");
    expect(releaseWorkflow).toContain("gh release upload");
    expect(publisher).toContain('"latest.yml"');
    expect(publisher).toContain(".blockmap");
    expect(publisher).toContain("SHA256SUMS.txt");
    expect(publisher).toContain("MENUEQR_BRIDGE_UPDATE_R2_SECRET_ACCESS_KEY");
    const publishOrder = publisher.slice(publisher.indexOf("const files = ["));
    expect(publishOrder.indexOf("installer,")).toBeLessThan(
      publishOrder.indexOf('"latest.yml"'),
    );
    expect(publisher).toContain("Refusing to overwrite immutable update artifact");
    expect(publisher).toContain("Refusing to downgrade update channel");
  });
});
