import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "../../src/core/runtime-store";

describe("runtime store", () => {
  it("recovers safely from corruption and bounds persisted recovery references", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-runtime-"));
    const filePath = join(directory, "runtime.json");
    await writeFile(filePath, "not-json", "utf8");
    const store = new RuntimeStore(filePath);
    await expect(store.read()).resolves.toEqual({
      paused: false,
      lastState: null,
      recentJobIds: [],
      recentErrorCodes: [],
      recentFailedJobIds: [],
    });
    await store.write({
      paused: true,
      lastState: { kind: "paused", updatedAt: "2026-08-22T12:00:00.000Z" },
      recentJobIds: Array.from({ length: 30 }, (_, index) => `job_${index}`),
      recentErrorCodes: Array.from(
        { length: 30 },
        (_, index) => `error_${index}`,
      ),
      recentFailedJobIds: Array.from(
        { length: 30 },
        (_, index) => `failed_${index}`,
      ),
    });
    await expect(store.read()).resolves.toMatchObject({
      paused: true,
      recentJobIds: expect.arrayContaining(["job_29"]),
      recentErrorCodes: expect.arrayContaining(["error_29"]),
      recentFailedJobIds: expect.arrayContaining(["failed_29"]),
    });
  });

  it("serializes concurrent atomic writes without reusing a temporary file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-runtime-"));
    const store = new RuntimeStore(join(directory, "runtime.json"));
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.write({
          paused: false,
          lastState: {
            kind: "ready",
            updatedAt: `2026-08-22T12:00:${index
              .toString()
              .padStart(2, "0")}.000Z`,
          },
          recentJobIds: [`job_${index}`],
          recentErrorCodes: [],
          recentFailedJobIds: [],
        }),
      ),
    );
    await store.flush();
    await expect(store.read()).resolves.toMatchObject({
      recentJobIds: ["job_11"],
    });
  });
});
