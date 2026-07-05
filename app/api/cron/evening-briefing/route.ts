import { NextRequest } from "next/server";
import { requireCronAuth, withRouteErrors } from "@/src/lib/http";
import { runEveningBriefing } from "@/src/lib/workers/briefings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withRouteErrors(async () => {
    requireCronAuth(request);
    return runEveningBriefing();
  });
}
