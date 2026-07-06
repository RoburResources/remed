import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const getConfig = vi.hoisted(() => vi.fn());
const setConfig = vi.hoisted(() => vi.fn());
const logExecution = vi.hoisted(() => vi.fn());

vi.mock("@/src/lib/db", () => ({
  getConfig,
  setConfig,
  logExecution
}));

vi.mock("@/src/lib/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "cron-secret-with-length",
    DASHBOARD_API_TOKEN: "dashboard-token-with-enough-length",
    APPROVAL_SECRET: "approval-secret-with-enough-length",
    OWNER_PHONE: "+61400000000",
    OWNER_EMAIL: "michael@robur.com.au",
    RETELL_API_KEY: "retell-key",
    RETELL_AGENT_ID: "agent-id",
    RETELL_FROM_NUMBER: "+61411111111"
  }),
  hasRetellCredentials: () => true
}));

describe("admin settings route", () => {
  beforeEach(() => {
    getConfig.mockReset();
    setConfig.mockReset();
    logExecution.mockReset();
    getConfig.mockImplementation(async (key: string, fallback: unknown) => {
      const values: Record<string, unknown> = {
        retell_briefings_enabled: true,
        max_calls_per_day: 20,
        max_sms_per_day: 100,
        max_emails_per_day: 100,
        max_api_spend_cents_per_day: 5000
      };
      return values[key] ?? fallback;
    });
  });

  it("returns voice and limit settings behind dashboard auth", async () => {
    const { GET } = await import("@/app/api/admin/settings/route");
    const response = await GET(authedRequest("https://worker.test/api/admin/settings"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.voice).toMatchObject({
      retell_configured: true,
      owner_phone_configured: true,
      owner_email_configured: true
    });
    expect(body.limits.max_calls_per_day).toBe(20);
  });

  it("updates safe settings and rejects out-of-range limits", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/route");

    const saved = await PATCH(
      authedRequest("https://worker.test/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({
          retell_briefings_enabled: false,
          max_calls_per_day: 10
        })
      })
    );

    expect(saved.status).toBe(200);
    expect(setConfig).toHaveBeenCalledWith("retell_briefings_enabled", false, expect.any(String));
    expect(setConfig).toHaveBeenCalledWith("max_calls_per_day", 10, expect.any(String));

    const rejected = await PATCH(
      authedRequest("https://worker.test/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ max_calls_per_day: 21 })
      })
    );

    expect(rejected.status).toBe(400);
  });
});

function authedRequest(
  url: string,
  init: {
    method?: string;
    body?: BodyInit | null;
    headers?: HeadersInit;
  } = {}
) {
  return new NextRequest(url, {
    method: init.method,
    body: init.body,
    headers: {
      authorization: "Bearer dashboard-token-with-enough-length",
      ...(init.headers ?? {})
    }
  });
}
