import { NextRequest } from "next/server";
import { requireCronAuth, withRouteErrors } from "@/src/lib/http";
import { runSelfImprover } from "@/src/lib/workers/self-improver";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withRouteErrors(async () => {
    requireCronAuth(request);
    return runSelfImprover();
  });
}
