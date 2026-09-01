import type { AdapterExecutionResult, IntegrationAdapter } from "../contracts";
import type { BridgeCredential } from "./credential-store";
import type { ExecutionLedger } from "./execution-ledger";
import type { JobExecutionOutcome, RuntimePollResult } from "./bridge-runtime";
import {
  renderKitchenBon,
  type BonRenderOptions,
} from "../integrations/kitchen-bon";

type LeasedJob = Extract<RuntimePollResult, { kind: "job" }>;

export type JobCompletionClient = {
  acknowledge(
    credential: BridgeCredential,
    job: LeasedJob,
    metadata: Record<string, string | number | boolean | null>,
    signal: AbortSignal,
  ): Promise<void>;
  fail(
    credential: BridgeCredential,
    job: LeasedJob,
    kind: "retryable_failure" | "terminal_failure",
    code: string,
    message: string,
    signal: AbortSignal,
  ): Promise<void>;
};

export class PrintExecutor<Configuration> {
  constructor(
    private readonly adapter: IntegrationAdapter<Configuration, Uint8Array>,
    private readonly configuration: Configuration,
    private readonly renderOptions: BonRenderOptions,
    private readonly ledger: ExecutionLedger,
    private readonly completion: JobCompletionClient,
    private readonly renderPayload: (
      payload: unknown,
      options: BonRenderOptions,
    ) => Uint8Array = renderKitchenBon,
  ) {}

  async handoff(
    credential: BridgeCredential,
    leased: LeasedJob,
    signal: AbortSignal,
  ): Promise<JobExecutionOutcome> {
    try {
      const existing = await this.ledger.assertPayload(
        leased.job.id,
        leased.job.payload,
      );
      if (existing?.state === "succeeded") {
        return { kind: "succeeded", jobId: leased.job.id };
      }
      if (existing?.state === "printed" || existing?.state === "ack_pending") {
        await this.acknowledge(credential, leased, signal);
        return { kind: "succeeded", jobId: leased.job.id };
      }
      await this.ledger.record(leased.job.id, leased.job.payload, "received");
      await this.ledger.record(leased.job.id, leased.job.payload, "in_flight");
      if (leased.job.type === "test_print") {
        if (!this.adapter.test) throw new Error("UNSUPPORTED_TEST_PRINT");
        const result = await this.adapter.test(this.configuration, signal);
        return await this.handleResult(credential, leased, result, signal);
      }
      if (leased.job.type !== "kitchen_order")
        throw new Error("UNSUPPORTED_JOB_TYPE");
      const buffer = this.renderPayload(
        leased.job.payload,
        this.renderOptions,
      );
      const result = await this.adapter.execute(
        buffer,
        this.configuration,
        signal,
      );
      return await this.handleResult(credential, leased, result, signal);
    } catch (error) {
      const code = error instanceof Error ? error.message : "EXECUTION_FAILED";
      if (code === "ACK_UNAVAILABLE") {
        return {
          kind: "ack_pending",
          jobId: leased.job.id,
          code,
          message: "The bon was written, but acknowledgement is pending.",
        };
      }
      if (code === "PAYLOAD_INTEGRITY_MISMATCH") {
        await this.completion.fail(
          credential,
          leased,
          "terminal_failure",
          code,
          "Job payload changed for an existing local job ID.",
          signal,
        );
        return {
          kind: "terminal_failure",
          jobId: leased.job.id,
          code,
          message: "The job payload changed for an existing local job ID.",
        };
      }
      if (signal.aborted) {
        await this.ledger.record(
          leased.job.id,
          leased.job.payload,
          "ambiguous",
          "CANCELED_BEFORE_CONFIRMATION",
        );
        await this.completion
          .fail(
            credential,
            leased,
            "retryable_failure",
            "CANCELED",
            "Execution canceled before completion was confirmed.",
            signal,
          )
          .catch(() => undefined);
        return {
          kind: "retryable_failure",
          jobId: leased.job.id,
          code: "CANCELED",
          message: "Execution canceled before completion was confirmed.",
        };
      }
      await this.ledger.record(
        leased.job.id,
        leased.job.payload,
        "terminal",
        code,
      );
      await this.completion.fail(
        credential,
        leased,
        "terminal_failure",
        code,
        "Print execution failed before writing.",
        signal,
      );
      return {
        kind: "terminal_failure",
        jobId: leased.job.id,
        code,
        message: "Print execution failed before writing.",
      };
    }
  }

  private async handleResult(
    credential: BridgeCredential,
    leased: LeasedJob,
    result: AdapterExecutionResult,
    signal: AbortSignal,
  ): Promise<JobExecutionOutcome> {
    if (result.status === "succeeded") {
      await this.ledger.record(leased.job.id, leased.job.payload, "printed");
      await this.acknowledge(credential, leased, signal, result.metadata);
      return { kind: "succeeded", jobId: leased.job.id };
    }
    const kind =
      result.status === "retryable_failure"
        ? "retryable_failure"
        : "terminal_failure";
    await this.ledger.record(
      leased.job.id,
      leased.job.payload,
      kind === "retryable_failure" ? "received" : "terminal",
      result.code,
    );
    await this.completion.fail(
      credential,
      leased,
      kind,
      result.code,
      result.message,
      signal,
    );
    return {
      kind,
      jobId: leased.job.id,
      code: result.code,
      message: result.message,
    };
  }

  private async acknowledge(
    credential: BridgeCredential,
    leased: LeasedJob,
    signal: AbortSignal,
    metadata: Record<string, string | number | boolean | null> = {},
  ): Promise<void> {
    try {
      await this.completion.acknowledge(credential, leased, metadata, signal);
      await this.ledger.record(leased.job.id, leased.job.payload, "succeeded");
    } catch (error) {
      await this.ledger.record(
        leased.job.id,
        leased.job.payload,
        "ack_pending",
        "ACK_UNAVAILABLE",
      );
      throw error;
    }
  }
}
