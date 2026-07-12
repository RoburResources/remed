import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runMorningBriefing = vi.hoisted(() => vi.fn());
const runEveningBriefing = vi.hoisted(() => vi.fn());

vi.mock("@/src/lib/workers/briefings", () => ({
  runMorningBriefing,
  runEveningBriefing
}));

vi.mock("@/src/lib/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "cron-secret-with-length",
    DASHBOARD_API_TOKEN: "dashboard-token-with-enough-length",
    APPROVAL_SECRET: "approval-secret-with-enough-length"
  })
}));

describe("admin voice briefing route", () => {
  beforeEach(() => {
    runMorningBriefing.mockReset();
    runEveningBriefing.mockReset();
    runMorningBriefing.mockResolvedValue({ ok: true, message: "morning briefing call created." });
    runEveningBriefing.mockResolvedValue({ ok: true, message: "evening briefing call created." });
  });

  it("requires explicit owner-call confirmation", async () => {
    const { POST } = await import("@/app/api/admin/voice/briefing/route");
    const response = await POST(
      authedRequest("https://worker.test/api/admin/voice/briefing", {
        method: "POST",
        body: JSON.stringify({ type: "morning" })
      })
    );

    expect(response.status).toBe(400);
    expect(runMorningBriefing).not.toHaveBeenCalled();
  });

  it("starts the requested owner briefing", async () => {
    const { POST } = await import("@/app/api/admin/voice/briefing/route");
    const response = await POST(
      authedRequest("https://worker.test/api/admin/voice/briefing", {
        method: "POST",
        body: JSON.stringify({ type: "evening", confirmOwnerCall: true })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, type: "evening" });
    expect(runEveningBriefing).toHaveBeenCalledTimes(1);
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
