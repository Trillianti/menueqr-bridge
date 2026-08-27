import { createServer, type Server } from "node:net";

import { StarTsp1000LanAdapter } from "../../src/integrations/printers/star-tsp1000-lan/star-tsp1000-lan";

describe("Star TSP1000 LAN transport", () => {
  let server: Server;
  let port = 0;
  const received: Buffer[] = [];

  beforeAll(async () => {
    server = createServer((socket) =>
      socket.on("data", (data) => received.push(Buffer.from(data))),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Fake printer did not start.");
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("writes exactly one complete buffer to a private-LAN fake printer", async () => {
    const adapter = new StarTsp1000LanAdapter(undefined, true, async () => [
      { address: "127.0.0.1", family: 4 },
    ]);
    const config = {
      host: "localhost",
      port,
      commandMode: "star_line" as const,
      paperWidthMm: 80 as const,
      encoding: "cp437" as const,
      connectTimeoutMs: 1_000,
      writeTimeoutMs: 1_000,
      cutAfterPrint: true,
      bonLayoutProfile: "detailed" as const,
    };
    const payload = Buffer.from("COMPLETE-TEST-BUFFER");
    await expect(
      adapter.execute(payload, config, new AbortController().signal),
    ).resolves.toMatchObject({ status: "succeeded", code: "PRINT_WRITTEN" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(Buffer.concat(received)).toEqual(payload);
  });

  it("classifies a canceled request without leaving the socket active", async () => {
    const adapter = new StarTsp1000LanAdapter(undefined, true, async () => [
      { address: "127.0.0.1", family: 4 },
    ]);
    const controller = new AbortController();
    controller.abort();
    const config = {
      host: "localhost",
      port,
      commandMode: "esc_pos" as const,
      paperWidthMm: 80 as const,
      encoding: "cp437" as const,
      connectTimeoutMs: 1_000,
      writeTimeoutMs: 1_000,
      cutAfterPrint: true,
      bonLayoutProfile: "detailed" as const,
    };
    await expect(
      adapter.execute(Buffer.from("x"), config, controller.signal),
    ).resolves.toMatchObject({ status: "terminal_failure", code: "CANCELED" });
  });
});
