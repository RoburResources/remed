import { NextRequest } from "next/server";
import { getConfig, getRecentOpportunities, getRecentTasks, getTodayMetrics } from "@/src/lib/db";
import { requireDashboardAuth, withRouteErrors } from "@/src/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withRouteErrors(async () => {
    requireDashboardAuth(request);

    const [
      metrics,
      tasks,
      opportunities,
      killSwitch,
      systemStatus,
      externalContactEnabled,
      externalContactRequiresOwnerApproval
    ] = await Promise.all([
      getTodayMetrics(),
      getRecentTasks(100),
      getRecentOpportunities(20),
      getConfig<boolean>("kill_switch_active", true),
      getConfig<string>("system_status", "unknown"),
      getConfig<boolean>("external_contact_enabled", false),
      getConfig<boolean>("external_contact_requires_owner_approval", true)
    ]);

    const taskCounts = tasks.reduce<Record<string, number>>((acc, task) => {
      acc[task.status] = (acc[task.status] ?? 0) + 1;
      return acc;
    }, {});

    return {
      ok: true,
      system_status: systemStatus,
      kill_switch_active: killSwitch,
      external_contact_enabled: externalContactEnabled,
      external_contact_requires_owner_approval: externalContactRequiresOwnerApproval,
      daily_metrics: metrics,
      task_counts: taskCounts,
      recent_opportunities: opportunities
    };
  });
}
