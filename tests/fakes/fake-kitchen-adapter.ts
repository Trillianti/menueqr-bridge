import type { IntegrationAdapter } from "../../src/contracts";

export type FakeKitchenConfig = {
  outcome: "succeeded" | "retryable_failure" | "terminal_failure";
};

export const fakeKitchenAdapter: IntegrationAdapter<
  FakeKitchenConfig,
  unknown
> = {
  id: "test.fake-kitchen",
  version: 1,
  capabilities: ["printer.kitchen"],
  supportedJobSchemas: [1],
  validateConfiguration(value: unknown): FakeKitchenConfig {
    if (
      !value ||
      typeof value !== "object" ||
      !["succeeded", "retryable_failure", "terminal_failure"].includes(
        (value as { outcome?: string }).outcome ?? "",
      )
    ) {
      throw new Error("Fake adapter configuration is invalid.");
    }
    return value as FakeKitchenConfig;
  },
  redactConfiguration(value) {
    return { outcome: value.outcome };
  },
  async healthCheck() {
    return {
      status: "ready",
      code: "FAKE_READY",
      message: "Fake adapter ready.",
      checkedAt: "1970-01-01T00:00:00.000Z",
    };
  },
  async execute(_payload, configuration) {
    return {
      status: configuration.outcome,
      code: `FAKE_${configuration.outcome.toUpperCase()}`,
      message: "Fake adapter result.",
      metadata: { safe: true, secret: "will-be-redacted-by-test" },
    };
  },
};
