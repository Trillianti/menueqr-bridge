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

  it("generates generic update metadata while signing approval is pending", () => {
    expect(releaseConfig).toContain("extends: ./electron-builder.yml");
    expect(releaseConfig).toContain("forceCodeSigning: false");
    expect(releaseConfig).toContain("provider: generic");
    expect(releaseConfig).toContain("${env.MENUEQR_BRIDGE_UPDATE_PUBLIC_URL}");
    expect(packageJson.scripts["package:win:update"]).toContain(
      "--publish always",
    );
  });

  it("keeps CI separate from the protected automatic release pipeline", () => {
    expect(workflow).not.toContain("publish-windows-update:");
    expect(releaseWorkflow).toContain("types: [published]");
    expect(releaseWorkflow).toContain("resolve-release-intent.mjs");
    expect(releaseWorkflow).toContain("npm run package:win");
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
