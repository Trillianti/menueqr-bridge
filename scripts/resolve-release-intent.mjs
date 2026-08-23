import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const currentVersion = validateVersion(packageJson.version);
const eventName = process.env.GITHUB_EVENT_NAME?.trim() ?? "";
const event = readEvent(process.env.GITHUB_EVENT_PATH);

let publish = false;
let tag = `bridge-v${currentVersion}`;
let reason = "No Bridge release requested.";

if (eventName === "release") {
  const releaseTag = String(event.release?.tag_name ?? "");
  if (releaseTag.startsWith("bridge-")) {
    validateTag(releaseTag, currentVersion);
    if (event.release?.prerelease) {
      throw new Error("Prereleases cannot be published to the stable Bridge update channel.");
    }
    tag = releaseTag;
    publish = true;
    reason = `Published GitHub release ${tag}.`;
  }
} else if (eventName === "workflow_dispatch") {
  publish = true;
  reason = `Manual stable release ${tag}.`;
} else if (eventName === "push" && process.env.GITHUB_REF === "refs/heads/main") {
  const previousVersion = readPreviousVersion(String(event.before ?? ""));
  if (previousVersion && previousVersion !== currentVersion) {
    if (compareVersions(currentVersion, previousVersion) <= 0) {
      throw new Error(
        `Bridge version must increase (${previousVersion} -> ${currentVersion}).`,
      );
    }
    publish = true;
    reason = `Bridge version changed from ${previousVersion} to ${currentVersion}.`;
  }
}

writeOutput("publish", String(publish));
writeOutput("version", currentVersion);
writeOutput("tag", tag);
writeOutput("reason", reason);
process.stdout.write(`${reason}\n`);

function validateVersion(value) {
  const version = String(value ?? "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Bridge package version must be stable semver, received: ${version}`);
  }
  return version;
}

function validateTag(value, version) {
  const expected = `bridge-v${version}`;
  if (value !== expected) {
    throw new Error(`Bridge release tag must equal ${expected}, received: ${value}`);
  }
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function readEvent(filePath) {
  if (!filePath) return {};
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readPreviousVersion(commit) {
  if (!/^[0-9a-f]{40}$/i.test(commit) || /^0+$/.test(commit)) return null;
  const raw = execFileSync(
    "git",
    ["show", `${commit}:package.json`],
    { encoding: "utf8" },
  );
  return validateVersion(JSON.parse(raw).version);
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(outputPath, `${name}=${value}\n`, "utf8");
}
