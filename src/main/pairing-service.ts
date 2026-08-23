import type {
  DeviceCodeRequest,
  DeviceCodeResponse,
  PairingStatus,
} from "../contracts";
import {
  type BridgeCredential,
  type CredentialStore,
  redactCredential,
} from "../core/credential-store";
import {
  applyPairingStatus,
  isPairingTerminal,
  type PairingState,
  waitingState,
} from "../core/pairing-state-machine";
import { isPrivateOrLoopbackHost } from "./bridge-url";

export type PairingApi = {
  createDeviceCode(request: DeviceCodeRequest): Promise<DeviceCodeResponse>;
  pollForToken(deviceCode: string): Promise<PairingStatus>;
  revokeCurrentDevice?(token: string): Promise<void>;
  submitPrinterSupportRequest?(
    credential: BridgeCredential,
    request: PrinterSupportRequest,
  ): Promise<void>;
};

export type PrinterSupportRequest = {
  model: string;
  note?: string;
};

export type ExternalOpener = {
  openExternal(url: string): Promise<void>;
};

export type PairingServiceOptions = {
  appVersion: string;
  deviceFingerprint: string;
  verificationHosts: readonly string[];
  allowInsecureLocalVerification?: boolean;
  deviceName: string;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<boolean>;
  onCredentialSaved?: (credential: BridgeCredential) => void | Promise<void>;
  onStateChange?: (state: PairingState) => void | Promise<void>;
};

export class DesktopPairingService {
  private state: PairingState = { kind: "unpaired" };
  private controller: AbortController | null = null;
  private verificationUrl: string | null = null;

  constructor(
    private readonly api: PairingApi,
    private readonly store: CredentialStore,
    private readonly opener: ExternalOpener,
    private readonly options: PairingServiceOptions,
  ) {}

  async restore(): Promise<PairingState> {
    try {
      const credential = await this.store.read();
      if (credential) {
        const redacted = redactCredential(credential);
        this.setState(
          redacted.kind === "paired"
            ? { kind: "paired", credential: redacted }
            : { kind: "unpaired" },
        );
      } else {
        this.setState({ kind: "unpaired" });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Credential data is unavailable.";
      this.setState(
        message.includes("encryption")
          ? { kind: "secure_storage_unavailable", message }
          : { kind: "secure_storage_corrupt", message },
      );
    }
    return this.state;
  }

  snapshot(): PairingState {
    return this.state;
  }

  async begin(): Promise<PairingState> {
    this.stopPolling();
    this.verificationUrl = null;
    this.setState({ kind: "requesting_code" });
    try {
      const code = await this.api.createDeviceCode({
        displayName: this.options.deviceName,
        deviceFingerprint: this.options.deviceFingerprint,
        platform: "windows",
        appVersion: this.options.appVersion,
        requestedCapabilities: ["printer.kitchen"],
        supportedContractVersions: [1],
      });
      this.verificationUrl = code.verificationUriComplete || code.verificationUri;
      this.assertVerificationUrl(this.verificationUrl);
      this.setState(waitingState(code));
      this.controller = new AbortController();
      void this.poll(code, this.controller.signal);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start pairing.";
      this.setState(
        message.includes("encryption")
          ? { kind: "secure_storage_unavailable", message }
          : { kind: "network_error", message },
      );
    }
    return this.state;
  }

  async openPairingBrowser(): Promise<void> {
    if (
      !this.verificationUrl ||
      (this.state.kind !== "waiting_for_approval" && this.state.kind !== "slow_down")
    ) {
      throw new Error("Pairing code is unavailable.");
    }
    await this.opener.openExternal(this.verificationUrl);
  }

  async disconnect(): Promise<{
    state: PairingState;
    serverCleanupPending: boolean;
  }> {
    const credential = await this.readCredentialForDisconnect();
    this.stopPolling();
    let serverCleanupPending = false;
    if (credential && this.api.revokeCurrentDevice) {
      try {
        await this.api.revokeCurrentDevice(credential.token);
      } catch {
        serverCleanupPending = true;
      }
    } else if (credential) {
      serverCleanupPending = true;
    }
    await this.store.clear();
    this.setState({ kind: "unpaired" });
    return { state: this.state, serverCleanupPending };
  }

  async clearRevokedCredential(): Promise<void> {
    this.stopPolling();
    await this.store.clear();
    this.setState({ kind: "unpaired" });
  }

  async requestPrinterSupport(request: PrinterSupportRequest): Promise<void> {
    if (!this.api.submitPrinterSupportRequest) {
      throw new Error("Printer support requests are unavailable.");
    }
    const credential = await this.readCredentialForDisconnect();
    if (!credential) {
      throw new Error("Connect a restaurant before requesting printer support.");
    }
    await this.api.submitPrinterSupportRequest(credential, request);
  }

  stopPolling(): void {
    this.controller?.abort();
    this.controller = null;
  }

  private async poll(
    code: DeviceCodeResponse,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted && !isPairingTerminal(this.state)) {
      const current = this.state;
      if (
        current.kind !== "waiting_for_approval" &&
        current.kind !== "slow_down"
      )
        return;
      if (Date.parse(current.expiresAt) <= Date.now()) {
        this.setState({
          kind: "expired",
          message: "This pairing request has expired.",
        });
        return;
      }
      const waited = await (this.options.wait ?? waitFor)(
        current.pollingIntervalSeconds * 1_000,
        signal,
      );
      if (!waited || signal.aborted) return;
      try {
        const status = await this.api.pollForToken(code.deviceCode);
        let credential: Exclude<
          ReturnType<typeof redactCredential>,
          { kind: "unpaired" }
        > | null = null;
        if (status.kind === "approved") {
          const raw: BridgeCredential = {
            deviceId: status.token.deviceId,
            token: status.token.token,
            restaurant: status.token.restaurant,
            issuedAt: status.token.issuedAt,
            appVersion: this.options.appVersion,
          };
          await this.store.save(raw);
          await this.options.onCredentialSaved?.(raw);
          const redacted = redactCredential(raw);
          credential = redacted.kind === "paired" ? redacted : null;
        }
        this.setState(applyPairingStatus(this.state, status, credential));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Pairing connection failed.";
        this.setState(
          message.includes("encryption")
            ? { kind: "secure_storage_unavailable", message }
            : { kind: "network_error", message },
        );
        return;
      }
    }
  }

  private async readCredentialForDisconnect(): Promise<BridgeCredential | null> {
    try {
      return await this.store.read();
    } catch {
      return null;
    }
  }

  private setState(state: PairingState): void {
    this.state = state;
    void this.options.onStateChange?.(state);
  }

  private assertVerificationUrl(value: string): void {
    const url = new URL(value);
    const isAllowedDevelopmentUrl =
      this.options.allowInsecureLocalVerification === true &&
      url.protocol === "http:" &&
      isPrivateOrLoopbackHost(url.hostname);
    if (
      (url.protocol !== "https:" && !isAllowedDevelopmentUrl) ||
      !this.options.verificationHosts.includes(url.hostname)
    ) {
      throw new Error("Pairing verification URL is not allowed.");
    }
  }
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => cleanup(true), milliseconds);
    const onAbort = () => cleanup(false);
    const cleanup = (result: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    if (signal.aborted) cleanup(false);
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}
