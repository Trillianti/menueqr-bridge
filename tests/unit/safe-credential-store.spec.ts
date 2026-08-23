import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SafeCredentialStore } from "../../src/main/safe-credential-store";

describe("safe credential store", () => {
  const credential = {
    deviceId: "device_1",
    token: "top-secret-token",
    restaurant: { id: "restaurant_1", displayName: "Weingut Jäckel" },
    issuedAt: "2026-08-22T12:01:00.000Z",
    appVersion: "0.1.0",
  };

  it("stores encrypted bytes and restores a validated credential", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-store-"));
    const provider = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
      decryptString: (value: Buffer) =>
        value.toString().replace("encrypted:", ""),
    };
    const store = new SafeCredentialStore(
      provider,
      join(directory, "credential.bin"),
    );
    await store.save(credential);
    expect(await store.read()).toEqual(credential);
    expect(
      await readFile(join(directory, "credential.bin"), "utf8"),
    ).not.toContain(credential.token);
  });

  it("never falls back to plaintext when OS encryption is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-store-"));
    const unavailable = new SafeCredentialStore(
      {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => "",
      },
      join(directory, "credential.bin"),
    );
    await expect(unavailable.save(credential)).rejects.toThrow("encryption");
  });

  it("reports corrupted encrypted data instead of accepting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-store-"));
    const filePath = join(directory, "credential.bin");
    await writeFile(filePath, "not-valid-encrypted-data", "utf8");
    const store = new SafeCredentialStore(
      {
        isEncryptionAvailable: () => true,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => "not-json",
      },
      filePath,
    );
    await expect(store.read()).rejects.toThrow("corrupt");
  });
});
