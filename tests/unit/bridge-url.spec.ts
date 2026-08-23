import { validateBridgeApiBaseUrl } from "../../src/main/bridge-url";

describe("bridge API URL", () => {
  it("accepts a credential-free HTTPS endpoint", () => {
    expect(validateBridgeApiBaseUrl("https://menueqr.de/api/")).toBe(
      "https://menueqr.de/api",
    );
  });

  it("allows an explicit private HTTP endpoint only for the unpacked development build", () => {
    expect(
      validateBridgeApiBaseUrl("http://192.168.0.12:3001/api/", {
        allowInsecureLocal: true,
      }),
    ).toBe("http://192.168.0.12:3001/api");
    expect(() =>
      validateBridgeApiBaseUrl("http://192.168.0.12:3001/api"),
    ).toThrow(/HTTPS/);
    expect(() =>
      validateBridgeApiBaseUrl("http://example.com/api", {
        allowInsecureLocal: true,
      }),
    ).toThrow(/HTTPS/);
  });

  it.each([
    "http://menueqr.de/api",
    "https://token@menueqr.de/api",
    "https://menueqr.de/api#fragment",
    "not a URL",
  ])("rejects unsafe endpoint configuration: %s", (value) => {
    expect(() => validateBridgeApiBaseUrl(value)).toThrow(/API URL/);
  });
});
