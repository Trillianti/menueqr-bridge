import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { basename, join } from "node:path";

const required = [
  "MENUEQR_BRIDGE_UPDATE_R2_ENDPOINT",
  "MENUEQR_BRIDGE_UPDATE_R2_BUCKET",
  "MENUEQR_BRIDGE_UPDATE_R2_ACCESS_KEY_ID",
  "MENUEQR_BRIDGE_UPDATE_R2_SECRET_ACCESS_KEY",
  "MENUEQR_BRIDGE_UPDATE_R2_PREFIX",
  "MENUEQR_BRIDGE_UPDATE_PUBLIC_URL",
];

const environment = Object.fromEntries(
  required.map((name) => [name, process.env[name]?.trim() ?? ""]),
);
const missing = required.filter((name) => !environment[name]);
if (missing.length > 0) {
  throw new Error(`Missing release environment: ${missing.join(", ")}`);
}

const publicUrl = new URL(environment.MENUEQR_BRIDGE_UPDATE_PUBLIC_URL);
if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password) {
  throw new Error("MENUEQR_BRIDGE_UPDATE_PUBLIC_URL must be an HTTPS URL without credentials.");
}

const packageVersion = String(
  JSON.parse(await fs.readFile(join(process.cwd(), "package.json"), "utf8"))
    .version ?? "",
);
if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) {
  throw new Error("Bridge package version must be stable semver.");
}
await assertMonotonicChannel(packageVersion);

const prefix = environment.MENUEQR_BRIDGE_UPDATE_R2_PREFIX.replace(/^\/+|\/+$/g, "");
if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/.test(prefix)) {
  throw new Error("MENUEQR_BRIDGE_UPDATE_R2_PREFIX is invalid.");
}

const releaseDirectory = join(process.cwd(), "release");
const entries = await fs.readdir(releaseDirectory);
const installer = entries.find(
  (name) => name.endsWith("-Setup.exe") && !name.includes("__uninstaller"),
);
if (!installer || !entries.includes("latest.yml")) {
  throw new Error("Release output must include the NSIS installer and latest.yml.");
}

// Publish immutable binaries first and latest.yml last. Installed applications
// must never see a manifest before every file referenced by it is available.
const files = [
  installer,
  `${installer}.blockmap`,
  "SHA256SUMS.txt",
  "latest.yml",
];
for (const file of files) {
  await fs.access(join(releaseDirectory, file));
}

const client = new S3Client({
  region: "auto",
  endpoint: environment.MENUEQR_BRIDGE_UPDATE_R2_ENDPOINT,
  credentials: {
    accessKeyId: environment.MENUEQR_BRIDGE_UPDATE_R2_ACCESS_KEY_ID,
    secretAccessKey: environment.MENUEQR_BRIDGE_UPDATE_R2_SECRET_ACCESS_KEY,
  },
});

for (const file of files) {
  const metadata = publishMetadata(file);
  const filePath = join(releaseDirectory, file);
  const digest = await sha256(filePath);
  const key = `${prefix}/${basename(file)}`;
  if (metadata.immutable && (await immutableObjectMatches(key, digest))) {
    process.stdout.write(`Update artifact already published: ${file}\n`);
    continue;
  }
  await client.send(
    new PutObjectCommand({
      Bucket: environment.MENUEQR_BRIDGE_UPDATE_R2_BUCKET,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: metadata.contentType,
      CacheControl: metadata.cacheControl,
      Metadata: { sha256: digest },
    }),
  );
  process.stdout.write(`Published update artifact: ${file}\n`);
}

function publishMetadata(file) {
  if (file === "latest.yml") {
    return {
      contentType: "application/x-yaml; charset=utf-8",
      cacheControl: "no-cache, no-store, must-revalidate",
      immutable: false,
    };
  }
  if (file === "SHA256SUMS.txt") {
    return {
      contentType: "text/plain; charset=utf-8",
      cacheControl: "no-cache, no-store, must-revalidate",
      immutable: false,
    };
  }
  return {
    contentType: "application/octet-stream",
    cacheControl: "public, max-age=31536000, immutable",
    immutable: true,
  };
}

async function immutableObjectMatches(key, digest) {
  try {
    const existing = await client.send(
      new HeadObjectCommand({
        Bucket: environment.MENUEQR_BRIDGE_UPDATE_R2_BUCKET,
        Key: key,
      }),
    );
    const existingDigest = existing.Metadata?.sha256;
    if (existingDigest === digest) return true;
    throw new Error(
      `Refusing to overwrite immutable update artifact with different bytes: ${key}`,
    );
  } catch (error) {
    if (isMissingObject(error)) return false;
    throw error;
  }
}

function isMissingObject(error) {
  if (!error || typeof error !== "object") return false;
  const status = error.$metadata?.httpStatusCode;
  return status === 404 || error.name === "NotFound" || error.name === "NoSuchKey";
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertMonotonicChannel(nextVersion) {
  const base = publicUrl.toString().endsWith("/")
    ? publicUrl.toString()
    : `${publicUrl.toString()}/`;
  const manifestUrl = new URL("latest.yml", base);
  manifestUrl.searchParams.set("release-check", Date.now().toString());
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (response.status === 404) return;
  if (!response.ok) {
    throw new Error(`Existing update manifest returned HTTP ${response.status}.`);
  }
  const manifest = await response.text();
  const currentVersion = manifest.match(/^version:\s*['"]?([0-9]+\.[0-9]+\.[0-9]+)['"]?\s*$/m)?.[1];
  if (!currentVersion) {
    throw new Error("Existing update manifest has no valid stable version.");
  }
  if (compareVersions(nextVersion, currentVersion) < 0) {
    throw new Error(
      `Refusing to downgrade update channel from ${currentVersion} to ${nextVersion}.`,
    );
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
