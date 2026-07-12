import {
  assertDailyLimit,
  getConfig,
  getRecentOpportunities,
  getRecentTasks,
  incrementDailyMetric,
  isKillSwitchActive,
  logExecution,
  recordRetellCall
} from "@/src/lib/db";
import { getEnv, getExecutiveAssistantAgentId } from "@/src/lib/env";
import { createRetellPhoneCall } from "@/src/lib/integrations/retell";
import { executiveAssistantDynamicVariables } from "@/src/lib/retell-personas";
import { WorkerResult } from "@/src/lib/types";

export async function runMorningBriefing(): Promise<WorkerResult> {
  return runBriefing("morning");
}

export async function runEveningBriefing(): Promise<WorkerResult> {
  return runBriefing("evening");
}

async function runBriefing(type: "morning" | "evening"): Promise<WorkerResult> {
  if (await isKillSwitchActive()) {
    return { ok: true, message: "Kill switch active; briefing skipped." };
  }

  const enabled = await getConfig<boolean>("retell_briefings_enabled", true);
  if (!enabled) {
    return { ok: true, message: "Retell briefings disabled." };
  }

  await assertDailyLimit("calls_made", "max_calls_per_day");

  const env = getEnv();
  const briefingText = await buildBriefingText(type);

  const call = await createRetellPhoneCall({
    toNumber: env.OWNER_PHONE,
    agentId: getExecutiveAssistantAgentId(env),
    metadata: {
      briefing_type: type,
      owner_phone: env.OWNER_PHONE
    },
    dynamicVariables: {
      ...executiveAssistantDynamicVariables,
      briefing_type: type,
      briefing_text: briefingText
    }
  });

  await incrementDailyMetric("calls_made");
  await recordRetellCall({
    callId: call.call_id,
    eventStatus: call.call_status ?? "created",
    fromNumber: call.from_number,
    toNumber: call.to_number,
    agentId: call.agent_id,
    metadata: {
      briefing_type: type
    }
  });

  await logExecution({
    actionType: `${type}_briefing`,
    details: { call_id: call.call_id, briefing_text: briefingText.slice(0, 1000) },
    outcome: "pending"
  });

  return {
    ok: true,
    message: `${type} briefing call created.`,
    details: { call_id: call.call_id }
  };
}

async function buildBriefingText(type: "morning" | "evening"): Promise<string> {
  const tasks = await getRecentTasks(25);
  const opportunities = await getRecentOpportunities(10);
  const pending = tasks.filter((task) => task.status === "pending").slice(0, 5);
  const completed = tasks.filter((task) => task.status === "completed").slice(0, 5);
  const awaiting = tasks.filter((task) => task.status === "awaiting_approval").slice(0, 5);

  if (type === "morning") {
    return [
      "Morning briefing for Robur Resources.",
      `Top pending priorities: ${pending.map((task) => `#${task.id} ${task.description}`).join("; ") || "none"}.`,
      `Approvals awaiting Michael: ${awaiting.map((task) => `#${task.id}`).join(", ") || "none"}.`,
      `New opportunities: ${opportunities.map((opp) => `${opp.priority}: ${opp.description}`).join("; ") || "none"}.`
    ].join("\n");
  }

  return [
    "Evening summary for Robur Resources.",
    `Completed today/recently: ${completed.map((task) => `#${task.id} ${task.result_summary ?? task.description}`).join("; ") || "none"}.`,
    `Still pending: ${pending.map((task) => `#${task.id} ${task.description}`).join("; ") || "none"}.`,
    `Approvals awaiting Michael: ${awaiting.map((task) => `#${task.id}`).join(", ") || "none"}.`
  ].join("\n");
}
