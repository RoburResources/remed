import { NextRequest } from "next/server";
import { requireCronAuth, withRouteErrors } from "@/src/lib/http";
import { runTaskExecutor } from "@/src/lib/workers/task-executor";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withRouteErrors(async () => {
    requireCronAuth(request);
    return runTaskExecutor();
  });
}
