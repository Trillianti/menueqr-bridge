import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const source = resolve(packageRoot, "src/renderer/index.html");
const destinationDirectory = resolve(packageRoot, "dist/renderer");
const destination = resolve(destinationDirectory, "index.html");
const mobileAppIcon = resolve(
  packageRoot,
  "assets/app-icon.png",
);
const rendererAppIcon = resolve(destinationDirectory, "app-icon.png");
const sharedBrandLogo = resolve(
  packageRoot,
  "assets/menueqr-logo.svg",
);
const rendererBrandLogo = resolve(destinationDirectory, "brand-logo.svg");
const macTrayTemplate = resolve(packageRoot, "assets/menueqr-tray-template.png");
const rendererMacTrayTemplate = resolve(
  destinationDirectory,
  "menueqr-tray-template.png",
);
const windowsTrayIcon = resolve(packageRoot, "assets/menueqr-tray-windows.png");
const rendererWindowsTrayIcon = resolve(
  destinationDirectory,
  "menueqr-tray-windows.png",
);
const macDockIcon = resolve(packageRoot, "assets/menueqr-dock-icon.svg");
const rendererMacDockIcon = resolve(destinationDirectory, "menueqr-dock-icon.svg");

await mkdir(destinationDirectory, { recursive: true });
await cp(source, destination);
await cp(mobileAppIcon, rendererAppIcon);
await cp(sharedBrandLogo, rendererBrandLogo);
await cp(macTrayTemplate, rendererMacTrayTemplate);
await cp(windowsTrayIcon, rendererWindowsTrayIcon);
await cp(macDockIcon, rendererMacDockIcon);
