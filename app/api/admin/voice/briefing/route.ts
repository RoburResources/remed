import { NextRequest } from "next/server";
import { requireDashboardAuth, withRouteErrors } from "@/src/lib/http";
import { runEveningBriefing, runMorningBriefing } from "@/src/lib/workers/briefings";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withRouteErrors(async () => {
    requireDashboardAuth(request);
    const body = (await request.json().catch(() => ({}))) as {
      type?: unknown;
      confirmOwnerCall?: unknown;
    };

    if (body.confirmOwnerCall !== true) {
      throw Object.assign(new Error("confirmOwnerCall=true is required"), { status: 400 });
    }

    const type = body.type === "evening" ? "evening" : "morning";
    const result = type === "evening" ? await runEveningBriefing() : await runMorningBriefing();

    return {
      ok: result.ok,
      type,
      message: result.message,
      details: result.details ?? {}
    };
  });
}
