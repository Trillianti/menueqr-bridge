function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing Bridge control: ${selector}`);
  return element;
}

document.body.dataset.platform = navigator.platform.includes("Mac")
  ? "mac"
  : navigator.platform.includes("Win")
    ? "windows"
    : "other";

type PrinterFormConfiguration = {
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

type WindowsPrinter = {
  name: string;
  driverName: string;
  portName: string;
  status: string;
};

type DiscoveredPrinter = {
  id: string;
  displayName: string;
  host: string;
  port: number;
};

type PrinterDiscovery = {
  candidates: DiscoveredPrinter[];
  selectedCandidateId: string | null;
};

type PairingSnapshot =
  | { kind: "unpaired" | "requesting_code" }
  | {
      kind: "waiting_for_approval" | "slow_down";
      userCode: string;
      expiresAt: string;
      pollingIntervalSeconds: number;
    }
  | {
      kind: "paired";
      credential: { restaurant: { displayName: string } };
    }
  | {
      kind:
        | "denied"
        | "expired"
        | "network_error"
        | "secure_storage_unavailable"
        | "secure_storage_corrupt";
      message: string;
    };

type PrinterHealth = {
  status: "ready" | "degraded" | "offline" | "misconfigured";
  code: string;
  message: string;
  checkedAt: string;
};

type PrinterSnapshot = {
  configured: boolean;
  configuration: PrinterFormConfiguration | null;
  health: PrinterHealth | null;
  activePrinterId: string | null;
  printers: Array<{
    id: string;
    configuration: PrinterFormConfiguration;
    health: PrinterHealth | null;
    active: boolean;
  }>;
};

type DeviceRuntimeSnapshot = { kind: string; message?: string };
type FoundationSnapshot = { kind: string };
type ShellSnapshot = {
  runtime: { kind: "unpaired" | "starting" | "paused" | "shell_error" };
  autostartEnabled: boolean;
};

type IntegrationSnapshot = {
  id: string;
  capabilities: readonly string[];
  configured: boolean;
  healthStatus:
    | "ready"
    | "degraded"
    | "offline"
    | "misconfigured"
    | "not_configured";
};

type UpdateSnapshot =
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

type DevelopmentSnapshot = {
  enabled: boolean;
  apiBaseUrl: string | null;
  verificationHosts: string[];
};

const statusElement = requiredElement<HTMLElement>(
  "[data-testid='foundation-status']",
);
const onboardingTitle = requiredElement<HTMLElement>(
  "[data-testid='onboarding-title']",
);
const onboardingDescription = requiredElement<HTMLElement>(
  "[data-testid='onboarding-description']",
);
const pairingCard = requiredElement<HTMLElement>(
  "[data-testid='pairing-card']",
);
const printerSetupCard = requiredElement<HTMLElement>(
  "[data-testid='printer-setup-card']",
);
const printerDetailsCard = requiredElement<HTMLElement>(
  "[data-testid='printer-details-card']",
);
const printerDetailsBackButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-details-back']",
);
const printerDetailsForm = requiredElement<HTMLFormElement>(
  "[data-testid='printer-details-form']",
);
const printerDetailsAddress = requiredElement<HTMLElement>(
  "[data-testid='printer-details-address']",
);
const printerDetailsHealth = requiredElement<HTMLElement>(
  "[data-testid='printer-details-health']",
);
const printerDetailsConnectionButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-details-connection']",
);
const printerDetailsTestButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-details-test']",
);
const printerDetailsActivateButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-details-activate']",
);
const printerDetailsDeleteButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-details-delete']",
);
const printerDetailsStatus = requiredElement<HTMLElement>(
  "[data-testid='printer-details-status']",
);
const printerLibrary = requiredElement<HTMLElement>(
  "[data-testid='printer-library']",
);
const printerEmptyState = requiredElement<HTMLElement>(
  "[data-testid='printer-empty-state']",
);
const savedPrinterList = requiredElement<HTMLElement>(
  "[data-testid='saved-printer-list']",
);
const printerAddButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-add']",
);
const printerAddAnotherButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-add-another']",
);
const printerSetupBackButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-setup-back']",
);
const printerSetupTitle = requiredElement<HTMLElement>(
  "[data-testid='printer-setup-title']",
);
const printerDeleteDialog = requiredElement<HTMLDialogElement>(
  "[data-testid='printer-delete-dialog']",
);
const printerDeleteCopy = requiredElement<HTMLElement>(
  "[data-testid='printer-delete-copy']",
);
const printerDeleteConfirmButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-delete-confirm']",
);
const printerDeleteCancelButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-delete-cancel']",
);
const printerDeleteCloseButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-delete-close']",
);
const pairingElement = requiredElement<HTMLElement>(
  "[data-testid='pairing-status']",
);
const pairingCodeElement = requiredElement<HTMLElement>(
  "[data-testid='pairing-code']",
);
const pairingButton = requiredElement<HTMLButtonElement>(
  "[data-testid='pairing-toggle']",
);
const heroPairingButton = requiredElement<HTMLButtonElement>(
  "[data-testid='hero-pairing-start']",
);
const heroPairingCard = requiredElement<HTMLElement>(
  "[data-testid='pairing-hero-card']",
);
const heroPairingCode = requiredElement<HTMLElement>(
  "[data-testid='pairing-hero-code']",
);
const heroPairingExpires = requiredElement<HTMLElement>(
  "[data-testid='pairing-hero-expires']",
);
const heroPairingOpenButton = requiredElement<HTMLButtonElement>(
  "[data-testid='pairing-hero-open']",
);
const restaurantProfile = requiredElement<HTMLElement>(
  "[data-testid='restaurant-profile']",
);
const restaurantProfileName = requiredElement<HTMLElement>(
  "[data-testid='restaurant-profile-name']",
);
const connectionDot = requiredElement<HTMLElement>(
  "[data-testid='connection-dot']",
);
const connectedTabs = requiredElement<HTMLElement>(
  "[data-testid='connected-tabs']",
);
const mainTab = requiredElement<HTMLButtonElement>("[data-testid='tab-main']");
const printersTab = requiredElement<HTMLButtonElement>(
  "[data-testid='tab-printers']",
);
const settingsTab = requiredElement<HTMLButtonElement>(
  "[data-testid='tab-settings']",
);
const printerElement = requiredElement<HTMLElement>(
  "[data-testid='printer-status']",
);
const serviceStatus = requiredElement<HTMLElement>(
  "[data-testid='service-status']",
);
const serviceStatusCopy = requiredElement<HTMLElement>(
  "[data-testid='service-status-copy']",
);
const runtimeElement = requiredElement<HTMLElement>(
  "[data-testid='device-runtime-status']",
);
const shellElement = requiredElement<HTMLElement>(
  "[data-testid='shell-status']",
);
const pauseButton = requiredElement<HTMLButtonElement>(
  "[data-testid='pause-toggle']",
);
const autostartButton = requiredElement<HTMLButtonElement>(
  "[data-testid='autostart-toggle']",
);
const printerForm = requiredElement<HTMLFormElement>(
  "[data-testid='printer-configuration']",
);
const printerFieldset = requiredElement<HTMLFieldSetElement>(
  "[data-testid='printer-fieldset']",
);
const manualPrinterSettings = requiredElement<HTMLDetailsElement>(
  "[data-testid='manual-printer-settings']",
);
const printerSaveButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-save']",
);
const printerDiscoveryElement = requiredElement<HTMLElement>(
  "[data-testid='printer-discovery-status']",
);
const printerCandidatesElement = requiredElement<HTMLElement>(
  "[data-testid='printer-discovery-candidates']",
);
const printerDiscoveryButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-discover']",
);
const printerTypeSelect = requiredElement<HTMLSelectElement>(
  "[data-testid='printer-type']",
);
const printerDiscoveryTestButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-discovery-test']",
);
const printerDiscoveryConfirmButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-discovery-confirm']",
);
const printerRequestToggleButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-request-toggle']",
);
const printerRequestDialog = requiredElement<HTMLDialogElement>(
  "[data-testid='printer-request-dialog']",
);
const printerRequestCloseButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-request-close']",
);
const printerRequestForm = requiredElement<HTMLFormElement>(
  "[data-testid='printer-request-form']",
);
const printerRequestModel = requiredElement<HTMLInputElement>(
  "[data-testid='printer-request-model']",
);
const printerRequestSubmitButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-request-submit']",
);
const printerRequestCancelButton = requiredElement<HTMLButtonElement>(
  "[data-testid='printer-request-cancel']",
);
const printerRequestStatus = requiredElement<HTMLElement>(
  "[data-testid='printer-request-status']",
);
const diagnosticsButton = requiredElement<HTMLButtonElement>(
  "[data-testid='diagnostics-export']",
);
const diagnosticsStatus = requiredElement<HTMLElement>(
  "[data-testid='diagnostics-status']",
);
const integrationsList = requiredElement<HTMLElement>(
  "[data-testid='integrations-list']",
);
const updateControls = requiredElement<HTMLElement>(
  "[data-testid='update-controls']",
);
const updateStatus = requiredElement<HTMLElement>(
  "[data-testid='update-status']",
);
const updateCheckButton = requiredElement<HTMLButtonElement>(
  "[data-testid='update-check']",
);
const updateInstallButton = requiredElement<HTMLButtonElement>(
  "[data-testid='update-install']",
);
const developmentPanel = requiredElement<HTMLElement>(
  "[data-testid='development-panel']",
);
const developmentApi = requiredElement<HTMLElement>(
  "[data-testid='development-api']",
);
const developmentHosts = requiredElement<HTMLElement>(
  "[data-testid='development-hosts']",
);
const developmentPairingError = requiredElement<HTMLElement>(
  "[data-testid='development-pairing-error']",
);
const setupSteps = {
  pairing: requiredElement<HTMLElement>("[data-setup-step='pairing']"),
  printer: requiredElement<HTMLElement>("[data-setup-step='printer']"),
  ready: requiredElement<HTMLElement>("[data-setup-step='ready']"),
};

let pairingRefreshTimer: number | null = null;
let pairingCountdownTimer: number | null = null;
let pairingSnapshot: PairingSnapshot | null = null;
let printerSnapshot: PrinterSnapshot | null = null;
let deviceRuntimeSnapshot: DeviceRuntimeSnapshot | null = null;
let foundationSnapshot: FoundationSnapshot | null = null;
let shellSnapshot: ShellSnapshot | null = null;
let integrationsSnapshot: IntegrationSnapshot[] = [];
let updateSnapshot: UpdateSnapshot | null = null;
let developmentSnapshot: DevelopmentSnapshot | null = null;
let printerDiscovery: PrinterDiscovery | null = null;
let windowsPrinters: WindowsPrinter[] = [];
let discoveryTestSucceeded = false;
let discoveryConfirmed = false;
let discoveryInProgress = false;
let discoveryTestInProgress = false;
let activeBridgeTab: "main" | "printers" | "settings" = "main";
let printerWorkspaceView: "library" | "setup" | "details" = "library";
const printerConnectionsInProgress = new Set<string>();
const printerTestsInProgress = new Set<string>();
const printerFeedbackById = new Map<
  string,
  { message: string; tone: "neutral" | "success" | "attention" }
>();
let editingPrinterId: string | null = null;
let pendingDeletePrinterId: string | null = null;

function isPaired(): boolean {
  return pairingSnapshot?.kind === "paired";
}

function renderConnectedNavigation(): void {
  const paired = isPaired();
  connectedTabs.hidden = !paired;
  document.body.dataset.activeTab = activeBridgeTab;
  mainTab.dataset.active = String(activeBridgeTab === "main");
  printersTab.dataset.active = String(activeBridgeTab === "printers");
  settingsTab.dataset.active = String(activeBridgeTab === "settings");
  const connected = paired && deviceRuntimeSnapshot?.kind === "ready";
  connectionDot.dataset.state = connected ? "connected" : "disconnected";
  connectionDot.title = connected ? "Verbunden" : "Nicht verbunden";
}

function clearPairingCountdown(): void {
  if (pairingCountdownTimer !== null) {
    window.clearInterval(pairingCountdownTimer);
    pairingCountdownTimer = null;
  }
}

function startPairingCountdown(expiresAt: string): void {
  clearPairingCountdown();
  const renderCountdown = () => {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((Date.parse(expiresAt) - Date.now()) / 1_000),
    );
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = String(remainingSeconds % 60).padStart(2, "0");
    heroPairingExpires.textContent =
      remainingSeconds > 0
        ? `Gültig für ${minutes}:${seconds} Minuten`
        : "Code abgelaufen";
  };
  renderCountdown();
  pairingCountdownTimer = window.setInterval(renderCountdown, 1_000);
}

function setStepState(
  step: keyof typeof setupSteps,
  state: "done" | "current" | "upcoming",
): void {
  setupSteps[step].dataset.state = state;
}

function setFoundationStatus(
  text: string,
  tone: "success" | "attention" | "danger" | "neutral",
): void {
  statusElement.textContent = text;
  statusElement.dataset.tone = tone;
}

function selectedDiscoveredPrinter(): DiscoveredPrinter | null {
  if (!printerDiscovery?.selectedCandidateId) return null;
  return (
    printerDiscovery.candidates.find(
      (candidate) => candidate.id === printerDiscovery?.selectedCandidateId,
    ) ?? null
  );
}

function printerHealthLabel(health: PrinterHealth | null): {
  title: string;
  detail: string;
  state: "success" | "attention" | "neutral";
} {
  if (!health)
    return {
      title: "Nicht geprüft",
      detail: "Die Verbindung wurde noch nicht geprüft.",
      state: "neutral",
    };
  if (health.status === "ready")
    return {
      title: "Online",
      detail: "Der Drucker ist im lokalen Netzwerk erreichbar.",
      state: "success",
    };
  if (health.code === "WINDOWS_PRINTER_NOT_FOUND")
    return {
      title: "Windows-Drucker fehlt",
      detail:
        "Der ausgewählte Drucker ist in Windows nicht mehr verfügbar. Wählen Sie ihn erneut aus.",
      state: "attention",
    };
  if (health.code === "WINDOWS_SPOOLER_UNAVAILABLE")
    return {
      title: "Windows-Druck nicht verfügbar",
      detail: "Die Windows-Druckerwarteschlange ist gerade nicht verfügbar.",
      state: "attention",
    };
  if (health.status === "offline")
    return {
      title: "Offline",
      detail:
        "Prüfen Sie, ob Drucker und Windows-Gerät im selben Netzwerk sind.",
      state: "attention",
    };
  if (health.status === "misconfigured")
    return {
      title: "Konfiguration prüfen",
      detail:
        "Öffnen Sie die manuellen Einstellungen und prüfen Sie die Angaben.",
      state: "attention",
    };
  return {
    title: "Verbindung prüfen",
    detail: "Führen Sie eine Verbindungsprüfung durch.",
    state: "attention",
  };
}

function renderPrinterWorkspace(): void {
  const printers = printerSnapshot?.printers ?? [];
  const configured = printers.length > 0;

  printerLibrary.hidden = printerWorkspaceView !== "library";
  printerSetupCard.hidden = printerWorkspaceView !== "setup";
  printerDetailsCard.hidden = printerWorkspaceView !== "details";
  printerEmptyState.hidden = configured;
  printerAddAnotherButton.hidden = !configured;
  savedPrinterList.hidden = !configured;
  savedPrinterList.replaceChildren();

  for (const printer of printers) {
    const card = document.createElement("article");
    const primary = document.createElement("div");
    const icon = document.createElement("span");
    const copy = document.createElement("div");
    const name = document.createElement("h3");
    const meta = document.createElement("p");
    const healthContainer = document.createElement("div");
    const healthBadge = document.createElement("span");
    const checked = document.createElement("p");
    const actions = document.createElement("div");
    const feedback = document.createElement("p");
    const connectionButton = document.createElement("button");
    const testButton = document.createElement("button");
    const editButton = document.createElement("button");
    const activateButton = document.createElement("button");
    const deleteButton = document.createElement("button");
    const label = printerHealthLabel(printer.health);
    const configuration = printer.configuration;

    card.className = "saved-printer-card";
    card.dataset.active = String(printer.active);
    card.dataset.printerId = printer.id;
    card.setAttribute("data-testid", "saved-printer-card");
    primary.className = "saved-printer-primary";
    icon.className = "saved-printer-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V4h12v5M6 18h12v2H6z"/><path d="M5 9h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z"/><path d="M17 13h.01"/></svg>';
    copy.className = "saved-printer-copy";
    name.textContent =
      configuration.transport === "windows_spooler"
        ? "Star TSP1000 über Windows"
        : "Star TSP1000 LAN";
    name.setAttribute("data-testid", "saved-printer-name");
    meta.className = "saved-printer-meta";
    const layoutLabel =
      configuration.bonLayoutProfile === "compact"
        ? "Kompakt"
        : configuration.bonLayoutProfile === "kitchen"
          ? "Küche Plus"
          : "Vollständig";
    const connectionLabel =
      configuration.transport === "windows_spooler"
        ? `Windows · ${configuration.windowsPrinterName ?? "Drucker nicht gewählt"}`
        : `${configuration.host}:${configuration.port} · ${configuration.commandMode === "star_line" ? "Star Line" : "ESC/POS"}`;
    meta.textContent = `${connectionLabel} · ${configuration.paperWidthMm} mm · ${layoutLabel}${printer.active ? " · Aktiv" : ""}`;
    meta.setAttribute("data-testid", "saved-printer-address");
    copy.append(name, meta);
    primary.append(icon, copy);

    healthContainer.className = "saved-printer-health";
    healthBadge.className = "printer-health-badge";
    healthBadge.dataset.state = label.state;
    healthBadge.textContent = label.title;
    healthBadge.setAttribute("data-testid", "saved-printer-health");
    checked.textContent = printer.health
      ? `Zuletzt geprüft: ${new Date(printer.health.checkedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
      : "Automatische Prüfung aktiv";
    healthContainer.append(healthBadge, checked);

    actions.className = "saved-printer-actions";
    connectionButton.type = "button";
    connectionButton.className = "button-secondary";
    connectionButton.textContent = "Verbindung prüfen";
    connectionButton.disabled = printerConnectionsInProgress.has(printer.id);
    connectionButton.setAttribute("data-testid", "printer-test-connection");
    connectionButton.addEventListener("click", () => {
      void checkPrinterConnection(printer.id, true);
    });
    testButton.type = "button";
    testButton.className = "button-secondary";
    testButton.textContent = printerTestsInProgress.has(printer.id)
      ? "Testbon wird gesendet …"
      : "Testbon senden";
    testButton.disabled = printerTestsInProgress.has(printer.id);
    testButton.setAttribute("data-testid", "printer-test-print");
    testButton.addEventListener("click", () => {
      void testPrinter(printer.id);
    });
    editButton.type = "button";
    editButton.className = "button-quiet";
    editButton.textContent = "Bearbeiten";
    editButton.setAttribute("data-testid", "printer-edit");
    editButton.addEventListener("click", () => openPrinterDetails(printer.id));
    activateButton.type = "button";
    activateButton.className = "button-quiet";
    activateButton.textContent = "Als aktiv verwenden";
    activateButton.hidden = printer.active;
    activateButton.setAttribute("data-testid", "printer-activate");
    activateButton.addEventListener("click", () => {
      void activatePrinter(printer.id);
    });
    deleteButton.type = "button";
    deleteButton.className = "button-danger";
    deleteButton.textContent = "Entfernen";
    deleteButton.setAttribute("data-testid", "printer-delete");
    deleteButton.addEventListener("click", () =>
      openPrinterDeleteDialog(printer.id),
    );
    actions.append(
      connectionButton,
      testButton,
      editButton,
      activateButton,
      deleteButton,
    );
    const currentFeedback = printerFeedbackById.get(printer.id);
    feedback.className = "saved-printer-feedback";
    feedback.dataset.tone = currentFeedback?.tone ?? "neutral";
    feedback.textContent = currentFeedback?.message ?? "";
    feedback.hidden = !currentFeedback;
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    feedback.setAttribute("data-testid", "saved-printer-feedback");
    card.append(primary, healthContainer, actions, feedback);
    savedPrinterList.append(card);
  }

  const editedPrinter = printers.find(
    (printer) => printer.id === editingPrinterId,
  );
  if (printerWorkspaceView === "details" && !editedPrinter) {
    editingPrinterId = null;
    printerWorkspaceView = "library";
    printerLibrary.hidden = false;
    printerDetailsCard.hidden = true;
    return;
  }
  if (editedPrinter) {
    const label = printerHealthLabel(editedPrinter.health);
    const configuration = editedPrinter.configuration;
    printerDetailsAddress.textContent = `${configuration.transport === "windows_spooler" ? configuration.windowsPrinterName : `${configuration.host}:${configuration.port}`} · ${editedPrinter.active ? "Aktiver Küchendrucker" : "Nicht aktiv"}`;
    printerDetailsHealth.textContent = label.title;
    printerDetailsHealth.dataset.state = label.state;
    printerDetailsConnectionButton.disabled = printerConnectionsInProgress.has(
      editedPrinter.id,
    );
    printerDetailsActivateButton.hidden = editedPrinter.active;
  }
}

function renderPrinterSummaryText(): void {
  const count = printerSnapshot?.printers.length ?? 0;
  printerElement.textContent =
    count === 0
      ? "Drucker noch nicht eingerichtet"
      : count === 1
        ? "1 Drucker eingerichtet"
        : `${count} Drucker eingerichtet`;
}

function runtimeLabel(kind: string): string {
  const labels: Record<string, string> = {
    stopped: "Gestoppt",
    starting: "Wird verbunden",
    ready: "Bereit",
    paused: "Pausiert",
    offline: "Keine Verbindung",
    degraded: "Eingeschränkt",
    feature_required: "Tarif prüfen",
    update_required: "Aktualisierung nötig",
    revoked: "Zugriff getrennt",
    fatal_error: "Aufmerksamkeit erforderlich",
    unpaired: "Noch nicht verbunden",
  };
  return labels[kind] ?? "Status wird geprüft";
}

function renderIntegrations(): void {
  integrationsList.replaceChildren();
  for (const integration of integrationsSnapshot) {
    const card = document.createElement("article");
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    const description = document.createElement("p");
    const state = document.createElement("span");
    const isKitchenPrinter =
      integration.capabilities.includes("printer.kitchen");
    const ready =
      integration.configured && integration.healthStatus === "ready";

    card.className = "integration-card";
    card.dataset.state = ready ? "ready" : "attention";
    copy.className = "integration-card-copy";
    title.textContent = isKitchenPrinter ? "Küchendruck" : "Lokale Integration";
    description.textContent = isKitchenPrinter
      ? integration.configured
        ? "Drucker ist auf diesem Gerät eingerichtet."
        : "Drucker kann über den Einrichtungsassistenten hinzugefügt werden."
      : "Diese Integration kann auf diesem Gerät eingerichtet werden.";
    state.className = "integration-state";
    state.textContent = ready
      ? "Bereit"
      : integration.configured
        ? "Prüfen"
        : "Einrichten";
    copy.append(title, description);
    card.append(copy, state);
    if (isKitchenPrinter) {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", "Küchendruck einrichten");
      const openPrinterLibrary = () => {
        activeBridgeTab = "printers";
        printerWorkspaceView = "library";
        renderConnectedNavigation();
        renderPrinterWorkspace();
      };
      card.addEventListener("click", openPrinterLibrary);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPrinterLibrary();
        }
      });
    }
    integrationsList.append(card);
  }
}

function renderUpdate(): void {
  const update = updateSnapshot;
  updateControls.hidden = !update || update.kind === "disabled";
  updateInstallButton.hidden = true;
  updateInstallButton.disabled = false;
  updateCheckButton.disabled = false;
  updateCheckButton.textContent = "Nach Updates suchen";
  updateInstallButton.textContent = "Aktualisieren und neu starten";
  if (!update || update.kind === "disabled") return;

  if (update.kind === "idle") {
    updateStatus.textContent = `Bridge ist aktuell (Version ${update.currentVersion}).`;
    return;
  }
  if (update.kind === "checking") {
    updateStatus.textContent = "Neue Version wird gesucht …";
    updateCheckButton.disabled = true;
    updateCheckButton.textContent = "Wird geprüft …";
    return;
  }
  if (update.kind === "downloading") {
    updateStatus.textContent = `Version ${update.version} wird geladen (${update.percent} %).`;
    updateCheckButton.disabled = true;
    updateCheckButton.textContent = "Update wird geladen …";
    return;
  }
  if (update.kind === "downloaded") {
    updateStatus.textContent = `Version ${update.version} ist bereit. Beim Neustart bleiben Restaurant, Drucker und lokale Einstellungen erhalten.`;
    updateInstallButton.hidden = false;
    return;
  }
  if (update.kind === "installing") {
    updateStatus.textContent = `Version ${update.version} wird installiert. MenüQR Bridge startet anschließend neu.`;
    updateCheckButton.disabled = true;
    updateInstallButton.hidden = false;
    updateInstallButton.disabled = true;
    updateInstallButton.textContent = "Update wird installiert …";
    return;
  }
  updateInstallButton.disabled = false;
  updateStatus.textContent =
    "Updates konnten gerade nicht geprüft werden. Bitte später erneut versuchen.";
}

function renderDevelopmentDiagnostics(): void {
  const development = developmentSnapshot;
  developmentPanel.hidden = !development?.enabled;
  if (!development?.enabled) return;
  developmentApi.textContent = development.apiBaseUrl ?? "nicht gesetzt";
  developmentHosts.textContent =
    development.verificationHosts.join(", ") || "nicht gesetzt";
  const pairing = pairingSnapshot;
  const pairingError =
    pairing?.kind === "denied" ||
    pairing?.kind === "expired" ||
    pairing?.kind === "network_error" ||
    pairing?.kind === "secure_storage_unavailable" ||
    pairing?.kind === "secure_storage_corrupt"
      ? pairing.message
      : null;
  developmentPairingError.hidden = !pairingError;
  developmentPairingError.textContent = pairingError
    ? `Letzter Pairing-Fehler: ${pairingError}`
    : "";
}

function renderSetupSummary(): void {
  const paired = isPaired();
  const configured = printerSnapshot?.configured === true;
  const runtimeReady = deviceRuntimeSnapshot?.kind === "ready";

  document.body.dataset.setupMode = paired
    ? "connected"
    : pairingSnapshot?.kind === "waiting_for_approval" ||
        pairingSnapshot?.kind === "slow_down"
      ? "pairing"
      : "first-run";
  renderConnectedNavigation();

  pairingCard.dataset.state = paired ? "complete" : "current";
  printerSetupCard.dataset.state = configured ? "complete" : "current";

  setStepState("pairing", paired ? "done" : "current");
  setStepState("printer", configured ? "done" : "current");
  setStepState(
    "ready",
    runtimeReady ? "done" : paired && configured ? "current" : "upcoming",
  );

  printerFieldset.disabled = false;
  printerDiscoveryButton.disabled =
    discoveryInProgress || printerTypeSelect.value !== "star-tsp1000-lan";
  printerDiscoveryTestButton.disabled =
    !selectedDiscoveredPrinter() || discoveryTestInProgress;
  printerDiscoveryConfirmButton.disabled =
    !selectedDiscoveredPrinter() || !discoveryTestSucceeded;
  printerSaveButton.disabled = false;
  renderPrinterWorkspace();

  if (!paired && !configured) {
    setFoundationStatus("Einrichtung offen", "attention");
    onboardingTitle.textContent = "Willkommen bei MenüQR Bridge";
    onboardingDescription.textContent =
      "Erstellen Sie zuerst Ihr Restaurant. Danach verbinden Sie dieses Gerät und richten Ihren Küchendrucker ein.";
    serviceStatus.dataset.state = "neutral";
    serviceStatusCopy.textContent =
      "Nach beiden Schritten empfängt Bridge Küchenbons automatisch im Hintergrund.";
    return;
  }

  if (!paired) {
    setFoundationStatus("Restaurant verbinden", "attention");
    onboardingTitle.textContent = "Drucker eingerichtet – Restaurant verbinden";
    onboardingDescription.textContent =
      "Der lokale Drucker ist gespeichert. Verbinden Sie jetzt dieses Windows-Gerät mit Ihrem Restaurant.";
    serviceStatus.dataset.state = "attention";
    serviceStatusCopy.textContent =
      "Bridge startet den Hintergrundbetrieb, sobald die Restaurantverbindung bestätigt ist.";
    return;
  }

  if (!configured) {
    setFoundationStatus("Drucker einrichten", "attention");
    onboardingTitle.textContent = "Fast geschafft: Küchendrucker auswählen";
    onboardingDescription.textContent =
      "Suchen Sie jetzt nach Ihrem Drucker, drucken Sie den Bestätigungsbon und bestätigen Sie das richtige Gerät.";
    serviceStatus.dataset.state = "attention";
    serviceStatusCopy.textContent =
      "Der Drucker wird erst nach Ihrer Bestätigung auf diesem Gerät gespeichert.";
    return;
  }

  if (runtimeReady) {
    setFoundationStatus("Bereit für Bestellungen", "success");
    onboardingTitle.textContent = "Ihre Küche ist bereit";
    onboardingDescription.textContent =
      "MenüQR Bridge läuft im Hintergrund und sendet neue Küchenbons an den bestätigten Drucker.";
    serviceStatus.dataset.state = "success";
    serviceStatusCopy.textContent =
      "Dieses Gerät empfängt Bestellungen automatisch, solange es eingeschaltet ist.";
    return;
  }

  setFoundationStatus("Einrichtung abschließen", "attention");
  onboardingTitle.textContent =
    "Drucker eingerichtet – Verbindung wird vorbereitet";
  onboardingDescription.textContent =
    "Bridge aktiviert den Hintergrundbetrieb automatisch, sobald die Verbindung bereit ist.";
  serviceStatus.dataset.state = "attention";
  serviceStatusCopy.textContent =
    "Prüfen Sie bei Bedarf die Verbindung in den manuellen Druckereinstellungen.";
}

function renderPairing(): void {
  const pairing = pairingSnapshot;
  pairingCodeElement.hidden = true;
  heroPairingCard.hidden = true;
  clearPairingCountdown();
  heroPairingButton.disabled = false;
  heroPairingButton.textContent = "Mit Restaurant verbinden";
  restaurantProfile.hidden = pairing?.kind !== "paired";

  if (pairing?.kind === "paired") {
    restaurantProfileName.textContent =
      pairing.credential.restaurant.displayName;
    pairingElement.textContent = `Verbunden mit ${pairing.credential.restaurant.displayName}.`;
    pairingButton.textContent = "Dieses Gerät trennen";
    pairingButton.disabled = false;
    renderConnectedNavigation();
    return;
  }

  restaurantProfileName.textContent = "";
  renderConnectedNavigation();

  if (
    pairing?.kind === "waiting_for_approval" ||
    pairing?.kind === "slow_down"
  ) {
    const expiresAt = new Date(pairing.expiresAt).toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    });
    pairingElement.textContent = `Bestätigen Sie diesen Code bis ${expiresAt} im geöffneten Browser.`;
    pairingCodeElement.textContent = pairing.userCode;
    pairingCodeElement.hidden = false;
    heroPairingCode.textContent = pairing.userCode;
    startPairingCountdown(pairing.expiresAt);
    heroPairingCard.hidden = false;
    heroPairingButton.textContent = "Neuen Code anfordern";
    heroPairingButton.disabled = false;
    pairingButton.textContent = "Bestätigung wird erwartet";
    pairingButton.disabled = true;
    return;
  }

  if (
    pairing?.kind === "denied" ||
    pairing?.kind === "expired" ||
    pairing?.kind === "network_error" ||
    pairing?.kind === "secure_storage_unavailable" ||
    pairing?.kind === "secure_storage_corrupt"
  ) {
    const messages: Record<typeof pairing.kind, string> = {
      denied: "Dieses Gerät wurde im Browser nicht bestätigt.",
      expired:
        "Der Bestätigungscode ist abgelaufen. Starten Sie die Verbindung erneut.",
      network_error:
        "MenüQR ist gerade nicht erreichbar. Prüfen Sie die Internetverbindung und versuchen Sie es erneut.",
      secure_storage_unavailable:
        "Windows kann die lokalen Zugangsdaten gerade nicht sicher speichern. Starten Sie Bridge erneut.",
      secure_storage_corrupt:
        "Die lokalen Zugangsdaten können nicht gelesen werden. Trennen Sie dieses Gerät und verbinden Sie es erneut.",
    };
    pairingElement.textContent = messages[pairing.kind];
    pairingButton.textContent = "Erneut verbinden";
    pairingButton.disabled = false;
    return;
  }

  pairingElement.textContent =
    "Dieses Windows-Gerät ist noch keinem Restaurant zugeordnet.";
  pairingButton.textContent = "Restaurant verbinden";
  pairingButton.disabled = pairing?.kind === "requesting_code";
}

function renderPrinterDiscovery(): void {
  const selected = selectedDiscoveredPrinter();
  printerCandidatesElement.replaceChildren();

  if (discoveryConfirmed && selected) {
    printerDiscoveryElement.textContent =
      "Drucker bestätigt und sicher auf diesem Windows-Gerät gespeichert.";
  } else if (!printerDiscovery) {
    printerDiscoveryElement.textContent =
      "Bridge sucht nur nach erreichbaren Druckern in Ihrem lokalen Netzwerk. Eine IP-Adresse ist meistens nicht nötig.";
  } else if (printerDiscovery.candidates.length === 0) {
    printerDiscoveryElement.textContent =
      "Kein erreichbarer Drucker gefunden. Sie können die Adresse unten manuell eingeben.";
  } else if (selected) {
    printerDiscoveryElement.textContent = `Ausgewählt: ${selected.displayName}. Drucken Sie jetzt den Bestätigungsbon.`;
  } else {
    printerDiscoveryElement.textContent =
      "Mehrere Drucker gefunden. Wählen Sie den Drucker Ihrer Küche aus.";
  }

  for (const candidate of printerDiscovery?.candidates ?? []) {
    const button = document.createElement("button");
    const name = document.createElement("span");
    const address = document.createElement("span");
    const selectedCandidate =
      candidate.id === printerDiscovery?.selectedCandidateId;
    button.type = "button";
    button.className = "printer-candidate";
    button.setAttribute("aria-pressed", String(selectedCandidate));
    button.disabled = discoveryInProgress || discoveryTestInProgress;
    name.textContent = selectedCandidate
      ? `${candidate.displayName} · ausgewählt`
      : candidate.displayName;
    address.className = "candidate-address";
    address.textContent = `${candidate.host}:${candidate.port}`;
    button.append(name, address);
    button.addEventListener("click", () => {
      void window.menuqrBridge
        .selectDiscoveredPrinter(candidate.id)
        .then((discovery) => {
          printerDiscovery = discovery;
          discoveryTestSucceeded = false;
          discoveryConfirmed = false;
          renderPrinterDiscovery();
          renderSetupSummary();
        })
        .catch(() => {
          printerDiscoveryElement.textContent =
            "Dieser Drucker ist nicht mehr erreichbar. Starten Sie die Suche erneut.";
        });
    });
    printerCandidatesElement.append(button);
  }
}

function printerFormData(
  form: HTMLFormElement = printerForm,
): PrinterFormConfiguration {
  const value = new FormData(form);
  const transport = String(value.get("transport") ?? "raw_tcp") as
    | "raw_tcp"
    | "windows_spooler";
  return {
    transport,
    windowsPrinterName:
      transport === "windows_spooler"
        ? String(value.get("windowsPrinterName") ?? "").trim()
        : null,
    host: String(value.get("host") ?? ""),
    port: Number(value.get("port") ?? 9100),
    commandMode: String(value.get("commandMode") ?? "star_line") as
      | "star_line"
      | "esc_pos",
    paperWidthMm: Number(value.get("paperWidthMm") ?? 80) as 80 | 82,
    encoding: String(value.get("encoding") ?? "cp437") as
      | "cp437"
      | "cp850"
      | "windows1252",
    connectTimeoutMs: Number(value.get("connectTimeoutMs") ?? 3000),
    writeTimeoutMs: Number(value.get("writeTimeoutMs") ?? 5000),
    cutAfterPrint: value.get("cutAfterPrint") === "on",
    bonLayoutProfile: String(
      value.get("bonLayoutProfile") ?? selectedSetupBonLayout(),
    ) as "compact" | "kitchen" | "detailed",
  };
}

function selectedSetupBonLayout(): "compact" | "kitchen" | "detailed" {
  const selected = document.querySelector<HTMLInputElement>(
    "input[name='setupBonLayoutProfile']:checked",
  )?.value;
  return selected === "kitchen" || selected === "detailed"
    ? selected
    : "compact";
}

function fillPrinterForm(
  configuration: PrinterFormConfiguration,
  form: HTMLFormElement = printerForm,
): void {
  populateWindowsPrinterSelect(form, configuration.windowsPrinterName);
  for (const [name, value] of Object.entries(configuration)) {
    const radioFields = form.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${name}"]`,
    );
    if (radioFields.length > 0) {
      radioFields.forEach((field) => {
        field.checked = field.value === String(value);
      });
      continue;
    }
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement && field.type === "checkbox") {
      field.checked = value === true;
    } else if (
      value !== null &&
      (field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement)
    ) {
      field.value = String(value);
    }
  }
  syncPrinterTransportFields(form);
}

function populateWindowsPrinterSelect(
  form: HTMLFormElement,
  selected: string | null = null,
): void {
  const select = form.elements.namedItem("windowsPrinterName");
  if (!(select instanceof HTMLSelectElement)) return;
  select.replaceChildren();
  if (windowsPrinters.length === 0) {
    const option = document.createElement("option");
    option.value = selected ?? "";
    option.textContent =
      selected ?? "Keine installierten Windows-Drucker gefunden";
    select.append(option);
  } else {
    for (const printer of windowsPrinters) {
      const option = document.createElement("option");
      option.value = printer.name;
      option.textContent = printer.name;
      select.append(option);
    }
    if (
      selected &&
      !windowsPrinters.some((printer) => printer.name === selected)
    ) {
      const option = document.createElement("option");
      option.value = selected;
      option.textContent = `${selected} (derzeit nicht verfügbar)`;
      select.prepend(option);
    }
  }
  select.value = selected ?? windowsPrinters[0]?.name ?? "";
}

function syncPrinterTransportFields(form: HTMLFormElement): void {
  const transport = form.elements.namedItem("transport");
  if (!(transport instanceof HTMLSelectElement)) return;
  const useWindows = transport.value === "windows_spooler";
  form
    .querySelectorAll<HTMLElement>("[data-transport-field='network']")
    .forEach((element) => {
      element.hidden = useWindows;
      element
        .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          "input, select",
        )
        .forEach((control) => {
          control.disabled = useWindows;
        });
    });
  form
    .querySelectorAll<HTMLElement>("[data-transport-field='windows']")
    .forEach((element) => {
      element.hidden = !useWindows;
      element
        .querySelectorAll<HTMLSelectElement>("select")
        .forEach((control) => {
          control.disabled = !useWindows;
          control.required = useWindows;
        });
    });
}

async function refreshWindowsPrinters(): Promise<void> {
  try {
    windowsPrinters = await window.menuqrBridge.listWindowsPrinters();
  } catch {
    windowsPrinters = [];
  }
  populateWindowsPrinterSelect(printerForm);
  populateWindowsPrinterSelect(
    printerDetailsForm,
    printerSnapshot?.printers.find((printer) => printer.id === editingPrinterId)
      ?.configuration.windowsPrinterName ?? null,
  );
}

async function refreshFoundation(): Promise<void> {
  foundationSnapshot = await window.menuqrBridge.getRuntimeSnapshot();
  renderSetupSummary();
}

async function refreshPrinter(): Promise<void> {
  printerSnapshot = await window.menuqrBridge.getPrinterSnapshot();
  renderPrinterSummaryText();
  renderSetupSummary();
}

async function checkPrinterConnection(
  printerId: string,
  showGlobalFeedback: boolean,
): Promise<PrinterHealth | null> {
  if (
    !printerSnapshot?.printers.some((printer) => printer.id === printerId) ||
    printerConnectionsInProgress.has(printerId)
  )
    return null;
  printerConnectionsInProgress.add(printerId);
  renderPrinterWorkspace();
  try {
    const health = await window.menuqrBridge.testPrinterConnection(printerId);
    printerSnapshot = {
      ...printerSnapshot,
      health:
        printerSnapshot.activePrinterId === printerId
          ? health
          : printerSnapshot.health,
      printers: printerSnapshot.printers.map((printer) =>
        printer.id === printerId ? { ...printer, health } : printer,
      ),
    };
    const label = printerHealthLabel(health);
    if (showGlobalFeedback) {
      printerFeedbackById.set(printerId, {
        message: label.detail,
        tone: label.state === "success" ? "success" : "attention",
      });
    }
    renderPrinterWorkspace();
    void refreshIntegrations().catch(() => undefined);
    return health;
  } catch {
    if (showGlobalFeedback) {
      printerFeedbackById.set(printerId, {
        message: "Die Verbindung zu diesem Drucker konnte nicht geprüft werden.",
        tone: "attention",
      });
    }
    return null;
  } finally {
    printerConnectionsInProgress.delete(printerId);
    renderPrinterWorkspace();
  }
}

function checkAllPrinterConnections(): void {
  for (const printer of printerSnapshot?.printers ?? []) {
    void checkPrinterConnection(printer.id, false);
  }
}

async function activatePrinter(printerId: string): Promise<void> {
  printerSnapshot =
    await window.menuqrBridge.activatePrinterConfiguration(printerId);
  renderPrinterSummaryText();
  renderSetupSummary();
  void refreshDeviceRuntime().catch(() => undefined);
  void refreshIntegrations().catch(() => undefined);
}

async function testPrinter(printerId: string): Promise<void> {
  if (printerTestsInProgress.has(printerId)) return;
  printerTestsInProgress.add(printerId);
  printerFeedbackById.set(printerId, {
    message: "Testbon wird vollständig an den Drucker übertragen …",
    tone: "neutral",
  });
  renderPrinterWorkspace();
  try {
    const result = await window.menuqrBridge.testPrinterPrint(printerId);
    printerFeedbackById.set(printerId, {
      message:
        result.status === "succeeded"
          ? result.code === "WINDOWS_PRINT_JOB_ACCEPTED"
            ? "Windows hat den Testbon in die Druckerwarteschlange übernommen."
            : "Der Testbon wurde vollständig an den Drucker übertragen."
          : "Der Testbon konnte nicht vollständig übertragen werden.",
      tone: result.status === "succeeded" ? "success" : "attention",
    });
    await refreshPrinter();
  } catch {
    printerFeedbackById.set(printerId, {
      message: "Der Testbon konnte nicht gestartet werden.",
      tone: "attention",
    });
  } finally {
    printerTestsInProgress.delete(printerId);
    renderPrinterWorkspace();
  }
}

async function refreshDeviceRuntime(): Promise<void> {
  deviceRuntimeSnapshot = await window.menuqrBridge.getDeviceRuntimeSnapshot();
  runtimeElement.textContent = `Bridge: ${runtimeLabel(deviceRuntimeSnapshot.kind)}`;
  renderSetupSummary();
}

async function refreshIntegrations(): Promise<void> {
  integrationsSnapshot = await window.menuqrBridge.getIntegrationsSnapshot();
  renderIntegrations();
}

async function refreshUpdate(): Promise<void> {
  updateSnapshot = await window.menuqrBridge.getUpdateSnapshot();
  renderUpdate();
}

async function refreshDevelopmentDiagnostics(): Promise<void> {
  developmentSnapshot = await window.menuqrBridge.getDevelopmentSnapshot();
  renderDevelopmentDiagnostics();
}

async function refreshShell(): Promise<void> {
  shellSnapshot = await window.menuqrBridge.getShellSnapshot();
  shellElement.textContent = shellSnapshot.autostartEnabled
    ? "Bridge startet automatisch mit Windows."
    : "Bridge startet nicht automatisch mit Windows.";
  pauseButton.textContent =
    shellSnapshot.runtime.kind === "paused"
      ? "Bridge fortsetzen"
      : "Bridge pausieren";
  autostartButton.textContent = shellSnapshot.autostartEnabled
    ? "Autostart ausschalten"
    : "Mit Windows starten";
}

async function refreshPairing(): Promise<void> {
  if (pairingRefreshTimer !== null) {
    window.clearTimeout(pairingRefreshTimer);
    pairingRefreshTimer = null;
  }
  pairingSnapshot = await window.menuqrBridge.getPairingSnapshot();
  renderPairing();
  renderDevelopmentDiagnostics();
  renderPrinterDiscovery();
  renderSetupSummary();
  if (
    pairingSnapshot.kind === "waiting_for_approval" ||
    pairingSnapshot.kind === "slow_down"
  ) {
    pairingRefreshTimer = window.setTimeout(
      () => void refreshPairing().catch(showPairingUnavailable),
      pairingSnapshot.pollingIntervalSeconds * 1_000,
    );
  }
}

function showPairingUnavailable(): void {
  pairingElement.textContent =
    "Der Status der Verbindung ist gerade nicht verfügbar. Bitte versuchen Sie es erneut.";
}

function showPrinterUnavailable(): void {
  printerElement.textContent = "Druckerstatus ist gerade nicht verfügbar.";
  serviceStatus.dataset.state = "attention";
}

void refreshFoundation().catch(() => {
  setFoundationStatus("Status nicht verfügbar", "danger");
});
void refreshShell().catch(() => {
  shellElement.textContent =
    "Windows-Einstellungen sind gerade nicht verfügbar.";
});
void refreshPairing().catch(showPairingUnavailable);
void refreshDeviceRuntime().catch(() => {
  runtimeElement.textContent = "Bridge-Status ist gerade nicht verfügbar.";
});
void refreshPrinter().catch(showPrinterUnavailable);
void refreshWindowsPrinters().catch(() => undefined);
void refreshIntegrations().catch(() => {
  integrationsList.replaceChildren();
});
void refreshUpdate().catch(() => {
  updateControls.hidden = true;
});
void refreshDevelopmentDiagnostics().catch(() => {
  developmentPanel.hidden = true;
});
renderPrinterDiscovery();
for (const form of [printerForm, printerDetailsForm]) {
  const transport = form.elements.namedItem("transport");
  if (transport instanceof HTMLSelectElement) {
    transport.addEventListener("change", () =>
      syncPrinterTransportFields(form),
    );
  }
  populateWindowsPrinterSelect(form);
  syncPrinterTransportFields(form);
}
window.setInterval(() => {
  void refreshDeviceRuntime().catch(() => undefined);
  void refreshPrinter().catch(() => undefined);
  void refreshUpdate().catch(() => undefined);
}, 3_000);

pauseButton.addEventListener("click", () => {
  void window.menuqrBridge
    .getShellSnapshot()
    .then((shell) =>
      window.menuqrBridge.setPaused(shell.runtime.kind !== "paused"),
    )
    .then(refreshShell)
    .then(refreshDeviceRuntime)
    .catch(() => {
      shellElement.textContent = "Die Bridge konnte nicht aktualisiert werden.";
    });
});

autostartButton.addEventListener("click", () => {
  void window.menuqrBridge
    .getShellSnapshot()
    .then((shell) => window.menuqrBridge.setAutostart(!shell.autostartEnabled))
    .then(refreshShell)
    .catch(() => {
      shellElement.textContent =
        "Der Windows-Autostart konnte nicht geändert werden.";
    });
});

pairingButton.addEventListener("click", () => {
  void (async () => {
    const pairing = await window.menuqrBridge.getPairingSnapshot();
    if (pairing.kind === "paired") {
      if (
        !window.confirm(
          "Dieses Windows-Gerät wirklich von MenüQR trennen? Der lokale Drucker bleibt gespeichert.",
        )
      )
        return;
      await window.menuqrBridge.disconnect();
    } else {
      pairingButton.disabled = true;
      pairingButton.textContent = "Code wird erstellt";
      const nextPairing = await window.menuqrBridge.beginPairing();
      await refreshPairing();
      if (
        nextPairing.kind === "waiting_for_approval" ||
        nextPairing.kind === "slow_down"
      ) {
        try {
          await window.menuqrBridge.openPairingBrowser();
          heroPairingOpenButton.textContent = "Browser geöffnet";
        } catch {
          heroPairingOpenButton.textContent = "Browser öffnen";
          heroPairingOpenButton.disabled = false;
        }
      }
    }
    if (pairing.kind === "paired") await refreshPairing();
    await refreshDeviceRuntime();
  })().catch(() => {
    pairingButton.disabled = false;
    showPairingUnavailable();
  });
});

heroPairingButton.addEventListener("click", () => pairingButton.click());
mainTab.addEventListener("click", () => {
  activeBridgeTab = "main";
  renderConnectedNavigation();
});
printersTab.addEventListener("click", () => {
  activeBridgeTab = "printers";
  renderConnectedNavigation();
  printerWorkspaceView = "library";
  renderPrinterWorkspace();
});
settingsTab.addEventListener("click", () => {
  activeBridgeTab = "settings";
  renderConnectedNavigation();
});
function openPrinterSetup(): void {
  editingPrinterId = null;
  printerForm.reset();
  populateWindowsPrinterSelect(printerForm);
  syncPrinterTransportFields(printerForm);
  void refreshWindowsPrinters().catch(() => undefined);
  manualPrinterSettings.open = false;
  printerTypeSelect.value = "";
  printerSetupTitle.textContent = "Küchendrucker hinzufügen";
  discoveryTestSucceeded = false;
  discoveryConfirmed = false;
  printerDiscovery = null;
  printerWorkspaceView = "setup";
  renderPrinterDiscovery();
  renderPrinterWorkspace();
}
function openPrinterDetails(printerId: string): void {
  const printer = printerSnapshot?.printers.find(
    (candidate) => candidate.id === printerId,
  );
  if (!printer) return;
  editingPrinterId = printerId;
  fillPrinterForm(printer.configuration, printerDetailsForm);
  void refreshWindowsPrinters().then(() => {
    populateWindowsPrinterSelect(
      printerDetailsForm,
      printer.configuration.windowsPrinterName,
    );
    syncPrinterTransportFields(printerDetailsForm);
  });
  printerDetailsStatus.dataset.tone = "neutral";
  printerDetailsStatus.textContent =
    "Änderungen gelten nur für diesen Drucker.";
  printerWorkspaceView = "details";
  renderPrinterWorkspace();
}
printerAddButton.addEventListener("click", openPrinterSetup);
printerAddAnotherButton.addEventListener("click", openPrinterSetup);
printerSetupBackButton.addEventListener("click", () => {
  editingPrinterId = null;
  printerWorkspaceView = "library";
  renderPrinterWorkspace();
});
printerDetailsBackButton.addEventListener("click", () => {
  editingPrinterId = null;
  printerWorkspaceView = "library";
  renderPrinterWorkspace();
});
function closePrinterDeleteDialog(): void {
  if (printerDeleteDialog.open) printerDeleteDialog.close();
  pendingDeletePrinterId = null;
}
function openPrinterDeleteDialog(printerId: string): void {
  const printer = printerSnapshot?.printers.find(
    (candidate) => candidate.id === printerId,
  );
  if (!printer) return;
  pendingDeletePrinterId = printerId;
  const connection =
    printer.configuration.transport === "windows_spooler"
      ? printer.configuration.windowsPrinterName
      : `${printer.configuration.host}:${printer.configuration.port}`;
  printerDeleteCopy.textContent = `Star TSP1000 (${connection}) wird nur von diesem Computer entfernt.`;
  printerDeleteDialog.showModal();
}
printerDeleteCancelButton.addEventListener("click", closePrinterDeleteDialog);
printerDeleteCloseButton.addEventListener("click", closePrinterDeleteDialog);
printerDeleteConfirmButton.addEventListener("click", () => {
  const printerId = pendingDeletePrinterId;
  if (!printerId) return;
  printerDeleteConfirmButton.disabled = true;
  void window.menuqrBridge
    .deletePrinterConfiguration(printerId)
    .then((snapshot) => {
      printerSnapshot = snapshot;
      if (editingPrinterId === printerId) {
        editingPrinterId = null;
        printerWorkspaceView = "library";
      }
      closePrinterDeleteDialog();
      renderPrinterSummaryText();
      renderSetupSummary();
      void refreshDeviceRuntime().catch(() => undefined);
      void refreshIntegrations().catch(() => undefined);
    })
    .catch(() => {
      printerDeleteCopy.textContent =
        "Der Drucker konnte nicht entfernt werden. Bitte versuchen Sie es erneut.";
    })
    .finally(() => {
      printerDeleteConfirmButton.disabled = false;
    });
});
printerDetailsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const printerId = editingPrinterId;
  if (!printerId) return;
  printerDetailsStatus.dataset.tone = "neutral";
  printerDetailsStatus.textContent = "Änderungen werden gespeichert …";
  void window.menuqrBridge
    .savePrinterConfiguration(printerFormData(printerDetailsForm), printerId)
    .then((snapshot) => {
      printerSnapshot = snapshot;
      printerDetailsStatus.dataset.tone = "success";
      printerDetailsStatus.textContent = "Änderungen gespeichert.";
      renderPrinterWorkspace();
      void refreshDeviceRuntime().catch(() => undefined);
      void refreshIntegrations().catch(() => undefined);
    })
    .catch(() => {
      printerDetailsStatus.dataset.tone = "attention";
      printerDetailsStatus.textContent =
        "Die Einstellungen sind ungültig. Prüfen Sie den gewählten Druckweg.";
    });
});
printerDetailsConnectionButton.addEventListener("click", () => {
  const printerId = editingPrinterId;
  if (!printerId) return;
  printerDetailsStatus.dataset.tone = "neutral";
  printerDetailsStatus.textContent = "Verbindung wird geprüft …";
  void checkPrinterConnection(printerId, false).then((health) => {
    if (!health) {
      printerDetailsStatus.dataset.tone = "attention";
      printerDetailsStatus.textContent =
        "Die Verbindung konnte nicht geprüft werden.";
      return;
    }
    const label = printerHealthLabel(health);
    printerDetailsStatus.dataset.tone = label.state;
    printerDetailsStatus.textContent = label.detail;
  });
});
printerDetailsTestButton.addEventListener("click", () => {
  const printerId = editingPrinterId;
  if (!printerId) return;
  printerDetailsTestButton.disabled = true;
  printerDetailsStatus.dataset.tone = "neutral";
  printerDetailsStatus.textContent = "Testbon wird gesendet …";
  void window.menuqrBridge
    .testPrinterPrint(printerId)
    .then((result) => {
      printerDetailsStatus.dataset.tone =
        result.status === "succeeded" ? "success" : "attention";
      printerDetailsStatus.textContent =
        result.status === "succeeded"
          ? result.code === "WINDOWS_PRINT_JOB_ACCEPTED"
            ? "Windows hat den Testbon in die Druckerwarteschlange übernommen."
            : "Der Testbon wurde an diesen Drucker gesendet."
          : "Der Testbon konnte nicht gedruckt werden.";
      void refreshPrinter().catch(() => undefined);
    })
    .catch(() => {
      printerDetailsStatus.dataset.tone = "attention";
      printerDetailsStatus.textContent =
        "Der Testbon konnte nicht gestartet werden.";
    })
    .finally(() => {
      printerDetailsTestButton.disabled = false;
    });
});
printerDetailsActivateButton.addEventListener("click", () => {
  const printerId = editingPrinterId;
  if (!printerId) return;
  void activatePrinter(printerId)
    .then(() => {
      printerDetailsStatus.dataset.tone = "success";
      printerDetailsStatus.textContent =
        "Dieser Drucker ist jetzt für Küchenbestellungen aktiv.";
    })
    .catch(() => {
      printerDetailsStatus.dataset.tone = "attention";
      printerDetailsStatus.textContent =
        "Der aktive Drucker konnte nicht geändert werden.";
    });
});
printerDetailsDeleteButton.addEventListener("click", () => {
  if (editingPrinterId) openPrinterDeleteDialog(editingPrinterId);
});
printerTypeSelect.addEventListener("change", renderSetupSummary);
printerRequestToggleButton.addEventListener("click", () => {
  if (!printerRequestDialog.open) printerRequestDialog.showModal();
  printerRequestStatus.hidden = true;
  printerRequestModel.focus();
});
function closePrinterRequestDialog(): void {
  printerRequestDialog.close();
  printerRequestForm.reset();
  printerRequestStatus.hidden = true;
}
printerRequestCancelButton.addEventListener("click", closePrinterRequestDialog);
printerRequestCloseButton.addEventListener("click", closePrinterRequestDialog);
printerRequestDialog.addEventListener("close", () => {
  if (!printerRequestToggleButton.disabled) {
    printerRequestForm.reset();
    printerRequestStatus.hidden = true;
  }
});
printerRequestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(printerRequestForm);
  const model = String(formData.get("model") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (model.length < 2) {
    printerRequestModel.focus();
    return;
  }
  printerRequestSubmitButton.disabled = true;
  printerRequestStatus.hidden = false;
  printerRequestStatus.dataset.tone = "neutral";
  printerRequestStatus.textContent = "Anfrage wird gesendet …";
  void window.menuqrBridge
    .requestPrinterSupport(note ? { model, note } : { model })
    .then(() => {
      printerRequestForm.hidden = true;
      printerRequestToggleButton.disabled = true;
      printerRequestToggleButton.textContent = "Anfrage gesendet";
      printerRequestStatus.dataset.tone = "success";
      printerRequestStatus.textContent =
        "Danke. Wir prüfen dieses Modell und melden uns bei Bedarf.";
    })
    .catch(() => {
      printerRequestStatus.dataset.tone = "attention";
      printerRequestStatus.textContent =
        "Die Anfrage konnte gerade nicht gesendet werden. Bitte später erneut versuchen.";
      printerRequestSubmitButton.disabled = false;
    });
});
heroPairingOpenButton.addEventListener("click", () => {
  heroPairingOpenButton.disabled = true;
  void window.menuqrBridge
    .openPairingBrowser()
    .then(() => {
      heroPairingOpenButton.textContent = "Browser geöffnet";
    })
    .catch(() => {
      heroPairingOpenButton.textContent = "Browser erneut öffnen";
      heroPairingOpenButton.disabled = false;
    });
});

printerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void window.menuqrBridge
    .savePrinterConfiguration(printerFormData(), editingPrinterId ?? undefined)
    .then((snapshot) => {
      printerSnapshot = snapshot;
      editingPrinterId = null;
      printerWorkspaceView = snapshot.configured ? "library" : "setup";
      renderPrinterSummaryText();
      renderSetupSummary();
      checkAllPrinterConnections();
      void refreshDeviceRuntime().catch(() => undefined);
      void refreshIntegrations().catch(() => undefined);
    })
    .catch(() => {
      printerElement.textContent =
        "Die Druckereinstellung ist ungültig. Prüfen Sie den gewählten Druckweg.";
      serviceStatus.dataset.state = "attention";
    });
});

printerDiscoveryButton.addEventListener("click", () => {
  discoveryInProgress = true;
  discoveryTestSucceeded = false;
  discoveryConfirmed = false;
  renderSetupSummary();
  printerDiscoveryElement.textContent =
    "Lokales Netzwerk wird nach Druckern durchsucht …";
  void window.menuqrBridge
    .discoverPrinters()
    .then((discovery) => {
      printerDiscovery = discovery;
    })
    .catch(() => {
      printerDiscovery = null;
      printerDiscoveryElement.textContent =
        "Die Druckersuche konnte nicht gestartet werden. Nutzen Sie bei Bedarf die manuelle Einrichtung.";
    })
    .finally(() => {
      discoveryInProgress = false;
      renderPrinterDiscovery();
      renderSetupSummary();
    });
});

printerDiscoveryTestButton.addEventListener("click", () => {
  discoveryTestInProgress = true;
  renderSetupSummary();
  printerDiscoveryElement.textContent = "Bestätigungsbon wird gedruckt …";
  void window.menuqrBridge
    .testDiscoveredPrinter()
    .then((result) => {
      discoveryTestSucceeded = result.status === "succeeded";
      printerDiscoveryElement.textContent = discoveryTestSucceeded
        ? "Auf dem Bon steht „DIESER DRUCKER“. Wenn er am richtigen Gerät herauskam, bestätigen Sie ihn jetzt."
        : "Der Bestätigungsbon konnte nicht gedruckt werden. Prüfen Sie den ausgewählten Drucker.";
    })
    .catch(() => {
      discoveryTestSucceeded = false;
      printerDiscoveryElement.textContent =
        "Der Bestätigungsbon konnte nicht gedruckt werden. Prüfen Sie den ausgewählten Drucker.";
    })
    .finally(() => {
      discoveryTestInProgress = false;
      renderSetupSummary();
    });
});

printerDiscoveryConfirmButton.addEventListener("click", () => {
  printerDiscoveryConfirmButton.disabled = true;
  void window.menuqrBridge
    .confirmDiscoveredPrinter(
      selectedSetupBonLayout(),
      editingPrinterId ?? undefined,
    )
    .then((snapshot) => {
      printerSnapshot = snapshot;
      discoveryConfirmed = snapshot.configuration !== null;
      discoveryTestSucceeded = false;
      editingPrinterId = null;
      printerWorkspaceView = discoveryConfirmed ? "library" : "setup";
      renderPrinterSummaryText();
      renderPrinterDiscovery();
      renderSetupSummary();
      void refreshDeviceRuntime().catch(() => undefined);
      void refreshIntegrations().catch(() => undefined);
    })
    .catch(() => {
      printerDiscoveryElement.textContent =
        "Drucken Sie zuerst den Bestätigungsbon und wählen Sie dann den richtigen Drucker aus.";
    })
    .finally(() => {
      renderSetupSummary();
    });
});

diagnosticsButton.addEventListener("click", () => {
  diagnosticsButton.disabled = true;
  diagnosticsButton.textContent = "Protokoll wird vorbereitet …";
  diagnosticsStatus.textContent = "Bitte wählen Sie einen Speicherort.";
  void window.menuqrBridge
    .exportDiagnostics()
    .then((result) => {
      diagnosticsStatus.textContent =
        result.status === "saved"
          ? `Diagnoseprotokoll gespeichert: ${result.fileName}`
          : "Speichern wurde abgebrochen.";
    })
    .catch(() => {
      diagnosticsStatus.textContent =
        "Die Diagnose konnte nicht gespeichert werden.";
    })
    .finally(() => {
      diagnosticsButton.disabled = false;
      diagnosticsButton.textContent = "Diagnoseprotokoll herunterladen";
    });
});

updateCheckButton.addEventListener("click", () => {
  updateCheckButton.disabled = true;
  void window.menuqrBridge
    .checkForUpdates()
    .then((snapshot) => {
      updateSnapshot = snapshot;
      renderUpdate();
    })
    .catch(() => {
      updateSnapshot = updateSnapshot
        ? {
            kind: "error",
            currentVersion: updateSnapshot.currentVersion,
            code: "CHECK_FAILED",
          }
        : null;
      renderUpdate();
    });
});

updateInstallButton.addEventListener("click", () => {
  updateInstallButton.disabled = true;
  void window.menuqrBridge.installUpdate().then((started) => {
    if (!started) {
      updateInstallButton.disabled = false;
      void refreshUpdate().catch(() => undefined);
    }
  });
});
