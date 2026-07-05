import { beforeEach, describe, expect, it } from "vitest";
import { wouldExceedDailyApiSpend } from "@/src/lib/db";
import { resetEnvCacheForTests } from "@/src/lib/env";
import { estimateOpenAIPreflightSpendCents } from "@/src/lib/openai";

describe("OpenAI spend policy", () => {
  beforeEach(() => {
    Object.assign(process.env, {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-with-length",
      OPENAI_COST_INPUT_CENTS_PER_1K: "1",
      OPENAI_COST_OUTPUT_CENTS_PER_1K: "4",
      CRON_SECRET: "cron-secret-with-length",
      DASHBOARD_API_TOKEN: "dashboard-token-with-enough-length",
      APPROVAL_SECRET: "approval-secret-with-enough-length",
      PUBLIC_BASE_URL: "https://worker.example.com",
      OWNER_PHONE: "+61400000000"
    });
    resetEnvCacheForTests();
  });

  it("allows calls that fit under the daily cap", () => {
    expect(wouldExceedDailyApiSpend(100, 500, 25)).toBe(false);
  });

  it("blocks calls that would exceed the daily cap", () => {
    expect(wouldExceedDailyApiSpend(490, 500, 25)).toBe(true);
    expect(wouldExceedDailyApiSpend(0, 0, 25)).toBe(true);
  });

  it("estimates a preflight spend before provider calls", () => {
    const estimate = estimateOpenAIPreflightSpendCents({
      system: "Summarize safely.",
      user: "A".repeat(4000),
      schema: { type: "object", properties: { ok: { type: "boolean" } } }
    });

    expect(estimate).toBeGreaterThan(0);
  });
});
