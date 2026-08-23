import { promises as fs } from "node:fs";
import { join } from "node:path";

const publicUrl = new URL(
  process.env.MENUEQR_BRIDGE_UPDATE_PUBLIC_URL?.trim() ?? "",
);
if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password) {
  throw new Error("MENUEQR_BRIDGE_UPDATE_PUBLIC_URL must be a public HTTPS URL.");
}

const releaseDirectory = join(process.cwd(), "release");
const entries = await fs.readdir(releaseDirectory);
const installer = entries.find(
  (name) => name.endsWith("-Setup.exe") && !name.includes("__uninstaller"),
);
if (!installer) throw new Error("Published update verification needs an installer.");

const exactFiles = ["latest.yml", "SHA256SUMS.txt"];
const binaryFiles = [installer, `${installer}.blockmap`];

for (const file of exactFiles) {
  const expected = await fs.readFile(join(releaseDirectory, file));
  await retry(async () => {
    const response = await fetch(publicObjectUrl(file, true), {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${file} returned HTTP ${response.status}`);
    const actual = Buffer.from(await response.arrayBuffer());
    if (!actual.equals(expected)) throw new Error(`${file} does not match the release build.`);
  });
  process.stdout.write(`Verified published update metadata: ${file}\n`);
}

for (const file of binaryFiles) {
  const expectedSize = (await fs.stat(join(releaseDirectory, file))).size;
  await retry(async () => {
    const response = await fetch(publicObjectUrl(file, false), {
      method: "HEAD",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${file} returned HTTP ${response.status}`);
    const length = response.headers.get("content-length");
    if (length && Number(length) !== expectedSize) {
      throw new Error(`${file} has unexpected CDN content length.`);
    }
  });
  process.stdout.write(`Verified published update binary: ${file}\n`);
}

function publicObjectUrl(file, cacheBust) {
  const base = publicUrl.toString().endsWith("/")
    ? publicUrl.toString()
    : `${publicUrl.toString()}/`;
  const url = new URL(encodeURIComponent(file), base);
  if (cacheBust) url.searchParams.set("release-check", Date.now().toString());
  return url;
}

async function retry(operation) {
  let lastError;
  for (const delay of [0, 1_000, 2_000, 4_000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
