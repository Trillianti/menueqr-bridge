import type {
  AdapterExecutionResult,
  AdapterHealth,
  BridgeCapability,
  ContractVersion,
  IntegrationAdapter,
} from "../contracts";

export type AdapterJob = {
  type: string;
  schemaVersion: number;
  payload: unknown;
};

export type RegisteredAdapter = IntegrationAdapter<unknown, unknown>;

const capabilityForJobType: Record<string, BridgeCapability> = {
  kitchen_order: "printer.kitchen",
  test_print: "printer.kitchen",
};

export class AdapterRegistry {
  private readonly adapters = new Map<string, RegisteredAdapter>();

  constructor(adapters: readonly RegisteredAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: RegisteredAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Adapter ${adapter.id} is already registered.`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(adapterId: string): RegisteredAdapter {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) throw new Error(`Adapter ${adapterId} is not registered.`);
    return adapter;
  }

  resolve(adapterId: string, job: AdapterJob): RegisteredAdapter {
    const adapter = this.get(adapterId);
    const requiredCapability = capabilityForJobType[job.type];
    if (
      !requiredCapability ||
      !adapter.capabilities.includes(requiredCapability)
    ) {
      throw new Error(`Adapter ${adapterId} does not support ${job.type}.`);
    }
    if (
      !adapter.supportedJobSchemas.includes(
        job.schemaVersion as ContractVersion,
      )
    ) {
      throw new Error(
        `Adapter ${adapterId} does not support job schema ${job.schemaVersion}.`,
      );
    }
    return adapter;
  }

  safeMetadata(): Array<{
    id: string;
    version: number;
    capabilities: readonly BridgeCapability[];
    supportedJobSchemas: readonly ContractVersion[];
  }> {
    return [...this.adapters.values()].map((adapter) => ({
      id: adapter.id,
      version: adapter.version,
      capabilities: adapter.capabilities,
      supportedJobSchemas: adapter.supportedJobSchemas,
    }));
  }
}

export async function executeAdapter(
  registry: AdapterRegistry,
  adapterId: string,
  job: AdapterJob,
  configuration: unknown,
  signal: AbortSignal,
): Promise<AdapterExecutionResult> {
  const adapter = registry.resolve(adapterId, job);
  const validated = adapter.validateConfiguration(configuration);
  const result = await adapter.execute(job.payload, validated, signal);
  return normalizeExecutionResult(result);
}

export async function checkAdapterHealth(
  registry: AdapterRegistry,
  adapterId: string,
  configuration: unknown,
): Promise<AdapterHealth> {
  const adapter = registry.get(adapterId);
  return adapter.healthCheck(adapter.validateConfiguration(configuration));
}

export function normalizeExecutionResult(
  result: AdapterExecutionResult,
): AdapterExecutionResult {
  return {
    status: result.status,
    code: result.code.slice(0, 80),
    message: result.message.replace(/[\r\n\t]+/g, " ").slice(0, 500),
    ...(result.metadata ? { metadata: boundedMetadata(result.metadata) } : {}),
  };
}

export function boundedMetadata(
  value: Record<string, string | number | boolean | null>,
) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, item]) =>
          /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) &&
          !/(?:token|secret|authorization|host|port|ip|fingerprint)/i.test(
            key,
          ) &&
          (item === null ||
            typeof item === "string" ||
            typeof item === "number" ||
            typeof item === "boolean"),
      )
      .slice(0, 12)
      .map(([key, item]) => [
        key,
        typeof item === "string" ? item.slice(0, 160) : item,
      ]),
  );
}
