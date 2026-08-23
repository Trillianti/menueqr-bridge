const { app, BrowserWindow, ipcMain } = require("electron");
const { networkInterfaces } = require("node:os");
const net = require("node:net");
const path = require("node:path");

const port = Number(process.env.MENUEQR_VIRTUAL_PRINTER_PORT || 9100);
const jobs = [];
let server;
let window;
let error = null;

function privateIpv4Addresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter((address) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address));
}

function receiptPreview(buffer) {
  const printable = stripPrinterCommands(buffer);
  const utf8 = printable.toString("utf8");
  const cp437 = {
    0x81: "ü",
    0x84: "ä",
    0x8e: "Ä",
    0x94: "ö",
    0x99: "Ö",
    0x9a: "Ü",
    0xe1: "ß",
  };
  const decoded = utf8.includes("�")
    ? [...printable].map((byte) => cp437[byte] || String.fromCharCode(byte)).join("")
    : utf8;
  const text = decoded
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b-\x1a\x1e-\x1f\x7f-\x9f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || "[Steuerdaten ohne sichtbaren Text]";
}

function stripPrinterCommands(buffer) {
  const output = [];
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    const next = buffer[index + 1];
    if (byte === 0x1b) {
      if (next === 0x61 || next === 0x64) index += 2;
      else if (next !== undefined) index += 1;
      continue;
    }
    if (byte === 0x1d) {
      if (next === 0x56) index += 2;
      else if (next !== undefined) index += 1;
      continue;
    }
    if (byte === 0x1c) {
      if (next !== undefined) index += 1;
      continue;
    }
    output.push(byte);
  }
  return Buffer.from(output);
}

function snapshot() {
  return {
    port,
    addresses: privateIpv4Addresses(),
    error,
    jobs,
  };
}

function broadcast() {
  if (!window || window.isDestroyed()) return;
  window.webContents.send("virtual-printer:state", snapshot());
}

function startPrinter() {
  server = net.createServer((socket) => {
    const chunks = [];
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => {
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) return;
      jobs.unshift({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        receivedAt: new Date().toISOString(),
        bytes: buffer.length,
        preview: receiptPreview(buffer),
      });
      jobs.splice(50);
      broadcast();
    });
  });
  server.on("error", (cause) => {
    error = cause.code === "EADDRINUSE"
      ? `Port ${port} wird bereits verwendet.`
      : "Der virtuelle Drucker konnte nicht gestartet werden.";
    broadcast();
  });
  server.listen(port, "0.0.0.0");
}

function createWindow() {
  window = new BrowserWindow({
    width: 760,
    height: 680,
    minWidth: 560,
    minHeight: 480,
    title: "MenüQR Virtual Printer",
    backgroundColor: "#f7f6f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void window.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("virtual-printer:snapshot", () => snapshot());
  ipcMain.handle("virtual-printer:clear", () => {
    jobs.splice(0);
    broadcast();
  });
  createWindow();
  startPrinter();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => server?.close());
