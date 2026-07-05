import { describe, expect, it } from "vitest";
import { extractRelevantAusTenderSnippets } from "@/src/lib/scanners/austender";

describe("AusTender snippet extraction", () => {
  it("extracts relevant ATM links", () => {
    const html = `
      <a href="/Atm/Show/abc">Supply and removal of scrap metal and recycling services</a>
      <a href="/Atm/Show/def">Office stationery</a>
    `;

    const results = extractRelevantAusTenderSnippets(html);
    expect(results).toHaveLength(1);
    expect(results[0].description).toContain("scrap metal");
    expect(results[0].url).toContain("/Atm/Show/abc");
  });
});
