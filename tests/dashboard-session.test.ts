import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/lib/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "cron-secret-with-length",
    DASHBOARD_API_TOKEN: "dashboard-token-with-enough-length",
    APPROVAL_SECRET: "approval-secret-with-enough-length",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key-with-enough-length",
    PUBLIC_BASE_URL: "https://worker.test",
    OWNER_PHONE: "+15551234567"
  })
}));

describe("dashboard browser session", () => {
  it("creates and clears a secure dashboard session cookie", async () => {
    const { DASHBOARD_SESSION_COOKIE } = await import("@/src/lib/dashboard-session");
    const { POST, DELETE, GET } = await import("@/app/api/admin/session/route");

    const locked = await GET(new NextRequest("https://worker.test/api/admin/session"));
    await expect(locked.json()).resolves.toMatchObject({ ok: true, authenticated: false });

    const denied = await POST(
      new NextRequest("https://worker.test/api/admin/session", {
        method: "POST",
        body: JSON.stringify({ token: "wrong-token" })
      })
    );
    expect(denied.status).toBe(401);

    const allowed = await POST(
      new NextRequest("https://worker.test/api/admin/session", {
        method: "POST",
        body: JSON.stringify({ token: "dashboard-token-with-enough-length" })
      })
    );

    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("set-cookie")).toContain(DASHBOARD_SESSION_COOKIE);
    expect(allowed.headers.get("set-cookie")).not.toContain("dashboard-token-with-enough-length");

    const cleared = await DELETE();
    expect(cleared.headers.get("set-cookie")).toContain(`${DASHBOARD_SESSION_COOKIE}=`);
    expect(cleared.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
