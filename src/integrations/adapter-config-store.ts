import type { IntegrationAdapter } from "../contracts";

export type AdapterConfigurationFile = {
  adapters: Record<string, AdapterConfigurationEntry>;
};

export type AdapterConfigurationEntry = {
  version: number;
  value: unknown;
  profiles?: Array<{ id: string; value: unknown }>;
  activeProfileId?: string;
};

export type AdapterConfigurationProfiles<Configuration> = {
  profiles: Array<{ id: string; value: Configuration }>;
  activeProfileId: string | null;
};

export type AdapterConfigFileStore = {
  read(): Promise<AdapterConfigurationFile>;
  write(value: AdapterConfigurationFile): Promise<void>;
};

export class AdapterConfigurationStore {
  constructor(private readonly fileStore: AdapterConfigFileStore) {}

  async read<Configuration>(
    adapter: IntegrationAdapter<Configuration, unknown>,
  ): Promise<Configuration | null> {
    const file = await this.fileStore.read();
    const entry = file.adapters[adapter.id];
    if (!entry) return null;
    const migrated =
      entry.version === adapter.version
        ? entry.value
        : adapter.migrateConfiguration?.(entry.value, entry.version);
    if (migrated === undefined)
      throw new Error(
        `Adapter ${adapter.id} configuration version is unsupported.`,
      );
    return adapter.validateConfiguration(migrated);
  }

  async write<Configuration>(
    adapter: IntegrationAdapter<Configuration, unknown>,
    value: unknown,
  ): Promise<Configuration> {
    const validated = adapter.validateConfiguration(value);
    const file = await this.fileStore.read();
    await this.fileStore.write({
      adapters: {
        ...file.adapters,
        [adapter.id]: { version: adapter.version, value: validated },
      },
    });
    return validated;
  }

  async profiles<Configuration>(
    adapter: IntegrationAdapter<Configuration, unknown>,
  ): Promise<AdapterConfigurationProfiles<Configuration>> {
    const file = await this.fileStore.read();
    const entry = file.adapters[adapter.id];
    if (!entry) return { profiles: [], activeProfileId: null };
    const rawProfiles =
      entry.profiles && entry.profiles.length > 0
        ? entry.profiles
        : [{ id: entry.activeProfileId ?? "primary", value: entry.value }];
    const seenProfileIds = new Set<string>();
    const profiles = rawProfiles.map((profile) => {
      assertProfileId(profile.id);
      if (seenProfileIds.has(profile.id)) {
        throw new Error("ADAPTER_PROFILE_ID_DUPLICATE");
      }
      seenProfileIds.add(profile.id);
      return {
        id: profile.id,
        value: this.validateEntry(adapter, entry.version, profile.value),
      };
    });
    const requestedActive = entry.activeProfileId;
    const activeProfileId = profiles.some(
      (profile) => profile.id === requestedActive,
    )
      ? (requestedActive ?? null)
      : (profiles[0]?.id ?? null);
    return { profiles, activeProfileId };
  }

  async writeProfile<Configuration>(
    adapter: IntegrationAdapter<Configuration, unknown>,
    profileId: string,
    value: unknown,
    options: { activate?: boolean } = {},
  ): Promise<Configuration> {
    assertProfileId(profileId);
    const validated = adapter.validateConfiguration(value);
    const file = await this.fileStore.read();
    const current = await this.profiles(adapter);
    const profiles = current.profiles.filter((profile) => profile.id !== profileId);
    profiles.push({ id: profileId, value: validated });
    const activeProfileId =
      options.activate || !current.activeProfileId
        ? profileId
        : current.activeProfileId;
    const activeValue =
      profiles.find((profile) => profile.id === activeProfileId)?.value ??
      validated;
    await this.fileStore.write({
      adapters: {
        ...file.adapters,
        [adapter.id]: {
          version: adapter.version,
          value: activeValue,
          profiles,
          activeProfileId,
        },
      },
    });
    return validated;
  }

  async activateProfile<Configuration>(
    adapter: IntegrationAdapter<Configuration, unknown>,
    profileId: string,
  ): Promise<void> {
    assertProfileId(profileId);
    const file = await this.fileStore.read();
    const entry = file.adapters[adapter.id];
    const current = await this.profiles(adapter);
    const active = current.profiles.find((profile) => profile.id === profileId);
    if (!entry || !active) throw new Error("ADAPTER_PROFILE_NOT_FOUND");
    await this.fileStore.write({
      adapters: {
        ...file.adapters,
        [adapter.id]: {
          version: adapter.version,
          value: active.value,
          profiles: current.profiles,
          activeProfileId: profileId,
        },
      },
    });
  }

  async removeProfile<Configuration>(
    adapter: IntegrationAdapter<Configuration, unknown>,
    profileId: string,
  ): Promise<void> {
    assertProfileId(profileId);
    const file = await this.fileStore.read();
    if (!file.adapters[adapter.id]) return;
    const current = await this.profiles(adapter);
    if (!current.profiles.some((profile) => profile.id === profileId)) return;
    const profiles = current.profiles.filter((profile) => profile.id !== profileId);
    const adapters = { ...file.adapters };
    if (profiles.length === 0) {
      delete adapters[adapter.id];
    } else {
      const activeProfileId = profiles.some(
        (profile) => profile.id === current.activeProfileId,
      )
        ? current.activeProfileId
        : (profiles[0]?.id ?? null);
      const active = profiles.find(
        (profile) => profile.id === activeProfileId,
      );
      if (!active || !activeProfileId) throw new Error("ADAPTER_PROFILE_NOT_FOUND");
      adapters[adapter.id] = {
        version: adapter.version,
        value: active.value,
        profiles,
        activeProfileId,
      };
    }
    await this.fileStore.write({ adapters });
  }

  async safeConfiguration<Configuration>(
    adapter: IntegrationAdapter<Configuration, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const value = await this.read(adapter);
    return value ? adapter.redactConfiguration(value) : null;
  }

  private validateEntry<Configuration>(
    adapter: IntegrationAdapter<Configuration, unknown>,
    version: number,
    value: unknown,
  ): Configuration {
    const migrated =
      version === adapter.version
        ? value
        : adapter.migrateConfiguration?.(value, version);
    if (migrated === undefined)
      throw new Error(
        `Adapter ${adapter.id} configuration version is unsupported.`,
      );
    return adapter.validateConfiguration(migrated);
  }
}

function assertProfileId(profileId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profileId)) {
    throw new Error("ADAPTER_PROFILE_ID_INVALID");
  }
}
