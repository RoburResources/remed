import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCacheForTests } from "@/src/lib/env";

const originalEnv = process.env;

const requiredEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-with-enough-length",
  CRON_SECRET: "cron-secret-with-length",
  DASHBOARD_API_TOKEN: "dashboard-token-with-enough-length",
  APPROVAL_SECRET: "approval-secret-with-enough-length",
  PUBLIC_BASE_URL: "https://worker.example.com",
  OWNER_PHONE: "+61400000000"
};

describe("environment parsing", () => {
  beforeEach(() => {
    resetEnvCacheForTests();
    process.env = { ...originalEnv, ...requiredEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnvCacheForTests();
  });

  it("treats blank optional integration values as absent", () => {
    process.env = {
      ...process.env,
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
      OPENAI_COST_INPUT_CENTS_PER_1K: "",
      OPENAI_COST_OUTPUT_CENTS_PER_1K: "",
      TWILIO_PHONE_NUMBER: "",
      RETELL_FROM_NUMBER: "",
      MAKE_EMAIL_WEBHOOK_URL: "",
      MAKE_WEBHOOK_SECRET: "",
      FROM_EMAIL: "",
      REPLY_TO_EMAIL: "",
      OWNER_EMAIL: ""
    };

    const env = getEnv();

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OPENAI_MODEL).toBe("gpt-5.5");
    expect(env.OPENAI_COST_INPUT_CENTS_PER_1K).toBe(1);
    expect(env.OPENAI_COST_OUTPUT_CENTS_PER_1K).toBe(4);
    expect(env.TWILIO_PHONE_NUMBER).toBeUndefined();
    expect(env.RETELL_FROM_NUMBER).toBeUndefined();
    expect(env.MAKE_EMAIL_WEBHOOK_URL).toBeUndefined();
    expect(env.MAKE_WEBHOOK_SECRET).toBeUndefined();
    expect(env.FROM_EMAIL).toBeUndefined();
    expect(env.REPLY_TO_EMAIL).toBeUndefined();
    expect(env.OWNER_EMAIL).toBeUndefined();
  });

  it("accepts an optional owner email", () => {
    process.env = {
      ...process.env,
      OWNER_EMAIL: "michael@robur.com.au"
    };

    expect(getEnv().OWNER_EMAIL).toBe("michael@robur.com.au");
  });

  it("still rejects blank required values", () => {
    process.env = {
      ...process.env,
      SUPABASE_URL: ""
    };

    expect(() => getEnv()).toThrow("Invalid environment");
  });
});
