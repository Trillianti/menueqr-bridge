import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const packageRoot = join(__dirname, "../..");
const sourceRoot = join(packageRoot, "src");

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return filesIn(entryPath);
    }

    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

function source(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

describe("architecture boundaries", () => {
  it("keeps the renderer free of Electron, Node, core, platform, and integration imports", () => {
    const rendererFiles = filesIn(join(sourceRoot, "renderer"));
    const forbiddenImport =
      /from\s+["'](?:electron|node:|fs|path|net|http|https|child_process|\.\.\/(?:main|core|platform|integrations))/;

    for (const filePath of rendererFiles) {
      expect(source(filePath)).not.toMatch(forbiddenImport);
    }
  });

  it("keeps core contracts independent from privileged implementation layers", () => {
    const contracts = filesIn(join(sourceRoot, "contracts"));

    for (const filePath of contracts) {
      expect(source(filePath)).not.toMatch(
        /from\s+["'][^"']*(?:\/main\/|\/preload\/|\/platform\/|\/integrations\/)/,
      );
    }
  });

  it("rejects inbound-server framework dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencyNames = Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    });

    expect(dependencyNames).not.toEqual(
      expect.arrayContaining(["express", "fastify", "koa", "@nestjs/core"]),
    );
  });

  it("keeps future adapters out of the renderer dependency direction", () => {
    const allFiles = filesIn(sourceRoot);

    for (const filePath of allFiles.filter((candidate) =>
      relative(sourceRoot, candidate).startsWith("integrations/"),
    )) {
      expect(source(filePath)).not.toMatch(/from\s+["'][^"']*renderer/);
    }
  });

  it("keeps core runtime free of printer-specific adapter imports", () => {
    const runtime = source(join(sourceRoot, "core/bridge-runtime.ts"));
    expect(runtime).not.toMatch(/tsp1000|star[_ .-]?(?:line|printer)|esc_pos/i);
  });

  it("uses one explicit, typed IPC namespace", () => {
    const preload = source(join(sourceRoot, "preload/index.ts"));
    expect(preload).toContain('exposeInMainWorld("menuqrBridge"');
    expect(preload).not.toMatch(/ipcRenderer\.(?:send|on)\(/);
  });

  it("keeps tray and autostart control in the privileged main process", () => {
    const renderer = source(join(sourceRoot, "renderer/renderer.ts"));
    const main = source(join(sourceRoot, "main/index.ts"));

    expect(renderer).not.toMatch(
      /(?:Tray|setLoginItemSettings|requestSingleInstanceLock)/,
    );
    expect(main).toContain("requestSingleInstanceLock");
    expect(main).toContain("AutostartAdapter");
    expect(main).toContain("menueqr-tray-template.png");
    expect(main).toContain("menueqr-tray-windows.png");
  });
});
