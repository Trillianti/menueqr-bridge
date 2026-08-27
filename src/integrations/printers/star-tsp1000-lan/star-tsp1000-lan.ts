import { createHash } from "node:crypto";
import { lookup, reverse } from "node:dns/promises";
import { isIP, Socket } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

import type {
  AdapterDiscoveryCandidate,
  AdapterExecutionResult,
  AdapterHealth,
  IntegrationAdapter,
} from "../../../contracts";
import { createStaticTestBon } from "../../kitchen-bon";

export type StarTsp1000LanConfiguration = {
  host: string;
  port: number;
  commandMode: "star_line" | "esc_pos";
  paperWidthMm: 80 | 82;
  encoding: "cp437" | "cp850" | "windows1252";
  connectTimeoutMs: number;
  writeTimeoutMs: number;
  cutAfterPrint: boolean;
};

export type SocketFactory = () => Socket;
export type PrinterHostResolver = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<ReadonlyArray<{ address: string; family: number }>>;
export type PrinterReverseDnsResolver = (
  address: string,
) => Promise<readonly string[]>;
export type NetworkInterfacesProvider = () => NodeJS.Dict<
  NetworkInterfaceInfo[]
>;
export type PrinterPortProbe = (
  host: string,
  port: number,
  timeoutMs: number,
  signal: AbortSignal,
) => Promise<boolean>;

const DEFAULTS: StarTsp1000LanConfiguration = {
  host: "",
  port: 9100,
  commandMode: "star_line",
  paperWidthMm: 80,
  encoding: "cp437",
  connectTimeoutMs: 3_000,
  writeTimeoutMs: 5_000,
  cutAfterPrint: true,
};
const DISCOVERY_PORT = 9100;
const DISCOVERY_TIMEOUT_MS = 350;
const DISCOVERY_CONCURRENCY = 20;
const MAX_DISCOVERY_HOSTS = 254;
const DISCOVERY_NAME_TIMEOUT_MS = 500;

export class StarTsp1000LanAdapter implements IntegrationAdapter<
  StarTsp1000LanConfiguration,
  Uint8Array
> {
  readonly id = "printer.star-tsp1000-lan";
  readonly version = 1;
  readonly capabilities = ["printer.kitchen"] as const;
  readonly supportedJobSchemas = [1] as const;

  constructor(
    private readonly socketFactory: SocketFactory = () => new Socket(),
    private readonly allowLoopbackForTest = false,
    private readonly resolveHost: PrinterHostResolver = (hostname, options) =>
      lookup(hostname, options),
    private readonly getNetworkInterfaces: NetworkInterfacesProvider = networkInterfaces,
    private readonly probePort: PrinterPortProbe = probePrinterPort,
    private readonly reverseDns: PrinterReverseDnsResolver = reverse,
  ) {}

  validateConfiguration(value: unknown): StarTsp1000LanConfiguration {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("INVALID_CONFIGURATION");
    const input = value as Partial<StarTsp1000LanConfiguration>;
    const config: StarTsp1000LanConfiguration = {
      host:
        typeof input.host === "string" ? input.host.trim().toLowerCase() : "",
      port: input.port ?? DEFAULTS.port,
      commandMode: input.commandMode ?? DEFAULTS.commandMode,
      paperWidthMm: input.paperWidthMm ?? DEFAULTS.paperWidthMm,
      encoding: input.encoding ?? DEFAULTS.encoding,
      connectTimeoutMs: input.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs,
      writeTimeoutMs: input.writeTimeoutMs ?? DEFAULTS.writeTimeoutMs,
      cutAfterPrint: input.cutAfterPrint ?? DEFAULTS.cutAfterPrint,
    };
    if (
      (!isAllowedLocalHost(config.host) &&
        !(this.allowLoopbackForTest && isLoopbackHost(config.host))) ||
      !Number.isInteger(config.port) ||
      config.port < 1 ||
      config.port > 65535 ||
      !["star_line", "esc_pos"].includes(config.commandMode) ||
      ![80, 82].includes(config.paperWidthMm) ||
      !["cp437", "cp850", "windows1252"].includes(config.encoding) ||
      !isTimeout(config.connectTimeoutMs) ||
      !isTimeout(config.writeTimeoutMs) ||
      typeof config.cutAfterPrint !== "boolean"
    ) {
      throw new Error("INVALID_CONFIGURATION");
    }
    return config;
  }

  redactConfiguration(
    value: StarTsp1000LanConfiguration,
  ): Record<string, unknown> {
    const config = this.validateConfiguration(value);
    return {
      hostFingerprint: fingerprintHost(config.host),
      port: config.port,
      commandMode: config.commandMode,
      paperWidthMm: config.paperWidthMm,
      encoding: config.encoding,
      connectTimeoutMs: config.connectTimeoutMs,
      writeTimeoutMs: config.writeTimeoutMs,
      cutAfterPrint: config.cutAfterPrint,
    };
  }

  async healthCheck(
    configuration: StarTsp1000LanConfiguration,
  ): Promise<AdapterHealth> {
    try {
      await this.connectAndClose(this.validateConfiguration(configuration));
      return {
        status: "ready",
        code: "TCP_READY",
        message: "Printer TCP connection succeeded.",
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const code = normalizeSocketError(error);
      return {
        status: code === "INVALID_CONFIGURATION" ? "misconfigured" : "offline",
        code,
        message: healthMessage(code),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async execute(
    payload: Uint8Array,
    configuration: StarTsp1000LanConfiguration,
    signal: AbortSignal,
  ): Promise<AdapterExecutionResult> {
    try {
      const config = this.validateConfiguration(configuration);
      if (
        !(payload instanceof Uint8Array) ||
        payload.byteLength === 0 ||
        payload.byteLength > 64 * 1024
      )
        return {
          status: "terminal_failure",
          code: "INVALID_PRINT_PAYLOAD",
          message: "Print payload is invalid.",
        };
      await this.writeBuffer(config, Buffer.from(payload), signal);
      return {
        status: "succeeded",
        code: "PRINT_WRITTEN",
        message: "Printer write completed.",
        metadata: { bytesWritten: payload.byteLength },
      };
    } catch (error) {
      const code = normalizeSocketError(error);
      return {
        status:
          code === "INVALID_CONFIGURATION" || code === "CANCELED"
            ? "terminal_failure"
            : "retryable_failure",
        code,
        message: healthMessage(code),
      };
    }
  }

  async test(configuration: StarTsp1000LanConfiguration, signal: AbortSignal) {
    const config = this.validateConfiguration(configuration);
    const payload = createStaticTestBon(config);
    const result = await this.execute(payload, config, signal);
    return {
      status: result.status,
      code: result.code,
      message: result.message,
    };
  }

  async discover(
    signal: AbortSignal,
  ): Promise<readonly AdapterDiscoveryCandidate[]> {
    const hosts = discoverPrivateIpv4Hosts(this.getNetworkInterfaces());
    const reachable = await mapWithConcurrency(
      hosts,
      DISCOVERY_CONCURRENCY,
      async (host) => {
        const available = await this.probePort(
          host,
          DISCOVERY_PORT,
          DISCOVERY_TIMEOUT_MS,
          signal,
        );
        return available ? host : null;
      },
    );
    const candidates = await mapWithConcurrency(
      reachable.filter((host): host is string => host !== null),
      DISCOVERY_CONCURRENCY,
      async (host) => ({
        id: `star-lan:${host}:${DISCOVERY_PORT}`,
        displayName: await this.discoveredPrinterName(host),
        host,
        port: DISCOVERY_PORT,
      }),
    );
    return candidates
      .sort((left, right) => compareIpv4(left.host, right.host));
  }

  private async discoveredPrinterName(host: string): Promise<string> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const hostnames = await Promise.race<readonly string[]>([
        this.reverseDns(host),
        new Promise<readonly string[]>((resolve) => {
          timeout = setTimeout(() => resolve([]), DISCOVERY_NAME_TIMEOUT_MS);
        }),
      ]);
      const name = hostnames
        .map((hostname) => hostname.trim().replace(/\.$/, ""))
        .find(isSafePrinterDisplayName);
      return name ?? `Netzwerkdrucker (${host})`;
    } catch {
      return `Netzwerkdrucker (${host})`;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async connectAndClose(
    config: StarTsp1000LanConfiguration,
  ): Promise<void> {
    const resolved = {
      ...config,
      host: await this.resolvedAddress(config.host),
    };
    const socket = this.socketFactory();
    await connectSocket(socket, resolved, new AbortController().signal);
    socket.end();
    socket.destroy();
  }

  private async writeBuffer(
    config: StarTsp1000LanConfiguration,
    buffer: Buffer,
    signal: AbortSignal,
  ): Promise<void> {
    const resolved = {
      ...config,
      host: await this.resolvedAddress(config.host),
    };
    const socket = this.socketFactory();
    await connectSocket(socket, resolved, signal);
    await writeSocket(socket, buffer, resolved.writeTimeoutMs, signal);
    socket.end();
    socket.destroy();
  }

  private async resolvedAddress(host: string): Promise<string> {
    if (isIP(host)) return host;
    const records = await this.resolveHost(host, { all: true, verbatim: true });
    const addresses = [...new Set(records.map((record) => record.address))];
    if (
      addresses.length === 0 ||
      !addresses.every((address) =>
        isAllowedResolvedAddress(address, this.allowLoopbackForTest),
      )
    ) {
      throw new Error("INVALID_CONFIGURATION");
    }
    return addresses[0]!;
  }
}

function isTimeout(value: number): boolean {
  return Number.isInteger(value) && value >= 250 && value <= 30_000;
}

export function isAllowedLocalHost(host: string): boolean {
  if (!host || host.length > 253 || /[:/\\@?*\s]/.test(host)) return false;
  const type = isIP(host);
  if (type === 4) {
    const [first, secondRaw] = host.split(".").map(Number);
    const second = secondRaw ?? -1;
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (type === 6)
    return (
      host.toLowerCase().startsWith("fc") ||
      host.toLowerCase().startsWith("fd") ||
      host.toLowerCase().startsWith("fe80:")
    );
  return (
    host !== "localhost" &&
    (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*local$/i.test(host) ||
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host))
  );
}

export function discoverPrivateIpv4Hosts(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string[] {
  const ownAddresses = Object.entries(interfaces)
    .filter(([name]) => isDiscoverableInterface(name))
    .flatMap(([, entries]) => entries ?? [])
    .filter(
      (entry) =>
        entry.family === "IPv4" &&
        entry.internal === false &&
        isAllowedLocalHost(entry.address),
    )
    .map((entry) => entry.address);
  const targets = new Set<string>();
  for (const address of ownAddresses) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet)))
      continue;
    const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`;
    for (let host = 1; host <= 254; host += 1) {
      const candidate = `${prefix}.${host}`;
      // A local TCP printer emulator is a legitimate development and support
      // target. Keep this limited to the active private LAN interface; loopback
      // addresses still never enter discovery.
      targets.add(candidate);
      if (targets.size >= MAX_DISCOVERY_HOSTS) return [...targets];
    }
  }
  return [...targets];
}

function isDiscoverableInterface(name: string): boolean {
  return !/^(?:lo|loopback|docker|veth|br-|virbr|tun|tap|utun|wg|zt|tailscale|vpn)/i.test(
    name,
  );
}

function isAllowedResolvedAddress(
  address: string,
  allowLoopback: boolean,
): boolean {
  return (
    isAllowedLocalHost(address) || (allowLoopback && isLoopbackHost(address))
  );
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isSafePrinterDisplayName(value: string | undefined): value is string {
  return Boolean(value && value.length <= 253 && !/[\u0000-\u001f\u007f]/.test(value));
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const result: Output[] = [];
  let index = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (index < values.length) {
        const current = values[index++];
        if (current !== undefined) result.push(await mapper(current));
      }
    },
  );
  await Promise.all(workers);
  return result;
}

function probePrinterPort(
  host: string,
  port: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("error", onFailure);
      signal.removeEventListener("abort", onAbort);
      socket.destroy();
    };
    const settle = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(reachable);
    };
    const onConnect = () => settle(true);
    const onFailure = () => settle(false);
    const onAbort = () => settle(false);
    const timeout = setTimeout(onFailure, timeoutMs);
    socket.once("connect", onConnect);
    socket.once("error", onFailure);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    socket.connect(port, host);
  });
}

function compareIpv4(left: string, right: string): number {
  const leftValue = left.split(".").map(Number);
  const rightValue = right.split(".").map(Number);
  for (let index = 0; index < 4; index += 1) {
    const difference = (leftValue[index] ?? 0) - (rightValue[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function fingerprintHost(host: string): string {
  return createHash("sha256").update(host).digest("hex").slice(0, 16);
}

export function normalizeSocketError(error: unknown): string {
  if (error instanceof Error && error.message === "CANCELED") return "CANCELED";
  const code =
    typeof (error as NodeJS.ErrnoException)?.code === "string"
      ? (error as NodeJS.ErrnoException).code
      : "";
  if (code === "ECONNREFUSED") return "PRINTER_OFFLINE";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT")
    return "SOCKET_TIMEOUT";
  if (code === "ECONNRESET") return "SOCKET_RESET";
  if (code === "ENOTFOUND" || code === "EHOSTUNREACH" || code === "ENETUNREACH")
    return "NETWORK_UNAVAILABLE";
  if (error instanceof Error && error.message === "INVALID_CONFIGURATION")
    return "INVALID_CONFIGURATION";
  return "SOCKET_WRITE_FAILED";
}

function healthMessage(code: string): string {
  return (
    (
      {
        TCP_READY: "Printer TCP connection succeeded.",
        PRINTER_OFFLINE: "Printer connection was refused.",
        SOCKET_TIMEOUT: "Printer connection timed out.",
        SOCKET_RESET: "Printer connection reset.",
        NETWORK_UNAVAILABLE: "Printer network is unavailable.",
        CANCELED: "Printer request was canceled.",
        INVALID_CONFIGURATION: "Printer configuration is invalid.",
        SOCKET_WRITE_FAILED: "Printer write failed.",
      } as Record<string, string>
    )[code] ?? "Printer connection failed."
  );
}

function connectSocket(
  socket: Socket,
  config: StarTsp1000LanConfiguration,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        socket.destroy();
        reject(error);
      } else resolve();
    };
    const onConnect = () => settle();
    const onError = (error: Error) => settle(error);
    const onAbort = () => settle(new Error("CANCELED"));
    const timeout = setTimeout(() => {
      const error = Object.assign(new Error("Socket timeout"), {
        code: "ETIMEDOUT",
      });
      settle(error);
    }, config.connectTimeoutMs);
    socket.once("connect", onConnect);
    socket.once("error", onError);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    socket.connect(config.port, config.host);
  });
}

function writeSocket(
  socket: Socket,
  buffer: Buffer,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("error", onError);
      socket.off("drain", onDrain);
      signal.removeEventListener("abort", onAbort);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        socket.destroy();
        reject(error);
      } else resolve();
    };
    const onError = (error: Error) => settle(error);
    const onDrain = () => settle();
    const onAbort = () => settle(new Error("CANCELED"));
    const timeout = setTimeout(() => {
      const error = Object.assign(new Error("Socket write timeout"), {
        code: "ETIMEDOUT",
      });
      settle(error);
    }, timeoutMs);
    socket.once("error", onError);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    if (socket.write(buffer)) settle();
    else socket.once("drain", onDrain);
  });
}
