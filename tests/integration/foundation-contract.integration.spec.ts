import {
  getFoundationDiagnostics
} from "../../src/core/foundation-runtime";

describe("foundation integration contract", () => {
  it("provides a redacted diagnostics shape without a device token or network topology", () => {
    const diagnostics = getFoundationDiagnostics("0.1.0-test");
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics.pairedRestaurant).toBeNull();
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("host");
    expect(serialized).not.toContain("port");
  });
});
