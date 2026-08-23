import {
  FOUNDATION_RUNTIME_STATE,
  getFoundationDiagnostics
} from "../../src/core/foundation-runtime";

describe("foundation runtime", () => {
  it("reports only the truthful unpaired foundation state", () => {
    expect(FOUNDATION_RUNTIME_STATE).toEqual({ kind: "unpaired" });
    expect(getFoundationDiagnostics("0.1.0")).toEqual({
      generatedAt: "1970-01-01T00:00:00.000Z",
      appVersion: "0.1.0",
      runtime: { kind: "unpaired" },
      pairedRestaurant: null,
      adapters: [],
      recentJobIds: [],
      recentErrorCodes: []
    });
  });
});
