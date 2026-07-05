import { describe, expect, it, vi } from "vitest";
import { fetchWithUrlSafety, isBlockedIpAddress, validateSafeHttpUrl } from "@/src/lib/url-safety";

describe("URL safety validation", () => {
  it("allows public HTTP(S) destinations", async () => {
    await expect(
      validateSafeHttpUrl("https://example.com/research", {
        resolveAddress: async () => [{ address: "93.184.216.34" }]
      })
    ).resolves.toBeInstanceOf(URL);
  });

  it("blocks unsafe schemes and local destinations", async () => {
    await expect(validateSafeHttpUrl("file:///etc/passwd")).rejects.toThrow("HTTP");
    await expect(validateSafeHttpUrl("http://localhost/admin")).rejects.toThrow("Local");
    await expect(validateSafeHttpUrl("http://10.0.0.5/private")).rejects.toThrow("blocked");
  });

  it("classifies private and reserved addresses as blocked", () => {
    expect(isBlockedIpAddress("127.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("192.168.1.10")).toBe(true);
    expect(isBlockedIpAddress("169.254.1.1")).toBe(true);
    expect(isBlockedIpAddress("192.0.2.10")).toBe(true);
    expect(isBlockedIpAddress("198.51.100.10")).toBe(true);
    expect(isBlockedIpAddress("203.0.113.10")).toBe(true);
    expect(isBlockedIpAddress("::1")).toBe(true);
    expect(isBlockedIpAddress("fc00::1")).toBe(true);
    expect(isBlockedIpAddress("93.184.216.34")).toBe(false);
  });

  it("blocks redirects to unsafe destinations", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("", {
        status: 302,
        headers: {
          location: "http://127.0.0.1/admin"
        }
      })
    );

    await expect(
      fetchWithUrlSafety(
        "https://example.com/start",
        {},
        {
          fetchImpl,
          resolveAddress: async () => [{ address: "93.184.216.34" }]
        }
      )
    ).rejects.toThrow("blocked");
  });
});
