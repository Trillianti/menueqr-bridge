import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import type {
  AdapterDiscoveryCandidate,
  AdapterHealth,
  AdapterTestActionResult,
  BridgeCapability,
  IntegrationAdapter,
  RedactedAdapterHealth,
} from "../contracts";
import type {
  ExecutionReadiness,
  JobExecutionOutcome,
  JobExecutionPort,
  RuntimePollResult,
} from "../core/bridge-runtime";
import type { BridgeCredential } from "../core/credential-store";
import { ExecutionLedger } from "../core/execution-ledger";
import {
  type JobCompletionClient,
  PrintExecutor,
} from "../core/print-executor";
import { AdapterConfigurationStore } from "../integrations/adapter-config-store";
import {
  StarTsp1000LanAdapter,
  type StarTsp1000LanConfiguration,
} from "../integrations/printers/star-tsp1000-lan/star-tsp1000-lan";
import { LocalAdapterConfigFileStore } from "./local-adapter-config-store";
import type { DiagnosticLogEvent } from "./diagnostic-log";
import { LocalPrinterHealthStore } from "./local-printer-health-store";

export type LocalPrinterConfiguration = StarTsp1000LanConfiguration;

export type LocalPrinterSnapshot = {
  adapterId: string;
  configured: boolean;
  configuration: LocalPrinterConfiguration | null;
  health: AdapterHealth | null;
  activePrinterId: string | null;
  printers: LocalPrinterDeviceSnapshot[];
};

export type LocalPrinterDeviceSnapshot = {
  id: string;
  configuration: LocalPrinterConfiguration;
  health: AdapterHealth | null;
  active: boolean;
};

export type LocalPrinterDiscovery = {
  candidates: readonly AdapterDiscoveryCandidate[];
  selectedCandidateId: string | null;
};

export type LocalIntegrationSnapshot = {
  id: string;
  capabilities: readonly BridgeCapability[];
  configured: boolean;
  healthStatus: AdapterHealth["status"] | "not_configured";
};

export type PrinterHealthTransition = {
  printerId: string;
  active: boolean;
  previous: AdapterHealth;
  current: AdapterHealth;
};

export class KitchenRouteService implements JobExecutionPort {
  private readonly configurations: AdapterConfigurationStore;
  private readonly ledger: ExecutionLedger;
  private readonly healthStore: LocalPrinterHealthStore;
  private readonly healthByPrinterId = new Map<string, AdapterHealth>();
  private readonly consecutiveHealthFailures = new Map<string, number>();
  private healthLoadPromise: Promise<void> | null = null;
  private healthWriteQueue: Promise<void> = Promise.resolve();
  private healthTransitionListener:
    | ((transition: PrinterHealthTransition) => void | Promise<void>)
    | null = null;
  private discoveredCandidates = new Map<string, AdapterDiscoveryCandidate>();
  private selectedCandidateId: string | null = null;
  private testedCandidateId: string | null = null;

  constructor(
    configurationPath: string,
    ledgerPath: string,
    private readonly completion: JobCompletionClient,
    private readonly log?: (event: DiagnosticLogEvent) => void | Promise<void>,
    private readonly adapter: IntegrationAdapter<
      StarTsp1000LanConfiguration,
      Uint8Array
    > = new StarTsp1000LanAdapter(),
  ) {
    this.configurations = new AdapterConfigurationStore(
      new LocalAdapterConfigFileStore(configurationPath),
    );
    this.ledger = new ExecutionLedger(ledgerPath);
    this.healthStore = new LocalPrinterHealthStore(
      join(dirname(configurationPath), "printer-health.json"),
    );
  }

  setHealthTransitionListener(
    listener: (transition: PrinterHealthTransition) => void | Promise<void>,
  ): void {
    this.healthTransitionListener = listener;
  }

  async snapshot(): Promise<LocalPrinterSnapshot> {
    await this.loadHealth();
    const { profiles, activeProfileId } = await this.configurations.profiles(
      this.adapter,
    );
    const active = profiles.find((profile) => profile.id === activeProfileId);
    return {
      adapterId: this.adapter.id,
      configured: profiles.length > 0,
      configuration: active?.value ?? null,
      health: active ? (this.healthByPrinterId.get(active.id) ?? null) : null,
      activePrinterId: activeProfileId,
      printers: profiles.map((profile) => ({
        id: profile.id,
        configuration: profile.value,
        health: this.healthByPrinterId.get(profile.id) ?? null,
        active: profile.id === activeProfileId,
      })),
    };
  }

  async integrationSnapshot(): Promise<LocalIntegrationSnapshot> {
    const snapshot = await this.snapshot();
    return {
      id: snapshot.adapterId,
      capabilities: this.adapter.capabilities,
      configured: snapshot.configured,
      healthStatus: snapshot.configured
        ? (snapshot.health?.status ?? "degraded")
        : "not_configured",
    };
  }

  async saveConfiguration(
    value: unknown,
    printerId?: string,
  ): Promise<LocalPrinterSnapshot> {
    const id = printerId ?? randomUUID();
    const current = await this.configurations.profiles(this.adapter);
    await this.configurations.writeProfile(this.adapter, id, value, {
      activate: !printerId || current.activeProfileId === id,
    });
    this.healthByPrinterId.delete(id);
    this.consecutiveHealthFailures.delete(id);
    await this.persistHealth();
    return this.snapshot();
  }

  async deleteConfiguration(printerId: string): Promise<LocalPrinterSnapshot> {
    await this.configurations.removeProfile(this.adapter, printerId);
    this.healthByPrinterId.delete(printerId);
    this.consecutiveHealthFailures.delete(printerId);
    await this.persistHealth();
    return this.snapshot();
  }

  async activateConfiguration(printerId: string): Promise<LocalPrinterSnapshot> {
    await this.configurations.activateProfile(this.adapter, printerId);
    return this.snapshot();
  }

  async checkConnection(printerId?: string): Promise<AdapterHealth> {
    const printer = await this.requirePrinter(printerId);
    const health = await this.adapter.healthCheck(printer.configuration);
    await this.recordHealth(printer.id, health, false);
    void this.log?.({
      event: "printer.connection_test",
      code: health.code,
      message: health.message,
      adapterId: this.adapter.id,
      state: health.status,
    });
    return health;
  }

  async testPrint(
    signal: AbortSignal,
    printerId?: string,
  ): Promise<AdapterTestActionResult> {
    const printer = await this.requirePrinter(printerId);
    if (!this.adapter.test) {
      return {
        status: "terminal_failure",
        code: "TEST_PRINT_UNSUPPORTED",
        message: "This local printer does not support a test print.",
      };
    }
    const result = await this.adapter.test(printer.configuration, signal);
    await this.recordHealth(
      printer.id,
      {
        status: result.status === "succeeded" ? "ready" : "offline",
        code: result.code,
        message: result.message,
        checkedAt: new Date().toISOString(),
      },
      false,
    );
    void this.log?.({
      event: "printer.test_print",
      code: result.code,
      message: result.message,
      adapterId: this.adapter.id,
      state: result.status,
    });
    return result;
  }

  async discoverLocalPrinters(
    signal: AbortSignal,
  ): Promise<LocalPrinterDiscovery> {
    if (!this.adapter.discover) {
      throw new Error("PRINTER_DISCOVERY_UNSUPPORTED");
    }
    const candidates = await this.adapter.discover(signal);
    const validated = candidates.map((candidate) => ({
      ...candidate,
      ...this.adapter.validateConfiguration({
        host: candidate.host,
        port: candidate.port,
      }),
    }));
    this.discoveredCandidates = new Map(
      validated.map((candidate) => [candidate.id, candidate]),
    );
    this.selectedCandidateId =
      validated.length === 1 ? (validated[0]?.id ?? null) : null;
    this.testedCandidateId = null;
    void this.log?.({
      event: "printer.discovery",
      adapterId: this.adapter.id,
      code: `CANDIDATES_${validated.length}`,
      state: validated.length === 1 ? "auto_selected" : "selection_required",
    });
    return this.discoverySnapshot();
  }

  selectDiscoveredPrinter(candidateId: string): LocalPrinterDiscovery {
    this.requireDiscoveredCandidate(candidateId);
    this.selectedCandidateId = candidateId;
    this.testedCandidateId = null;
    return this.discoverySnapshot();
  }

  async testSelectedDiscoveredPrinter(
    signal: AbortSignal,
  ): Promise<AdapterTestActionResult> {
    const candidate = this.requireSelectedCandidate();
    const configuration = await this.configurationForCandidate(candidate);
    if (!this.adapter.test) {
      return {
        status: "terminal_failure",
        code: "TEST_PRINT_UNSUPPORTED",
        message: "This local printer does not support a test print.",
      };
    }
    const result = await this.adapter.test(configuration, signal);
    this.testedCandidateId =
      result.status === "succeeded" ? candidate.id : null;
    void this.log?.({
      event: "printer.discovery_test",
      adapterId: this.adapter.id,
      code: result.code,
      message: result.message,
      state: result.status,
    });
    return result;
  }

  async confirmSelectedDiscoveredPrinter(
    printerId?: string,
  ): Promise<LocalPrinterSnapshot> {
    const candidate = this.requireSelectedCandidate();
    if (this.testedCandidateId !== candidate.id) {
      throw new Error("PRINTER_DISCOVERY_CONFIRMATION_REQUIRED");
    }
    const configuration = await this.configurationForCandidate(candidate);
    const id = printerId ?? randomUUID();
    const current = await this.configurations.profiles(this.adapter);
    await this.configurations.writeProfile(this.adapter, id, configuration, {
      activate: !printerId || current.activeProfileId === id,
    });
    this.healthByPrinterId.delete(id);
    this.consecutiveHealthFailures.delete(id);
    await this.persistHealth();
    void this.log?.({
      event: "printer.discovery_confirmed",
      adapterId: this.adapter.id,
      state: "configured",
    });
    return this.snapshot();
  }

  async readiness(): Promise<ExecutionReadiness> {
    try {
      return (await this.readConfigurationOrNull())
        ? { ready: true }
        : {
            ready: false,
            code: "PRINTER_NOT_CONFIGURED",
            message:
              "Configure the local Star kitchen printer before starting the bridge.",
          };
    } catch {
      return {
        ready: false,
        code: "PRINTER_CONFIGURATION_INVALID",
        message: "The local Star kitchen printer configuration is invalid.",
      };
    }
  }

  async adapterHealth(): Promise<readonly RedactedAdapterHealth[]> {
    await this.monitorPrinterConnections();
    const snapshot = await this.snapshot();
    const health = !snapshot.configuration
      ? {
          status: "misconfigured" as const,
          code: "PRINTER_NOT_CONFIGURED",
          message: "The local printer is not configured.",
          checkedAt: new Date().toISOString(),
        }
      : (snapshot.health ?? {
          status: "degraded" as const,
          code: "HEALTH_NOT_CHECKED",
          message: "Printer connection has not been tested yet.",
          checkedAt: new Date().toISOString(),
        });
    return [
      {
        adapterId: this.adapter.id,
        status: health.status,
        code: health.code,
      },
    ];
  }

  async diagnostics(): Promise<{
    adapterId: string;
    configured: boolean;
    configuration: Record<string, unknown> | null;
    lastHealth: AdapterHealth | null;
    recentJobs: Awaited<ReturnType<ExecutionLedger["recent"]>>;
  }> {
    const configuration = await this.readConfigurationOrNull();
    return {
      adapterId: this.adapter.id,
      configured: configuration !== null,
      configuration: configuration
        ? this.adapter.redactConfiguration(configuration)
        : null,
      lastHealth: (await this.snapshot()).health,
      recentJobs: await this.ledger.recent(),
    };
  }

  async pruneLedger(before: Date): Promise<void> {
    await this.ledger.prune(before);
  }

  async handoff(
    credential: BridgeCredential,
    leased: Extract<RuntimePollResult, { kind: "job" }>,
    signal: AbortSignal,
  ): Promise<JobExecutionOutcome> {
    const snapshot = await this.snapshot();
    const configuration = snapshot.configuration;
    if (!configuration) {
      const code = "PRINTER_NOT_CONFIGURED";
      const message = "The local Star kitchen printer is not configured.";
      await this.completion.fail(
        credential,
        leased,
        "retryable_failure",
        code,
        message,
        signal,
      );
      void this.log?.({
        event: "job.outcome",
        jobId: leased.job.id,
        code,
        message,
        adapterId: this.adapter.id,
        state: "retryable_failure",
      });
      return { kind: "retryable_failure", jobId: leased.job.id, code, message };
    }
    const executor = new PrintExecutor(
      this.adapter,
      configuration,
      {
        commandMode: configuration.commandMode,
        paperWidthMm: configuration.paperWidthMm,
        encoding: configuration.encoding,
        cutAfterPrint: configuration.cutAfterPrint,
      },
      this.ledger,
      this.completion,
    );
    const outcome = await executor.handoff(credential, leased, signal);
    if (outcome.kind === "succeeded") {
      if (snapshot.activePrinterId)
        await this.recordHealth(
          snapshot.activePrinterId,
          {
            status: "ready",
            code: "PRINT_WRITTEN",
            message: "The most recent printer write completed.",
            checkedAt: new Date().toISOString(),
          },
          false,
        );
    } else if (outcome.kind !== "ack_pending") {
      if (snapshot.activePrinterId)
        await this.recordHealth(
          snapshot.activePrinterId,
          {
            status:
              outcome.code === "INVALID_CONFIGURATION"
                ? "misconfigured"
                : "offline",
            code: outcome.code,
            message: outcome.message,
            checkedAt: new Date().toISOString(),
          },
          false,
        );
    }
    void this.log?.({
      event: "job.outcome",
      jobId: leased.job.id,
      code: "code" in outcome ? outcome.code : "PRINT_WRITTEN",
      message: "message" in outcome ? outcome.message : "Print job completed.",
      adapterId: this.adapter.id,
      state: outcome.kind,
    });
    return outcome;
  }

  private async readConfigurationOrNull(): Promise<LocalPrinterConfiguration | null> {
    return this.configurations.read(this.adapter);
  }

  private async loadHealth(): Promise<void> {
    if (!this.healthLoadPromise) {
      this.healthLoadPromise = this.healthStore
        .read()
        .then((stored) => {
          for (const [printerId, health] of Object.entries(stored)) {
            this.healthByPrinterId.set(printerId, health);
          }
        })
        .catch(() => undefined);
    }
    await this.healthLoadPromise;
  }

  private async persistHealth(): Promise<void> {
    await this.loadHealth();
    const stored = Object.fromEntries(this.healthByPrinterId);
    this.healthWriteQueue = this.healthWriteQueue
      .catch(() => undefined)
      .then(() => this.healthStore.write(stored));
    await this.healthWriteQueue;
  }

  private async monitorPrinterConnections(): Promise<void> {
    const { profiles } = await this.configurations.profiles(this.adapter);
    await Promise.all(
      profiles.map(async (profile) => {
        const health = await this.adapter.healthCheck(profile.value);
        await this.recordHealth(profile.id, health, true);
      }),
    );
  }

  private async recordHealth(
    printerId: string,
    health: AdapterHealth,
    debounceKnownFailure: boolean,
  ): Promise<AdapterHealth> {
    await this.loadHealth();
    const previous = this.healthByPrinterId.get(printerId);
    const failed = health.status !== "ready";
    if (failed && debounceKnownFailure && previous?.status === "ready") {
      const failures =
        (this.consecutiveHealthFailures.get(printerId) ?? 0) + 1;
      this.consecutiveHealthFailures.set(printerId, failures);
      if (failures < 2) return previous;
    } else {
      this.consecutiveHealthFailures.set(printerId, 0);
    }

    this.healthByPrinterId.set(printerId, health);
    const changed =
      !previous ||
      previous.status !== health.status ||
      previous.code !== health.code;
    if (changed) await this.persistHealth();

    if (previous && previous.status !== health.status) {
      const profiles = await this.configurations.profiles(this.adapter);
      void this.healthTransitionListener?.({
        printerId,
        active: profiles.activeProfileId === printerId,
        previous,
        current: health,
      });
    }
    return health;
  }

  private async requirePrinter(printerId?: string): Promise<{
    id: string;
    configuration: LocalPrinterConfiguration;
  }> {
    const snapshot = await this.snapshot();
    const id = printerId ?? snapshot.activePrinterId;
    const printer = snapshot.printers.find((candidate) => candidate.id === id);
    if (!printer) throw new Error("PRINTER_NOT_CONFIGURED");
    return { id: printer.id, configuration: printer.configuration };
  }

  private discoverySnapshot(): LocalPrinterDiscovery {
    return {
      candidates: [...this.discoveredCandidates.values()].map((candidate) => ({
        id: candidate.id,
        displayName: candidate.displayName,
        host: candidate.host,
        port: candidate.port,
      })),
      selectedCandidateId: this.selectedCandidateId,
    };
  }

  private requireDiscoveredCandidate(
    candidateId: string,
  ): AdapterDiscoveryCandidate {
    const candidate = this.discoveredCandidates.get(candidateId);
    if (!candidate) throw new Error("PRINTER_DISCOVERY_CANDIDATE_INVALID");
    return candidate;
  }

  private requireSelectedCandidate(): AdapterDiscoveryCandidate {
    if (!this.selectedCandidateId)
      throw new Error("PRINTER_DISCOVERY_SELECTION_REQUIRED");
    return this.requireDiscoveredCandidate(this.selectedCandidateId);
  }

  private async configurationForCandidate(
    candidate: AdapterDiscoveryCandidate,
  ): Promise<LocalPrinterConfiguration> {
    const existing = await this.readConfigurationOrNull();
    return this.adapter.validateConfiguration({
      ...(existing ?? {}),
      host: candidate.host,
      port: candidate.port,
    });
  }
}
