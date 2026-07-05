import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/src/lib/env";

export function jsonResponse(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export function requireCronAuth(request: NextRequest): void {
  const env = getEnv();
  const authorization = request.headers.get("authorization");

  if (authorization !== `Bearer ${env.CRON_SECRET}`) {
    throw Object.assign(new Error("Unauthorized cron request"), { status: 401 });
  }
}

export function requireDashboardAuth(request: NextRequest): void {
  const env = getEnv();
  const authorization = request.headers.get("authorization");

  if (authorization !== `Bearer ${env.DASHBOARD_API_TOKEN}`) {
    throw Object.assign(new Error("Unauthorized dashboard request"), { status: 401 });
  }
}

export async function withRouteErrors<T>(handler: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await handler();
    return jsonResponse(data);
  } catch (error) {
    const err = error as Error & { status?: number };
    return jsonResponse(
      {
        ok: false,
        error: err.message
      },
      err.status ?? 500
    );
  }
}
