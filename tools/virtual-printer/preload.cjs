const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("virtualPrinter", {
  getSnapshot: () => ipcRenderer.invoke("virtual-printer:snapshot"),
  clear: () => ipcRenderer.invoke("virtual-printer:clear"),
  onState: (listener) => ipcRenderer.on("virtual-printer:state", (_event, state) => listener(state)),
});
