import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

import type {
  BridgeCredential,
  CredentialStore,
} from "../core/credential-store";
import { validateCredential } from "../core/credential-store";

export type EncryptionProvider = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

export class SafeCredentialStore implements CredentialStore {
  constructor(
    private readonly encryption: EncryptionProvider,
    private readonly filePath: string,
  ) {}

  async read(): Promise<BridgeCredential | null> {
    this.assertAvailable();
    try {
      const encrypted = await fs.readFile(this.filePath, "utf8");
      const value = this.encryption.decryptString(
        Buffer.from(encrypted, "base64"),
      );
      return validateCredential(JSON.parse(value));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("Encrypted credential data is unavailable or corrupt.");
    }
  }

  async save(credential: BridgeCredential): Promise<void> {
    this.assertAvailable();
    const encrypted = this.encryption.encryptString(
      JSON.stringify(validateCredential(credential)),
    );
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(temporaryPath, encrypted.toString("base64"), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, this.filePath);
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private assertAvailable(): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error("OS-backed credential encryption is unavailable.");
    }
  }
}

export function credentialPath(userDataPath: string): string {
  return join(userDataPath, "runtime", "device-credential.bin");
}
