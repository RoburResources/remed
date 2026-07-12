import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const assertDailyLimit = vi.hoisted(() => vi.fn());
const incrementDailyMetric = vi.hoisted(() => vi.fn());
const logExecution = vi.hoisted(() => vi.fn());
const createRetellWebCall = vi.hoisted(() => vi.fn());

const mockEnv = {
  CRON_SECRET: "cron-secret-with-length",
  DASHBOARD_API_TOKEN: "dashboard-token-with-enough-length",
  APPROVAL_SECRET: "approval-secret-with-enough-length",
  OWNER_EMAIL: "michael@robur.com.au",
  RETELL_API_KEY: "retell-key",
  RETELL_EXECUTIVE_ASSISTANT_AGENT_ID: "agent-executive"
};

vi.mock("@/src/lib/db", () => ({
  assertDailyLimit,
  incrementDailyMetric,
  logExecution
}));

vi.mock("@/src/lib/env", () => ({
  getEnv: () => mockEnv,
  getExecutiveAssistantAgentId: (env = mockEnv) => env.RETELL_EXECUTIVE_ASSISTANT_AGENT_ID
}));

vi.mock("@/src/lib/integrations/retell", () => ({
  createRetellWebCall
}));

describe("admin browser voice route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    assertDailyLimit.mockResolvedValue(undefined);
    incrementDailyMetric.mockResolvedValue(undefined);
    logExecution.mockResolvedValue(undefined);
    createRetellWebCall.mockResolvedValue({
      call_id: "call_web_123",
      access_token: "short-lived-access-token",
      call_status: "registered",
      agent_id: "agent-executive"
    });
  });

  it("requires explicit owner web-call confirmation", async () => {
    const { POST } = await import("@/app/api/admin/voice/web-call/route");
    const response = await POST(
      authedRequest("https://worker.test/api/admin/voice/web-call", {
        method: "POST",
        body: JSON.stringify({})
      })
    );

    expect(response.status).toBe(400);
    expect(createRetellWebCall).not.toHaveBeenCalled();
  });

  it("creates a protected owner browser voice session", async () => {
    const { POST } = await import("@/app/api/admin/voice/web-call/route");
    const response = await POST(
      authedRequest("https://worker.test/api/admin/voice/web-call", {
        method: "POST",
        body: JSON.stringify({ confirmOwnerWebCall: true })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      call_id: "call_web_123",
      access_token: "short-lived-access-token"
    });
    expect(assertDailyLimit).toHaveBeenCalledWith("calls_made", "max_calls_per_day");
    expect(createRetellWebCall).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-executive",
        metadata: expect.objectContaining({
          owner_contact: true,
          interface: "browser_voice",
          requested_by: "dashboard",
          owner_email: "michael@robur.com.au"
        }),
        dynamicVariables: expect.objectContaining({
          conversation_mode: "live_browser_voice",
          owner_name: "Michael"
        })
      })
    );
    expect(incrementDailyMetric).toHaveBeenCalledWith("calls_made");
    expect(logExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "retell_web_call_created",
        details: expect.objectContaining({ call_id: "call_web_123", interface: "browser_voice" }),
        outcome: "pending"
      })
    );
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
