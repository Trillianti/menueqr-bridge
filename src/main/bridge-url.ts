export type BridgeApiUrlOptions = {
  allowInsecureLocal?: boolean;
};

export function validateBridgeApiBaseUrl(
  value: string,
  options: BridgeApiUrlOptions = {},
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MenüQR Bridge API URL is invalid.");
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname
  ) {
    throw new Error(
      "MenüQR Bridge API URL must not include credentials, a fragment, or an empty host.",
    );
  }
  if (url.protocol === "https:") return url.toString().replace(/\/$/, "");
  if (
    options.allowInsecureLocal &&
    url.protocol === "http:" &&
    isPrivateOrLoopbackHost(url.hostname)
  ) {
    return url.toString().replace(/\/$/, "");
  }
  throw new Error("MenüQR Bridge API URL must use HTTPS.");
}

export function isPrivateOrLoopbackHost(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 192 && second === 168) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31)
  );
}
