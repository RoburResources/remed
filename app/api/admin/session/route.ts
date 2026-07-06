import { NextRequest } from "next/server";
import { safeEqual } from "@/src/lib/crypto";
import {
  DASHBOARD_SESSION_COOKIE,
  clearDashboardSessionCookie,
  isValidDashboardSession,
  setDashboardSessionCookie
} from "@/src/lib/dashboard-session";
import { getEnv } from "@/src/lib/env";
import { jsonResponse } from "@/src/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const env = getEnv();
  const dashboardSession = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  return jsonResponse({
    ok: true,
    authenticated: isValidDashboardSession(dashboardSession, Date.now(), env)
  });
}

export async function POST(request: NextRequest) {
  try {
    const env = getEnv();
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";

    if (!safeEqual(token, env.DASHBOARD_API_TOKEN)) {
      return jsonResponse({ ok: false, error: "Invalid dashboard access token" }, 401);
    }

    const response = jsonResponse({ ok: true });
    setDashboardSessionCookie(response, env);
    return response;
  } catch (error) {
    const err = error as Error & { status?: number };
    return jsonResponse({ ok: false, error: err.message }, err.status ?? 500);
  }
}

export async function DELETE() {
  const response = jsonResponse({ ok: true });
  clearDashboardSessionCookie(response);
  return response;
}
