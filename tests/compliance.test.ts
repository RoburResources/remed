import { describe, expect, it } from "vitest";
import { isPermittedTelemarketingWindow } from "@/src/lib/compliance";

describe("Australian telemarketing contact window", () => {
  it("allows Perth weekday daytime calls", () => {
    expect(isPermittedTelemarketingWindow(new Date("2026-07-06T03:00:00.000Z"))).toBe(true); // Monday 11:00 AWST
  });

  it("blocks Sunday and late weekday calls", () => {
    expect(isPermittedTelemarketingWindow(new Date("2026-07-05T03:00:00.000Z"))).toBe(false); // Sunday 11:00 AWST
    expect(isPermittedTelemarketingWindow(new Date("2026-07-06T13:00:00.000Z"))).toBe(false); // Monday 21:00 AWST
  });

  it("blocks configured public holidays", () => {
    expect(isPermittedTelemarketingWindow(new Date("2026-07-06T03:00:00.000Z"), "Australia/Perth", ["2026-07-06"])).toBe(false);
  });
});
