import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DeviceFingerprintStore } from "../../src/main/device-fingerprint-store";

describe("DeviceFingerprintStore", () => {
  it("creates a random local fingerprint once and reuses it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-fingerprint-"));
    const path = join(directory, "device-fingerprint.txt");
    try {
      const store = new DeviceFingerprintStore(path);
      const first = await store.readOrCreate();
      const second = await store.readOrCreate();

      expect(first).toMatch(/^[0-9a-f-]{36}$/i);
      expect(second).toBe(first);
      expect((await readFile(path, "utf8")).trim()).toBe(first);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
