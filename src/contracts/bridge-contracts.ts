export const BRIDGE_API_VERSION = "v1" as const;
export const KITCHEN_PRINT_SCHEMA_VERSION = 1 as const;

export type BridgeCapability = "printer.kitchen";
export type BridgePlatform = "windows";
export type AdapterCommandMode = "star_line" | "esc_pos";

export type ContractVersion = typeof KITCHEN_PRINT_SCHEMA_VERSION;

export type DeviceCodeRequest = {
  displayName: string;
  deviceFingerprint: string;
  platform: BridgePlatform;
  appVersion: string;
  requestedCapabilities: readonly BridgeCapability[];
  supportedContractVersions: readonly ContractVersion[];
};

export type DeviceCodeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: string;
  pollingIntervalSeconds: number;
};

export type PairingStatus =
  | { kind: "authorization_pending"; pollingIntervalSeconds: number }
  | { kind: "slow_down"; pollingIntervalSeconds: number }
  | { kind: "denied"; message: string }
  | { kind: "expired"; message: string }
  | { kind: "consumed"; message: string }
  | { kind: "approved"; token: DeviceTokenResponse };

export type DeviceTokenResponse = {
  deviceId: string;
  token: string;
  restaurant: {
    id: string;
    displayName: string;
  };
  issuedAt: string;
};

export type AdapterHealth = {
  status: "ready" | "degraded" | "offline" | "misconfigured";
  code: string;
  message: string;
  checkedAt: string;
};

export type HeartbeatRequest = {
  appVersion: string;
  runtimeState: BridgeRuntimeState["kind"];
  supportedContractVersions: readonly ContractVersion[];
  adapterHealth: readonly RedactedAdapterHealth[];
  lastCompletedJobId: string | null;
  lastFailedJobId: string | null;
  clientTimestamp: string;
};

export type HeartbeatResponse = {
  serverTimestamp: string;
  acceptedContractVersions: readonly ContractVersion[];
  heartbeatIntervalSeconds: number;
  runtime:
    | { kind: "ready"; message: string }
    | { kind: "degraded"; message: string }
    | { kind: "feature_required"; message: string; requiredPlan: "pro" }
    | { kind: "update_required"; message: string; minimumVersion: string }
    | { kind: "revoked"; message: string };
};

export type KitchenPrintJobV1 = {
  schemaVersion: typeof KITCHEN_PRINT_SCHEMA_VERSION;
  jobType: "kitchen_order";
  jobId: string;
  restaurantId: string;
  restaurantName: string;
  orderId: string;
  orderReference: string;
  tableNumber: number;
  createdAt: string;
  currency: string;
  notes: string | null;
  items: readonly KitchenPrintItemV1[];
  totalAmount: string;
  reprint?: boolean;
};

export type KitchenPrintItemV1 = {
  itemId: string;
  name: string;
  variation: string | null;
  notes?: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

export type BridgeJobEnvelope =
  | {
      schemaVersion: typeof KITCHEN_PRINT_SCHEMA_VERSION;
      type: "kitchen_order";
      job: KitchenPrintJobV1;
      lease: LeaseMetadata;
    }
  | {
      schemaVersion: number;
      type: "unsupported";
      jobId: string;
      reason: "unsupported_schema";
    };

export type LeaseMetadata = {
  token: string;
  expiresAt: string;
};

export type JobAcknowledgement = {
  leaseToken: string;
  completedAt: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type JobFailure = {
  leaseToken: string;
  kind: "retryable_failure" | "terminal_failure";
  code: string;
  message: string;
};

export type BridgeRuntimeState =
  | { kind: "unpaired" }
  | { kind: "starting" }
  | { kind: "paused" }
  | { kind: "ready" }
  | { kind: "offline"; code: string; message: string }
  | { kind: "degraded"; code: string; message: string }
  | { kind: "feature_required"; requiredPlan: "pro"; message: string }
  | { kind: "update_required"; message: string }
  | { kind: "revoked"; message: string }
  | { kind: "fatal_error"; code: string; message: string };

export type RedactedAdapterHealth = {
  adapterId: string;
  status: AdapterHealth["status"];
  code: string;
};

export type AdapterExecutionResult = {
  status: "succeeded" | "retryable_failure" | "terminal_failure";
  code: string;
  message: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type AdapterTestActionResult = {
  status: "succeeded" | "retryable_failure" | "terminal_failure";
  code: string;
  message: string;
};

export type AdapterDiscoveryCandidate = {
  id: string;
  displayName: string;
  host: string;
  port: number;
};

export interface IntegrationAdapter<Configuration, Payload> {
  readonly id: string;
  readonly version: number;
  readonly capabilities: readonly BridgeCapability[];
  readonly supportedJobSchemas: readonly ContractVersion[];
  migrateConfiguration?(
    value: unknown,
    fromVersion: number,
  ): Configuration | undefined;
  validateConfiguration(value: unknown): Configuration;
  redactConfiguration(value: Configuration): Record<string, unknown>;
  healthCheck(configuration: Configuration): Promise<AdapterHealth>;
  execute(
    payload: Payload,
    configuration: Configuration,
    signal: AbortSignal,
  ): Promise<AdapterExecutionResult>;
  test?(
    configuration: Configuration,
    signal: AbortSignal,
  ): Promise<AdapterTestActionResult>;
  discover?(signal: AbortSignal): Promise<readonly AdapterDiscoveryCandidate[]>;
}

export type DiagnosticsSnapshot = {
  generatedAt: string;
  appVersion: string;
  runtime: BridgeRuntimeState;
  pairedRestaurant: { id: string; displayName: string } | null;
  adapters: readonly RedactedAdapterHealth[];
  recentJobIds: readonly string[];
  recentErrorCodes: readonly string[];
};

export class BridgeContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeContractValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BridgeContractValidationError(
      `${field} must be a non-empty string.`,
    );
  }

  return value;
}

function requireIsoTimestamp(value: unknown, field: string): string {
  const timestamp = requireString(value, field);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new BridgeContractValidationError(
      `${field} must be an ISO timestamp.`,
    );
  }

  return timestamp;
}

function requireDecimal(value: unknown, field: string): string {
  const decimal = requireString(value, field);
  if (!/^\d+(\.\d{1,2})?$/.test(decimal)) {
    throw new BridgeContractValidationError(
      `${field} must be a non-negative decimal string.`,
    );
  }

  return decimal;
}

function decimalMinorUnits(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function parseKitchenPrintJob(value: unknown): KitchenPrintJobV1 {
  if (!isRecord(value)) {
    throw new BridgeContractValidationError(
      "Kitchen print job must be an object.",
    );
  }

  if (value.schemaVersion !== KITCHEN_PRINT_SCHEMA_VERSION) {
    throw new BridgeContractValidationError(
      "Unsupported kitchen print schema version.",
    );
  }

  if (value.jobType !== "kitchen_order") {
    throw new BridgeContractValidationError(
      "Unsupported kitchen print job type.",
    );
  }

  if (!Number.isInteger(value.tableNumber) || Number(value.tableNumber) < 1) {
    throw new BridgeContractValidationError(
      "tableNumber must be a positive integer.",
    );
  }

  if (!Array.isArray(value.items) || value.items.length === 0) {
    throw new BridgeContractValidationError(
      "items must contain at least one item.",
    );
  }

  const itemIds = new Set<string>();
  const items = value.items.map((item, index): KitchenPrintItemV1 => {
    if (!isRecord(item)) {
      throw new BridgeContractValidationError(
        `items[${index}] must be an object.`,
      );
    }

    if (!Number.isInteger(item.quantity) || Number(item.quantity) < 1) {
      throw new BridgeContractValidationError(
        `items[${index}].quantity must be positive.`,
      );
    }

    if (item.variation !== null && typeof item.variation !== "string") {
      throw new BridgeContractValidationError(
        `items[${index}].variation must be a string or null.`,
      );
    }

    if (
      item.notes !== undefined &&
      item.notes !== null &&
      typeof item.notes !== "string"
    ) {
      throw new BridgeContractValidationError(
        `items[${index}].notes must be a string, null, or omitted.`,
      );
    }

    const itemId = requireString(item.itemId, `items[${index}].itemId`);
    if (itemIds.has(itemId)) {
      throw new BridgeContractValidationError(
        `items[${index}].itemId must be unique.`,
      );
    }
    itemIds.add(itemId);
    const quantity = Number(item.quantity);
    const unitPrice = requireDecimal(
      item.unitPrice,
      `items[${index}].unitPrice`,
    );
    const lineTotal = requireDecimal(
      item.lineTotal,
      `items[${index}].lineTotal`,
    );
    if (
      decimalMinorUnits(unitPrice) * BigInt(quantity) !==
      decimalMinorUnits(lineTotal)
    ) {
      throw new BridgeContractValidationError(
        `items[${index}].lineTotal must equal unitPrice multiplied by quantity.`,
      );
    }

    return {
      itemId,
      name: requireString(item.name, `items[${index}].name`),
      variation: item.variation,
      ...(typeof item.notes === "string" || item.notes === null
        ? { notes: item.notes }
        : {}),
      quantity,
      unitPrice,
      lineTotal,
    };
  });

  const notes = value.notes;
  if (notes !== null && typeof notes !== "string") {
    throw new BridgeContractValidationError("notes must be a string or null.");
  }

  const totalAmount = requireDecimal(value.totalAmount, "totalAmount");
  const itemTotal = items.reduce(
    (total, item) => total + decimalMinorUnits(item.lineTotal),
    0n,
  );
  if (itemTotal !== decimalMinorUnits(totalAmount)) {
    throw new BridgeContractValidationError(
      "totalAmount must equal the sum of item line totals.",
    );
  }

  return {
    schemaVersion: KITCHEN_PRINT_SCHEMA_VERSION,
    jobType: "kitchen_order",
    jobId: requireString(value.jobId, "jobId"),
    restaurantId: requireString(value.restaurantId, "restaurantId"),
    restaurantName: requireString(value.restaurantName, "restaurantName"),
    orderId: requireString(value.orderId, "orderId"),
    orderReference: requireString(value.orderReference, "orderReference"),
    tableNumber: Number(value.tableNumber),
    createdAt: requireIsoTimestamp(value.createdAt, "createdAt"),
    currency: requireString(value.currency, "currency"),
    notes,
    items,
    totalAmount,
    ...(typeof value.reprint === "boolean" ? { reprint: value.reprint } : {}),
  };
}

export function parseBridgeJobEnvelope(value: unknown): BridgeJobEnvelope {
  if (!isRecord(value)) {
    throw new BridgeContractValidationError(
      "Bridge job envelope must be an object.",
    );
  }

  if (value.schemaVersion !== KITCHEN_PRINT_SCHEMA_VERSION) {
    return {
      schemaVersion:
        typeof value.schemaVersion === "number" ? value.schemaVersion : -1,
      type: "unsupported",
      jobId: typeof value.jobId === "string" ? value.jobId : "unknown",
      reason: "unsupported_schema",
    };
  }

  if (value.type !== "kitchen_order" || !isRecord(value.lease)) {
    throw new BridgeContractValidationError("Malformed bridge job envelope.");
  }

  return {
    schemaVersion: KITCHEN_PRINT_SCHEMA_VERSION,
    type: "kitchen_order",
    job: parseKitchenPrintJob(value.job),
    lease: {
      token: requireString(value.lease.token, "lease.token"),
      expiresAt: requireIsoTimestamp(value.lease.expiresAt, "lease.expiresAt"),
    },
  };
}
