import { NextRequest } from "next/server";
import { getRecentTasks } from "@/src/lib/db";
import { requireDashboardAuth, withRouteErrors } from "@/src/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withRouteErrors(async () => {
    requireDashboardAuth(request);

    const limitParam = new URL(request.url).searchParams.get("limit");
    const limit = Math.min(250, Math.max(1, Number(limitParam ?? 100) || 100));

    return {
      ok: true,
      tasks: await getRecentTasks(limit)
    };
  });
}
