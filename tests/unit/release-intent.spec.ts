import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = join(__dirname, "../..");
const script = join(packageRoot, "scripts", "resolve-release-intent.mjs");
const version = (
  JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    version: string;
  }
).version;

describe("Bridge release intent", () => {
  it("publishes a matching stable GitHub release", () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-release-"));
    const eventPath = join(directory, "event.json");
    const outputPath = join(directory, "output.txt");
    writeFileSync(
      eventPath,
      JSON.stringify({
        release: { tag_name: `bridge-v${version}`, prerelease: false },
      }),
    );

    execFileSync(process.execPath, [script], {
      cwd: packageRoot,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "release",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
      },
    });

    expect(readFileSync(outputPath, "utf8")).toContain("publish=true");
    expect(readFileSync(outputPath, "utf8")).toContain(
      `tag=bridge-v${version}`,
    );
  });

  it("rejects a release whose tag does not match package.json", () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-release-"));
    const eventPath = join(directory, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({
        release: { tag_name: "bridge-v99.0.0", prerelease: false },
      }),
    );

    const result = spawnSync(process.execPath, [script], {
      cwd: packageRoot,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "release",
        GITHUB_EVENT_PATH: eventPath,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      `Bridge release tag must equal bridge-v${version}`,
    );
  });
});
