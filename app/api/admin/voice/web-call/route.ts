import { NextRequest } from "next/server";
import { assertDailyLimit, incrementDailyMetric, logExecution } from "@/src/lib/db";
import { getEnv, getExecutiveAssistantAgentId } from "@/src/lib/env";
import { requireDashboardAuth, withRouteErrors } from "@/src/lib/http";
import { createRetellWebCall } from "@/src/lib/integrations/retell";
import { executiveAssistantDynamicVariables } from "@/src/lib/retell-personas";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withRouteErrors(async () => {
    requireDashboardAuth(request);
    const body = (await request.json().catch(() => ({}))) as {
      confirmOwnerWebCall?: unknown;
    };

    if (body.confirmOwnerWebCall !== true) {
      throw Object.assign(new Error("confirmOwnerWebCall=true is required"), { status: 400 });
    }

    await assertDailyLimit("calls_made", "max_calls_per_day");

    const env = getEnv();
    const agentId = getExecutiveAssistantAgentId(env);
    const call = await createRetellWebCall({
      agentId,
      metadata: {
        owner_contact: true,
        interface: "browser_voice",
        requested_by: "dashboard",
        owner_email: env.OWNER_EMAIL ?? null
      },
      dynamicVariables: {
        ...executiveAssistantDynamicVariables,
        conversation_mode: "live_browser_voice",
        owner_name: "Michael",
        operator_email: env.OWNER_EMAIL ?? "",
        session_brief:
          "Michael started this live browser voice session from the secure Robur Remed console. Greet him naturally, then help with executive operations, approvals, settings, and current work status."
      }
    });

    await incrementDailyMetric("calls_made");
    await logExecution({
      actionType: "retell_web_call_created",
      details: {
        call_id: call.call_id,
        agent_id: call.agent_id ?? agentId ?? null,
        call_status: call.call_status ?? "created",
        interface: "browser_voice"
      },
      outcome: "pending"
    });

    return {
      ok: true,
      call_id: call.call_id,
      access_token: call.access_token
    };
  });
}
