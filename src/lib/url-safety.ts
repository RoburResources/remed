import dns from "node:dns/promises";
import net from "node:net";

type ResolveAddress = (hostname: string) => Promise<Array<{ address: string }>>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const MAX_REDIRECTS = 5;

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export async function validateSafeHttpUrl(
  value: string,
  options: { resolveAddress?: ResolveAddress } = {}
): Promise<URL> {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new UnsafeUrlError("Malformed URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only HTTP and HTTPS URLs are allowed");
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new UnsafeUrlError("Local hostnames are blocked");
  }

  const addresses = await resolveUrlAddresses(hostname, options.resolveAddress);
  if (addresses.length === 0) {
    throw new UnsafeUrlError("URL hostname did not resolve");
  }

  for (const address of addresses) {
    if (isBlockedIpAddress(address.address)) {
      throw new UnsafeUrlError(`URL resolves to a blocked address: ${address.address}`);
    }
  }

  return url;
}

export async function fetchWithUrlSafety(
  value: string,
  init: RequestInit = {},
  options: {
    fetchImpl?: FetchLike;
    resolveAddress?: ResolveAddress;
    maxRedirects?: number;
  } = {}
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let current = await validateSafeHttpUrl(value, { resolveAddress: options.resolveAddress });

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchImpl(current, {
      ...init,
      redirect: "manual"
    });

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    current = await validateSafeHttpUrl(new URL(location, current).toString(), {
      resolveAddress: options.resolveAddress
    });
  }

  throw new UnsafeUrlError("Too many redirects");
}

export function isBlockedIpAddress(value: string): boolean {
  const ipVersion = net.isIP(value);
  if (ipVersion === 4) {
    return isBlockedIpv4(value);
  }

  if (ipVersion === 6) {
    return isBlockedIpv6(value);
  }

  return true;
}

async function resolveUrlAddresses(hostname: string, resolveAddress?: ResolveAddress): Promise<Array<{ address: string }>> {
  if (net.isIP(hostname)) {
    return [{ address: hostname }];
  }

  const resolver = resolveAddress ?? ((host: string) => dns.lookup(host, { all: true, verbatim: true }));

  try {
    return await resolver(hostname);
  } catch {
    throw new UnsafeUrlError("URL hostname did not resolve");
  }
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function isBlockedIpv4(value: string): boolean {
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(value: string): boolean {
  const normalized = value.toLowerCase();

  if (normalized.startsWith("::ffff:")) {
    const embeddedIpv4 = normalized.slice("::ffff:".length);
    return isBlockedIpAddress(embeddedIpv4);
  }

  const firstWord = Number.parseInt(normalized.split(":")[0] || "0", 16);

  return (
    normalized === "::" ||
    normalized === "::1" ||
    (firstWord & 0xfe00) === 0xfc00 ||
    (firstWord & 0xffc0) === 0xfe80 ||
    (firstWord & 0xff00) === 0xff00 ||
    normalized.startsWith("2001:db8:")
  );
}
