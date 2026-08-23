import {
  applyPairingStatus,
  waitingState,
} from "../../src/core/pairing-state-machine";

describe("pairing state machine", () => {
  const code = {
    deviceCode: "device-code",
    userCode: "ABCD-1234",
    verificationUri: "https://menueqr.de/dashboard/settings/bridge",
    verificationUriComplete:
      "https://menueqr.de/dashboard/settings/bridge?user_code=ABCD-1234",
    expiresAt: "2026-08-22T12:10:00.000Z",
    pollingIntervalSeconds: 5,
  } as const;

  it("preserves server polling timing and reaches paired only after encrypted storage succeeds", () => {
    const waiting = waitingState(code);
    expect(
      applyPairingStatus(
        waiting,
        { kind: "slow_down", pollingIntervalSeconds: 10 },
        null,
      ),
    ).toEqual({
      ...waiting,
      kind: "slow_down",
      pollingIntervalSeconds: 10,
    });
    expect(() =>
      applyPairingStatus(
        waiting,
        {
          kind: "approved",
          token: {
            deviceId: "device_1",
            token: "secret",
            restaurant: { id: "restaurant_1", displayName: "Weingut Jäckel" },
            issuedAt: "2026-08-22T12:01:00.000Z",
          },
        },
        null,
      ),
    ).toThrow("stored credentials");
  });

  it("makes denial and expiry terminal without leaking a token", () => {
    const waiting = waitingState(code);
    expect(
      applyPairingStatus(waiting, { kind: "denied", message: "Denied" }, null),
    ).toEqual({ kind: "denied", message: "Denied" });
    expect(
      applyPairingStatus(
        waiting,
        { kind: "expired", message: "Expired" },
        null,
      ),
    ).toEqual({ kind: "expired", message: "Expired" });
  });
});
