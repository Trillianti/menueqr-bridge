type BridgeFoundationRuntimeState = {
  kind:
    | "unpaired"
    | "starting"
    | "paused"
    | "ready"
    | "offline"
    | "degraded"
    | "feature_required"
    | "update_required"
    | "revoked"
    | "fatal_error";
};

type BridgeShellSnapshot = {
  runtime: { kind: "unpaired" | "starting" | "paused" | "shell_error" };
  autostartEnabled: boolean;
};

type BridgePairingState =
  | { kind: "unpaired" | "requesting_code" }
  | {
      kind: "waiting_for_approval" | "slow_down";
      userCode: string;
      expiresAt: string;
      pollingIntervalSeconds: number;
    }
  | {
      kind: "paired";
      credential: {
        kind: "paired";
        deviceId: string;
        restaurant: { id: string; displayName: string };
        issuedAt: string;
        appVersion: string;
      };
    }
  | {
      kind:
        | "denied"
        | "expired"
        | "revoked"
        | "network_error"
        | "secure_storage_unavailable"
        | "secure_storage_corrupt";
      message: string;
    };

type BridgeDeviceRuntimeState = {
  kind: string;
  code?: string;
  message?: string;
  updatedAt: string;
};

type BridgeLocalPrinterConfiguration = {
  transport: "raw_tcp" | "windows_spooler";
  windowsPrinterName: string | null;
  host: string;
  port: number;
  commandMode: "star_line" | "esc_pos";
  paperWidthMm: 80 | 82;
  encoding: "cp437" | "cp850" | "windows1252";
  connectTimeoutMs: number;
  writeTimeoutMs: number;
  cutAfterPrint: boolean;
  bonLayoutProfile: "compact" | "kitchen" | "detailed";
};

type BridgePrinterSnapshot = {
  adapterId: string;
  configured: boolean;
  configuration: BridgeLocalPrinterConfiguration | null;
  health: {
    status: "ready" | "degraded" | "offline" | "misconfigured";
    code: string;
    message: string;
    checkedAt: string;
  } | null;
  activePrinterId: string | null;
  printers: Array<{
    id: string;
    configuration: BridgeLocalPrinterConfiguration;
    health: BridgePrinterSnapshot["health"];
    active: boolean;
  }>;
};

type BridgePrinterDiscovery = {
  candidates: Array<{
    id: string;
    displayName: string;
    host: string;
    port: number;
  }>;
  selectedCandidateId: string | null;
};

type BridgeIntegrationSnapshot = {
  id: string;
  capabilities: Array<"printer.kitchen" | "pos.sync">;
  configured: boolean;
  healthStatus:
    | "ready"
    | "degraded"
    | "offline"
    | "misconfigured"
    | "not_configured";
};

type BridgeUpdateSnapshot =
  | { kind: "disabled" | "idle" | "checking"; currentVersion: string }
  | {
      kind: "downloading";
      currentVersion: string;
      version: string;
      percent: number;
    }
  | {
      kind: "downloaded" | "installing";
      currentVersion: string;
      version: string;
    }
  | { kind: "error"; currentVersion: string; code: string };

type BridgeDevelopmentSnapshot = {
  enabled: boolean;
  apiBaseUrl: string | null;
  verificationHosts: string[];
};

declare global {
  interface Window {
    menuqrBridge: {
      getRuntimeSnapshot(): Promise<BridgeFoundationRuntimeState>;
      getShellSnapshot(): Promise<BridgeShellSnapshot>;
      showSettings(): Promise<void>;
      setAutostart(enabled: boolean): Promise<BridgeShellSnapshot>;
      setPaused(paused: boolean): Promise<BridgeShellSnapshot>;
      getPairingSnapshot(): Promise<BridgePairingState>;
      onPairingStateChanged(listener: () => void): () => void;
      beginPairing(): Promise<BridgePairingState>;
      openPairingBrowser(): Promise<void>;
      disconnect(): Promise<{
        state: BridgePairingState;
        serverCleanupPending: boolean;
      }>;
      getDeviceRuntimeSnapshot(): Promise<BridgeDeviceRuntimeState>;
      getIntegrationsSnapshot(): Promise<BridgeIntegrationSnapshot[]>;
      getDevelopmentSnapshot(): Promise<BridgeDevelopmentSnapshot>;
      getPrinterSnapshot(): Promise<BridgePrinterSnapshot>;
      savePrinterConfiguration(
        configuration: BridgeLocalPrinterConfiguration,
        printerId?: string,
      ): Promise<BridgePrinterSnapshot>;
      deletePrinterConfiguration(
        printerId: string,
      ): Promise<BridgePrinterSnapshot>;
      activatePrinterConfiguration(
        printerId: string,
      ): Promise<BridgePrinterSnapshot>;
      testPrinterConnection(
        printerId?: string,
      ): Promise<BridgePrinterSnapshot["health"]>;
      testPrinterPrint(printerId?: string): Promise<{
        status: "succeeded" | "retryable_failure" | "terminal_failure";
        code: string;
        message: string;
      }>;
      listWindowsPrinters(): Promise<
        Array<{
          name: string;
          driverName: string;
          portName: string;
          status: string;
        }>
      >;
      discoverPrinters(): Promise<BridgePrinterDiscovery>;
      selectDiscoveredPrinter(
        candidateId: string,
      ): Promise<BridgePrinterDiscovery>;
      testDiscoveredPrinter(): Promise<{
        status: "succeeded" | "retryable_failure" | "terminal_failure";
        code: string;
        message: string;
      }>;
      confirmDiscoveredPrinter(
        bonLayoutProfile: "compact" | "kitchen" | "detailed",
        printerId?: string,
      ): Promise<BridgePrinterSnapshot>;
      requestPrinterSupport(request: {
        model: string;
        note?: string;
      }): Promise<{ status: "sent" }>;
      exportDiagnostics(): Promise<
        | { status: "saved"; fileName: string }
        | { status: "canceled" }
      >;
      getUpdateSnapshot(): Promise<BridgeUpdateSnapshot>;
      checkForUpdates(): Promise<BridgeUpdateSnapshot>;
      installUpdate(): Promise<boolean>;
    };
  }
}

export {};
