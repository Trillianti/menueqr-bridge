import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  session,
  shell,
  Tray,
} from "electron";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { autoUpdater } from "electron-updater";

import { BRIDGE_FOUNDATION_CHANNELS } from "../contracts";
import { FOUNDATION_RUNTIME_STATE } from "../core/foundation-runtime";
import { BridgeRuntime } from "../core/bridge-runtime";
import { RuntimeStore } from "../core/runtime-store";
import { AutostartAdapter } from "./autostart";
import {
  DEFAULT_BRIDGE_API_BASE_URL,
  DEFAULT_BRIDGE_VERIFICATION_HOSTS,
  validateBridgeApiBaseUrl,
} from "./bridge-url";
import { DiagnosticLog } from "./diagnostic-log";
import { DiagnosticsService } from "./diagnostics-service";
import { DeviceFingerprintStore } from "./device-fingerprint-store";
import { KitchenRouteService } from "./kitchen-route-service";
import { HttpPairingApi } from "./pairing-api";
import { DesktopPairingService } from "./pairing-service";
import { credentialPath, SafeCredentialStore } from "./safe-credential-store";
import { BridgeUpdateService } from "./update-service";
import {
  createShellSnapshot,
  isInstallerOrUpdaterLaunch,
  type ShellRuntimeKind,
} from "./shell-state";

const appId = "de.menueqr.bridge";
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let deviceRuntime: BridgeRuntime | null = null;
let updateRuntime: BridgeUpdateService | null = null;
let explicitQuitRequested = false;
let shellRuntime: ShellRuntimeKind = "unpaired";
let shutdownInProgress = false;

if (process.env.BRIDGE_E2E_DATA_DIR) {
  app.setPath("userData", process.env.BRIDGE_E2E_DATA_DIR);
}

function isDevelopment(): boolean {
  return (
    process.env.NODE_ENV === "development" || process.env.BRIDGE_E2E === "1"
  );
}

function trayLabels(): {
  open: string;
  pause: string;
  resume: string;
  autostart: string;
  diagnostics: string;
  quit: string;
} {
  return {
    open: "Einstellungen öffnen",
    pause: "Pausieren",
    resume: "Fortsetzen",
    autostart: "Mit Windows starten",
    diagnostics: "Diagnoseordner öffnen",
    quit: "Beenden",
  };
}

function trayIcon() {
  const useMacTemplate = process.platform === "darwin";
  const assetName = useMacTemplate
    ? "menueqr-tray-template.png"
    : "menueqr-tray-windows.png";
  const assetPath = app.isPackaged
    ? join(process.resourcesPath, assetName)
    : join(__dirname, "../renderer", assetName);
  const icon = nativeImage.createFromPath(assetPath);
  if (!icon.isEmpty()) {
    const size = useMacTemplate ? 20 : 32;
    const resized = icon.resize({ width: size, height: size });
    if (useMacTemplate) resized.setTemplateImage(true);
    return resized;
  }
  return nativeImage.createEmpty();
}

function dockIcon() {
  const assetPath = app.isPackaged
    ? join(process.resourcesPath, "menueqr-dock-icon.svg")
    : join(__dirname, "../renderer/menueqr-dock-icon.svg");
  return nativeImage.createFromPath(assetPath);
}

function showSettings(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = createSettingsWindow();
  }
  settingsWindow.show();
  settingsWindow.focus();
}

function createSettingsWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: "MenüQR Bridge",
    icon: trayIcon(),
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" }
      : process.platform === "win32"
        ? {
            titleBarStyle: "hidden",
            titleBarOverlay: {
              color: "#f1eee8",
              symbolColor: "#625a52",
              height: 38,
            },
          }
        : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: isDevelopment(),
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("before-input-event", (event, input) => {
    if (!isDevelopment() && input.key === "F12") event.preventDefault();
  });
  window.on("close", (event) => {
    if (explicitQuitRequested) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    if (settingsWindow === window) settingsWindow = null;
  });
  void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
}

function createTray(autostart: AutostartAdapter): Tray {
  const trayInstance = new Tray(trayIcon());
  trayInstance.setToolTip("MenüQR Bridge");
  const rebuildMenu = () => {
    const labels = trayLabels();
    trayInstance.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: `MenüQR Bridge — ${trayRuntimeLabel()}`,
          enabled: false,
        },
        { type: "separator" },
        { label: labels.open, click: showSettings },
        {
          label: shellRuntime === "paused" ? labels.resume : labels.pause,
          click: () => {
            shellRuntime = shellRuntime === "paused" ? "unpaired" : "paused";
            rebuildMenu();
          },
        },
        {
          label: labels.autostart,
          type: "checkbox",
          checked: autostart.isEnabled(),
          click: (item) => {
            autostart.setEnabled(Boolean(item.checked));
            rebuildMenu();
          },
        },
        { type: "separator" },
        {
          label: labels.diagnostics,
          click: () =>
            void shell.openPath(join(app.getPath("userData"), "diagnostics")),
        },
        {
          label: labels.quit,
          click: () => {
            explicitQuitRequested = true;
            app.quit();
          },
        },
      ]),
    );
  };
  trayInstance.on("click", showSettings);
  trayInstance.on("right-click", rebuildMenu);
  rebuildMenu();
  return trayInstance;
}

function registerIpc(
  autostart: AutostartAdapter,
  pairing: DesktopPairingService,
  runtime: BridgeRuntime,
  route: KitchenRouteService,
  maybeStartRuntime: () => Promise<void>,
  diagnostics: DiagnosticsService,
  updates: BridgeUpdateService,
  development: {
    enabled: boolean;
    apiBaseUrl: string | null;
    verificationHosts: readonly string[];
  },
): void {
  const assertSettingsSender = (senderId: number) => {
    if (
      !settingsWindow ||
      settingsWindow.isDestroyed() ||
      settingsWindow.webContents.id !== senderId
    ) {
      throw new Error("Unauthorized IPC sender.");
    }
  };
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.getRuntimeSnapshot, (event) => {
    assertSettingsSender(event.sender.id);
    return FOUNDATION_RUNTIME_STATE;
  });
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.getShellSnapshot, (event) => {
    assertSettingsSender(event.sender.id);
    return createShellSnapshot(shellRuntime, autostart.isEnabled());
  });
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.showSettings, (event) => {
    assertSettingsSender(event.sender.id);
    showSettings();
  });
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.setAutostart,
    (event, enabled: unknown) => {
      assertSettingsSender(event.sender.id);
      if (typeof enabled !== "boolean")
        throw new Error("Invalid autostart state.");
      const actual = autostart.setEnabled(enabled);
      return createShellSnapshot(shellRuntime, actual);
    },
  );
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.setPaused,
    async (event, paused: unknown) => {
      assertSettingsSender(event.sender.id);
      if (typeof paused !== "boolean")
        throw new Error("Invalid runtime state.");
      await runtime.setPaused(paused);
      if (!paused) await maybeStartRuntime();
      shellRuntime = paused ? "paused" : "unpaired";
      return createShellSnapshot(shellRuntime, autostart.isEnabled());
    },
  );
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.getPairingSnapshot, (event) => {
    assertSettingsSender(event.sender.id);
    return pairing.snapshot();
  });
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.beginPairing, async (event) => {
    assertSettingsSender(event.sender.id);
    return pairing.begin();
  });
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.openPairingBrowser,
    async (event) => {
      assertSettingsSender(event.sender.id);
      await pairing.openPairingBrowser();
    },
  );
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.disconnect, async (event) => {
    assertSettingsSender(event.sender.id);
    runtime.stop();
    return pairing.disconnect();
  });
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.getDeviceRuntimeSnapshot,
    (event) => {
      assertSettingsSender(event.sender.id);
      return runtime.snapshot();
    },
  );
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.getIntegrationsSnapshot,
    async (event) => {
      assertSettingsSender(event.sender.id);
      return [await route.integrationSnapshot()];
    },
  );
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.getDevelopmentSnapshot, (event) => {
    assertSettingsSender(event.sender.id);
    return development;
  });
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.getPrinterSnapshot, (event) => {
    assertSettingsSender(event.sender.id);
    return route.snapshot();
  });
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.savePrinterConfiguration,
    async (event, request: unknown) => {
      assertSettingsSender(event.sender.id);
      const { configuration, printerId } =
        validatePrinterConfigurationRequest(request);
      const snapshot = await route.saveConfiguration(configuration, printerId);
      await maybeStartRuntime();
      return snapshot;
    },
  );
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.deletePrinterConfiguration,
    async (event, printerId: unknown) => {
      assertSettingsSender(event.sender.id);
      const snapshot = await route.deleteConfiguration(
        validatePrinterId(printerId),
      );
      await maybeStartRuntime();
      return snapshot;
    },
  );
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.activatePrinterConfiguration,
    async (event, printerId: unknown) => {
      assertSettingsSender(event.sender.id);
      const snapshot = await route.activateConfiguration(
        validatePrinterId(printerId),
      );
      await maybeStartRuntime();
      return snapshot;
    },
  );
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.testPrinterConnection,
    async (event, printerId: unknown) => {
      assertSettingsSender(event.sender.id);
      return route.checkConnection(validateOptionalPrinterId(printerId));
    },
  );
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.testPrinterPrint,
    async (event, printerId: unknown) => {
      assertSettingsSender(event.sender.id);
      return route.testPrint(
        new AbortController().signal,
        validateOptionalPrinterId(printerId),
      );
    },
  );
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.discoverPrinters, async (event) => {
    assertSettingsSender(event.sender.id);
    return route.discoverLocalPrinters(new AbortController().signal);
  });
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.selectDiscoveredPrinter,
    (event, candidateId: unknown) => {
      assertSettingsSender(event.sender.id);
      if (typeof candidateId !== "string" || candidateId.length > 160) {
        throw new Error("Invalid discovered printer.");
      }
      return route.selectDiscoveredPrinter(candidateId);
    },
  );
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.testDiscoveredPrinter,
    async (event) => {
      assertSettingsSender(event.sender.id);
      return route.testSelectedDiscoveredPrinter(new AbortController().signal);
    },
  );
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.confirmDiscoveredPrinter,
    async (event, request: unknown) => {
      assertSettingsSender(event.sender.id);
      const { printerId, bonLayoutProfile } =
        validateDiscoveredPrinterConfirmation(request);
      const snapshot = await route.confirmSelectedDiscoveredPrinter(
        printerId,
        bonLayoutProfile,
      );
      await maybeStartRuntime();
      return snapshot;
    },
  );
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.requestPrinterSupport,
    async (event, request: unknown) => {
      assertSettingsSender(event.sender.id);
      return pairing.requestPrinterSupport(
        validatePrinterSupportRequest(request),
      );
    },
  );
  ipcMain.handle(
    BRIDGE_FOUNDATION_CHANNELS.exportDiagnostics,
    async (event) => {
      assertSettingsSender(event.sender.id);
      return diagnostics.export();
    },
  );
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.getUpdateSnapshot, (event) => {
    assertSettingsSender(event.sender.id);
    return updates.snapshot();
  });
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.checkForUpdates, async (event) => {
    assertSettingsSender(event.sender.id);
    return updates.check();
  });
  ipcMain.handle(BRIDGE_FOUNDATION_CHANNELS.installUpdate, (event) => {
    assertSettingsSender(event.sender.id);
    return updates.install();
  });
}

function validateDiscoveredPrinterConfirmation(value: unknown): {
  printerId?: string;
  bonLayoutProfile: "compact" | "kitchen" | "detailed";
} {
  if (!value || typeof value !== "object") {
    throw new Error("Discovered printer confirmation is invalid.");
  }
  const request = value as {
    printerId?: unknown;
    bonLayoutProfile?: unknown;
  };
  if (
    request.bonLayoutProfile !== "compact" &&
    request.bonLayoutProfile !== "kitchen" &&
    request.bonLayoutProfile !== "detailed"
  ) {
    throw new Error("Bon layout profile is invalid.");
  }
  return {
    printerId: validateOptionalPrinterId(request.printerId),
    bonLayoutProfile: request.bonLayoutProfile,
  };
}

function validatePrinterConfigurationRequest(value: unknown): {
  configuration: unknown;
  printerId?: string;
} {
  if (!value || typeof value !== "object" || !("configuration" in value)) {
    throw new Error("Printer configuration request is invalid.");
  }
  const request = value as { configuration: unknown; printerId?: unknown };
  return {
    configuration: request.configuration,
    printerId: validateOptionalPrinterId(request.printerId),
  };
}

function validateOptionalPrinterId(value: unknown): string | undefined {
  return value === undefined ? undefined : validatePrinterId(value);
}

function validatePrinterId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) {
    throw new Error("Printer id is invalid.");
  }
  return value;
}

function validatePrinterSupportRequest(value: unknown): {
  model: string;
  note?: string;
} {
  if (!value || typeof value !== "object") {
    throw new Error("Printer support request is invalid.");
  }
  const request = value as Record<string, unknown>;
  const model = typeof request.model === "string" ? request.model.trim() : "";
  const note = typeof request.note === "string" ? request.note.trim() : "";
  if (model.length < 2 || model.length > 120 || note.length > 600) {
    throw new Error("Printer support request is invalid.");
  }
  return note ? { model, note } : { model };
}

function trayRuntimeLabel(): string {
  const state = deviceRuntime?.snapshot().kind;
  const labels: Record<string, string> = {
    stopped: "nicht verbunden",
    starting: "wird verbunden",
    ready: "bereit",
    paused: "pausiert",
    offline: "offline",
    degraded: "eingeschränkt",
    feature_required: "Tarif prüfen",
    update_required: "Aktualisierung nötig",
    revoked: "getrennt",
    fatal_error: "Aufmerksamkeit erforderlich",
  };
  return labels[state ?? "stopped"] ?? "Status wird geprüft";
}

app.enableSandbox();
app.setName("MenüQR Bridge");
app.setAppUserModelId(appId);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showSettings());
  app.whenReady().then(async () => {
    if (process.platform === "win32") Menu.setApplicationMenu(null);
    if (process.platform === "darwin") app.dock?.setIcon(dockIcon());
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    const autostart = new AutostartAdapter(app);
    const localDevelopment =
      !app.isPackaged && process.env.MENUEQR_BRIDGE_LOCAL_DEVELOPMENT === "1";
    const apiBaseUrl = validateBridgeApiBaseUrl(
      process.env.MENUEQR_BRIDGE_API_URL ?? DEFAULT_BRIDGE_API_BASE_URL,
      { allowInsecureLocal: localDevelopment },
    );
    const verificationHosts = (
      process.env.MENUEQR_BRIDGE_VERIFICATION_HOSTS ??
      DEFAULT_BRIDGE_VERIFICATION_HOSTS.join(",")
    )
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    const pairingApi = new HttpPairingApi(apiBaseUrl);
    const credentials = new SafeCredentialStore(
      safeStorage,
      credentialPath(app.getPath("userData")),
    );
    const deviceFingerprint = await new DeviceFingerprintStore(
      join(app.getPath("userData"), "device-fingerprint.txt"),
    ).readOrCreate();
    const diagnosticsPath = join(app.getPath("userData"), "diagnostics");
    const logs = new DiagnosticLog(join(diagnosticsPath, "logs"));
    const route = new KitchenRouteService(
      join(app.getPath("userData"), "runtime", "adapter-configuration.json"),
      join(app.getPath("userData"), "runtime", "execution-ledger.json"),
      pairingApi,
      (event) => logs.append(event),
    );
    route.setHealthTransitionListener((transition) => {
      if (
        !transition.active ||
        transition.previous.status !== "ready" ||
        transition.current.status === "ready"
      ) {
        return;
      }
      void logs.append({
        event: "printer.health_transition",
        adapterId: "printer.star-tsp1000-lan",
        code: transition.current.code,
        state: transition.current.status,
      });
      if (process.platform !== "win32" || !Notification.isSupported()) return;
      const notification = new Notification({
        title: "MenüQR Bridge: Druckerproblem",
        body: "Der aktive Küchendrucker ist nicht bereit. Öffnen Sie Bridge und prüfen Sie die Verbindung.",
      });
      notification.on("click", showSettings);
      notification.show();
    });
    let pairing: DesktopPairingService | null = null;
    const runtime = new BridgeRuntime(
      pairingApi,
      new RuntimeStore(
        join(app.getPath("userData"), "runtime", "runtime-state.json"),
      ),
      route,
      {
        appVersion: app.getVersion(),
        heartbeatFallbackSeconds: 30,
        onRevoked: async () => {
          await pairing?.clearRevokedCredential();
        },
        log: (event) => logs.append(event),
      },
    );
    deviceRuntime = runtime;
    const maybeStartRuntime = async () => {
      const credential = await credentials.read().catch(() => null);
      await runtime.start(credential);
    };
    const diagnostics = new DiagnosticsService(
      diagnosticsPath,
      app.getVersion(),
      credentials,
      runtime,
      route,
      autostart,
      logs,
    );
    const updates = new BridgeUpdateService(autoUpdater, {
      currentVersion: app.getVersion(),
      enabled:
        app.isPackaged &&
        existsSync(join(process.resourcesPath, "app-update.yml")),
      onDownloaded: (version) => {
        if (process.platform !== "win32" || !Notification.isSupported()) return;
        const notification = new Notification({
          title: "MenüQR Bridge: Update bereit",
          body: `Version ${version} wurde heruntergeladen. Öffnen Sie Bridge, um das Update zu installieren.`,
        });
        notification.on("click", showSettings);
        notification.show();
      },
      onEvent: (event) => logs.append(event),
    });
    updateRuntime = updates;
    void logs.append({ event: "app.ready", state: "starting" });
    void route.pruneLedger(new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000));
    void runtime.restore().then(async () => {
      await maybeStartRuntime();
    });
    pairing = new DesktopPairingService(
      pairingApi,
      credentials,
      { openExternal: (url) => shell.openExternal(url) },
      {
        appVersion: app.getVersion(),
        deviceFingerprint,
        deviceName: hostname().trim() || "MenüQR Bridge",
        verificationHosts,
        allowInsecureLocalVerification: localDevelopment,
        onCredentialSaved: async (credential) => {
          await runtime.start(credential);
        },
        onStateChange: (state) =>
          logs.append({ event: "pairing.state", state: state.kind }),
      },
    );
    void pairing.restore();
    autostart.applyInstallerPreference(process.argv);
    updates.start();
    registerIpc(
      autostart,
      pairing,
      runtime,
      route,
      maybeStartRuntime,
      diagnostics,
      updates,
      {
        enabled: localDevelopment,
        apiBaseUrl: localDevelopment ? apiBaseUrl : null,
        verificationHosts: localDevelopment ? verificationHosts : [],
      },
    );
    settingsWindow = createSettingsWindow();
    tray = createTray(autostart);
    if (isDevelopment() && !isInstallerOrUpdaterLaunch(process.argv))
      showSettings();
    app.on("activate", showSettings);
  });
}

app.on("before-quit", (event) => {
  if (!shutdownInProgress && deviceRuntime) {
    event.preventDefault();
    explicitQuitRequested = true;
    void deviceRuntime.shutdown().finally(() => {
      shutdownInProgress = true;
      tray?.destroy();
      tray = null;
      app.quit();
    });
    return;
  }
  explicitQuitRequested = true;
  updateRuntime?.stop();
  deviceRuntime?.stop();
  tray?.destroy();
  tray = null;
});
