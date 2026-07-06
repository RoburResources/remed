import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/src/lib/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "cron-secret-with-length",
    DASHBOARD_API_TOKEN: "dashboard-token-with-enough-length",
    APPROVAL_SECRET: "approval-secret-with-enough-length"
  })
}));

describe("route bearer authentication", () => {
  it("requires cron bearer auth", async () => {
    const { requireCronAuth } = await import("@/src/lib/http");
    expect(() => requireCronAuth(new NextRequest("https://worker.test/api/cron/task-executor"))).toThrow("Unauthorized");
    expect(() =>
      requireCronAuth(
        new NextRequest("https://worker.test/api/cron/task-executor", {
          headers: { authorization: "Bearer cron-secret-with-length" }
        })
      )
    ).not.toThrow();
  });

  it("requires dashboard bearer auth", async () => {
    const { requireDashboardAuth } = await import("@/src/lib/http");
    expect(() => requireDashboardAuth(new NextRequest("https://worker.test/api/admin/status"))).toThrow("Unauthorized");
    expect(() =>
      requireDashboardAuth(
        new NextRequest("https://worker.test/api/admin/status", {
          headers: { authorization: "Bearer dashboard-token-with-enough-length" }
        })
      )
    ).not.toThrow();
  });

  it("accepts a signed dashboard session cookie", async () => {
    const { DASHBOARD_SESSION_COOKIE, createDashboardSessionValue } = await import("@/src/lib/dashboard-session");
    const { requireDashboardAuth } = await import("@/src/lib/http");
    const session = createDashboardSessionValue(Date.now());

    expect(() =>
      requireDashboardAuth(
        new NextRequest("https://worker.test/api/admin/status", {
          headers: { cookie: `${DASHBOARD_SESSION_COOKIE}=${session}` }
        })
      )
    ).not.toThrow();
  });

  it("rejects an invalid dashboard session cookie", async () => {
    const { DASHBOARD_SESSION_COOKIE } = await import("@/src/lib/dashboard-session");
    const { requireDashboardAuth } = await import("@/src/lib/http");

    expect(() =>
      requireDashboardAuth(
        new NextRequest("https://worker.test/api/admin/status", {
          headers: { cookie: `${DASHBOARD_SESSION_COOKIE}=invalid` }
        })
      )
    ).toThrow("Unauthorized");
  });
});
