import { NextRequest } from "next/server";
import { requireCronAuth, withRouteErrors } from "@/src/lib/http";
import { runEvaluator } from "@/src/lib/workers/evaluator";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withRouteErrors(async () => {
    requireCronAuth(request);
    return runEvaluator();
  });
}
