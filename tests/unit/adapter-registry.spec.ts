import { AdapterConfigurationStore } from "../../src/integrations/adapter-config-store";
import {
  AdapterRegistry,
  executeAdapter,
} from "../../src/integrations/adapter-registry";
import { fakeKitchenAdapter } from "../fakes/fake-kitchen-adapter";

describe("adapter registry", () => {
  it("rejects duplicate, unknown, and incompatible adapters", () => {
    const registry = new AdapterRegistry([fakeKitchenAdapter]);
    expect(() => registry.register(fakeKitchenAdapter)).toThrow(
      "already registered",
    );
    expect(() => registry.get("missing")).toThrow("not registered");
    expect(() =>
      registry.resolve(fakeKitchenAdapter.id, {
        type: "kitchen_order",
        schemaVersion: 2,
        payload: {},
      }),
    ).toThrow("schema");
    expect(() =>
      registry.resolve(fakeKitchenAdapter.id, {
        type: "unknown",
        schemaVersion: 1,
        payload: {},
      }),
    ).toThrow("does not support");
  });

  it("dispatches a deterministic fake result with bounded metadata", async () => {
    const registry = new AdapterRegistry([fakeKitchenAdapter]);
    await expect(
      executeAdapter(
        registry,
        fakeKitchenAdapter.id,
        { type: "kitchen_order", schemaVersion: 1, payload: {} },
        { outcome: "retryable_failure" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "retryable_failure",
      metadata: { safe: true },
    });
  });

  it("namespaces, migrates, validates, and redacts adapter configuration", async () => {
    let file = {
      adapters: {} as Record<string, { version: number; value: unknown }>,
    };
    const store = new AdapterConfigurationStore({
      read: jest.fn(async () => file),
      write: jest.fn(async (value) => {
        file = value;
      }),
    });
    await expect(
      store.write(fakeKitchenAdapter, { outcome: "succeeded" }),
    ).resolves.toEqual({ outcome: "succeeded" });
    await expect(store.read(fakeKitchenAdapter)).resolves.toEqual({
      outcome: "succeeded",
    });
    await expect(store.safeConfiguration(fakeKitchenAdapter)).resolves.toEqual({
      outcome: "succeeded",
    });
    file = { adapters: { [fakeKitchenAdapter.id]: { version: 0, value: {} } } };
    await expect(store.read(fakeKitchenAdapter)).rejects.toThrow("unsupported");
  });

  it("stores multiple adapter profiles with one active configuration", async () => {
    let file = {
      adapters: {} as Record<
        string,
        {
          version: number;
          value: unknown;
          profiles?: Array<{ id: string; value: unknown }>;
          activeProfileId?: string;
        }
      >,
    };
    const store = new AdapterConfigurationStore({
      read: jest.fn(async () => file),
      write: jest.fn(async (value) => {
        file = value;
      }),
    });

    file = {
      adapters: {
        [fakeKitchenAdapter.id]: {
          version: 1,
          value: { outcome: "succeeded" },
        },
      },
    };
    await expect(store.profiles(fakeKitchenAdapter)).resolves.toEqual({
      activeProfileId: "primary",
      profiles: [{ id: "primary", value: { outcome: "succeeded" } }],
    });

    await store.writeProfile(
      fakeKitchenAdapter,
      "kitchen-1",
      { outcome: "succeeded" },
      { activate: true },
    );
    await store.removeProfile(fakeKitchenAdapter, "primary");
    await store.writeProfile(fakeKitchenAdapter, "kitchen-2", {
      outcome: "retryable_failure",
    });
    await expect(store.profiles(fakeKitchenAdapter)).resolves.toMatchObject({
      activeProfileId: "kitchen-1",
      profiles: [
        { id: "kitchen-1", value: { outcome: "succeeded" } },
        { id: "kitchen-2", value: { outcome: "retryable_failure" } },
      ],
    });

    await store.activateProfile(fakeKitchenAdapter, "kitchen-2");
    await expect(store.read(fakeKitchenAdapter)).resolves.toEqual({
      outcome: "retryable_failure",
    });

    await store.removeProfile(fakeKitchenAdapter, "kitchen-2");
    await expect(store.profiles(fakeKitchenAdapter)).resolves.toMatchObject({
      activeProfileId: "kitchen-1",
      profiles: [{ id: "kitchen-1" }],
    });
    await store.removeProfile(fakeKitchenAdapter, "kitchen-1");
    await expect(store.read(fakeKitchenAdapter)).resolves.toBeNull();
  });
});
