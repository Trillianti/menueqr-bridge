import { contextBridge, ipcRenderer } from "electron";

const getRuntimeSnapshotChannel =
  "bridge:foundation:get-runtime-snapshot" as const;
const getShellSnapshotChannel = "bridge:shell:get-snapshot" as const;
const showSettingsChannel = "bridge:shell:show-settings" as const;
const setAutostartChannel = "bridge:shell:set-autostart" as const;
const setPausedChannel = "bridge:shell:set-paused" as const;
const getPairingSnapshotChannel = "bridge:pairing:get-snapshot" as const;
const beginPairingChannel = "bridge:pairing:begin" as const;
const openPairingBrowserChannel = "bridge:pairing:open-browser" as const;
const disconnectChannel = "bridge:pairing:disconnect" as const;
const getDeviceRuntimeSnapshotChannel = "bridge:runtime:get-snapshot" as const;
const getIntegrationsSnapshotChannel =
  "bridge:integrations:get-snapshot" as const;
const getDevelopmentSnapshotChannel =
  "bridge:development:get-snapshot" as const;
const getPrinterSnapshotChannel = "bridge:printer:get-snapshot" as const;
const savePrinterConfigurationChannel =
  "bridge:printer:save-configuration" as const;
const deletePrinterConfigurationChannel =
  "bridge:printer:delete-configuration" as const;
const activatePrinterConfigurationChannel =
  "bridge:printer:activate-configuration" as const;
const testPrinterConnectionChannel = "bridge:printer:test-connection" as const;
const testPrinterPrintChannel = "bridge:printer:test-print" as const;
const listWindowsPrintersChannel = "bridge:printer:list-windows" as const;
const discoverPrintersChannel = "bridge:printer:discover" as const;
const selectDiscoveredPrinterChannel =
  "bridge:printer:select-discovered" as const;
const testDiscoveredPrinterChannel = "bridge:printer:test-discovered" as const;
const confirmDiscoveredPrinterChannel =
  "bridge:printer:confirm-discovered" as const;
const requestPrinterSupportChannel = "bridge:printer:request-support" as const;
const exportDiagnosticsChannel = "bridge:diagnostics:export" as const;
const getUpdateSnapshotChannel = "bridge:update:get-snapshot" as const;
const checkForUpdatesChannel = "bridge:update:check" as const;
const installUpdateChannel = "bridge:update:install" as const;

const bridgeFoundation = Object.freeze({
  getRuntimeSnapshot: () => ipcRenderer.invoke(getRuntimeSnapshotChannel),
  getShellSnapshot: () => ipcRenderer.invoke(getShellSnapshotChannel),
  showSettings: () => ipcRenderer.invoke(showSettingsChannel),
  setAutostart: (enabled: boolean) =>
    ipcRenderer.invoke(setAutostartChannel, enabled),
  setPaused: (paused: boolean) => ipcRenderer.invoke(setPausedChannel, paused),
  getPairingSnapshot: () => ipcRenderer.invoke(getPairingSnapshotChannel),
  beginPairing: () => ipcRenderer.invoke(beginPairingChannel),
  openPairingBrowser: () => ipcRenderer.invoke(openPairingBrowserChannel),
  disconnect: () => ipcRenderer.invoke(disconnectChannel),
  getDeviceRuntimeSnapshot: () =>
    ipcRenderer.invoke(getDeviceRuntimeSnapshotChannel),
  getIntegrationsSnapshot: () =>
    ipcRenderer.invoke(getIntegrationsSnapshotChannel),
  getDevelopmentSnapshot: () =>
    ipcRenderer.invoke(getDevelopmentSnapshotChannel),
  getPrinterSnapshot: () => ipcRenderer.invoke(getPrinterSnapshotChannel),
  savePrinterConfiguration: (configuration: unknown, printerId?: string) =>
    ipcRenderer.invoke(savePrinterConfigurationChannel, {
      configuration,
      printerId,
    }),
  deletePrinterConfiguration: (printerId: string) =>
    ipcRenderer.invoke(deletePrinterConfigurationChannel, printerId),
  activatePrinterConfiguration: (printerId: string) =>
    ipcRenderer.invoke(activatePrinterConfigurationChannel, printerId),
  testPrinterConnection: (printerId?: string) =>
    ipcRenderer.invoke(testPrinterConnectionChannel, printerId),
  testPrinterPrint: (printerId?: string) =>
    ipcRenderer.invoke(testPrinterPrintChannel, printerId),
  listWindowsPrinters: () => ipcRenderer.invoke(listWindowsPrintersChannel),
  discoverPrinters: () => ipcRenderer.invoke(discoverPrintersChannel),
  selectDiscoveredPrinter: (candidateId: string) =>
    ipcRenderer.invoke(selectDiscoveredPrinterChannel, candidateId),
  testDiscoveredPrinter: () => ipcRenderer.invoke(testDiscoveredPrinterChannel),
  confirmDiscoveredPrinter: (
    bonLayoutProfile: "compact" | "kitchen" | "detailed",
    printerId?: string,
  ) =>
    ipcRenderer.invoke(confirmDiscoveredPrinterChannel, {
      bonLayoutProfile,
      printerId,
    }),
  requestPrinterSupport: (request: { model: string; note?: string }) =>
    ipcRenderer.invoke(requestPrinterSupportChannel, request),
  exportDiagnostics: () => ipcRenderer.invoke(exportDiagnosticsChannel),
  getUpdateSnapshot: () => ipcRenderer.invoke(getUpdateSnapshotChannel),
  checkForUpdates: () => ipcRenderer.invoke(checkForUpdatesChannel),
  installUpdate: () => ipcRenderer.invoke(installUpdateChannel),
});

contextBridge.exposeInMainWorld("menuqrBridge", bridgeFoundation);
