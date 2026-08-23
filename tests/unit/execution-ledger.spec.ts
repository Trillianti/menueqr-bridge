import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ExecutionLedger } from "../../src/core/execution-ledger";

describe("execution ledger", () => {
  it("deduplicates exact replays and rejects a changed payload for the same job", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-ledger-"));
    const ledger = new ExecutionLedger(join(directory, "ledger.json"));
    await ledger.record("job_1", { immutable: true }, "printed");
    await expect(ledger.get("job_1")).resolves.toMatchObject({
      state: "printed",
    });
    await expect(
      ledger.record("job_1", { immutable: false }, "received"),
    ).rejects.toThrow("PAYLOAD_INTEGRITY_MISMATCH");
  });

  it("keeps ack-pending entries while pruning old resolved entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "menuqr-bridge-ledger-"));
    const ledger = new ExecutionLedger(join(directory, "ledger.json"));
    await ledger.record("old", { id: "old" }, "succeeded");
    await ledger.record("pending", { id: "pending" }, "ack_pending");
    await ledger.prune(new Date(Date.now() + 1_000));
    await expect(ledger.get("old")).resolves.toBeNull();
    await expect(ledger.get("pending")).resolves.toMatchObject({
      state: "ack_pending",
    });
  });
});
