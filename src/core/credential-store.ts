export type BridgeCredential = {
  deviceId: string;
  token: string;
  restaurant: { id: string; displayName: string };
  issuedAt: string;
  appVersion: string;
};

export type RedactedCredentialState =
  | { kind: "unpaired" }
  | {
      kind: "paired";
      deviceId: string;
      restaurant: { id: string; displayName: string };
      issuedAt: string;
      appVersion: string;
    };

export interface CredentialStore {
  read(): Promise<BridgeCredential | null>;
  save(credential: BridgeCredential): Promise<void>;
  clear(): Promise<void>;
}

export function redactCredential(
  credential: BridgeCredential | null,
): RedactedCredentialState {
  if (!credential) return { kind: "unpaired" };
  return {
    kind: "paired",
    deviceId: credential.deviceId,
    restaurant: credential.restaurant,
    issuedAt: credential.issuedAt,
    appVersion: credential.appVersion,
  };
}

export function validateCredential(value: unknown): BridgeCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Credential data is invalid.");
  }
  const input = value as Record<string, unknown>;
  const restaurant = input.restaurant;
  if (
    !restaurant ||
    typeof restaurant !== "object" ||
    Array.isArray(restaurant)
  ) {
    throw new Error("Credential restaurant is invalid.");
  }
  const restaurantValue = restaurant as Record<string, unknown>;
  for (const key of ["deviceId", "token", "issuedAt", "appVersion"] as const) {
    if (typeof input[key] !== "string" || input[key].trim().length === 0) {
      throw new Error(`Credential ${key} is invalid.`);
    }
  }
  if (
    typeof restaurantValue.id !== "string" ||
    typeof restaurantValue.displayName !== "string"
  ) {
    throw new Error("Credential restaurant is invalid.");
  }
  if (Number.isNaN(Date.parse(input.issuedAt as string))) {
    throw new Error("Credential issuedAt is invalid.");
  }
  return {
    deviceId: input.deviceId as string,
    token: input.token as string,
    restaurant: {
      id: restaurantValue.id,
      displayName: restaurantValue.displayName,
    },
    issuedAt: input.issuedAt as string,
    appVersion: input.appVersion as string,
  };
}
