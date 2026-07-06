import {
  assertDailyLimit,
  claimNextTask,
  completeTask,
  createTasks,
  expireOldApprovals,
  failTask,
  getConfig,
  incrementDailyMetric,
  isKillSwitchActive,
  logExecution,
  recordRetellCall,
  recoverStaleInProgressTasks
} from "@/src/lib/db";
import { requestTaskApproval, taskRequiresApproval } from "@/src/lib/approval";
import { assertExternalContactAllowed } from "@/src/lib/compliance";
import { sendEmailViaMake } from "@/src/lib/integrations/email";
import { createRetellPhoneCall } from "@/src/lib/integrations/retell";
import { sendSms } from "@/src/lib/integrations/twilio";
import { createStructuredOutput } from "@/src/lib/openai";
import { getEnv, getExecutiveAssistantAgentId } from "@/src/lib/env";
import { executiveAssistantDynamicVariables } from "@/src/lib/retell-personas";
import { scanAusTenderOpportunities } from "@/src/lib/scanners/austender";
import { Task, WorkerResult } from "@/src/lib/types";
import { fetchWithUrlSafety } from "@/src/lib/url-safety";

interface ResearchOutput {
  summary: string;
  recommended_next_steps: string[];
}

const researchSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    recommended_next_steps: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["summary", "recommended_next_steps"],
  additionalProperties: false
};

export async function runTaskExecutor(): Promise<WorkerResult> {
  const [expiredApprovals, recoveredTasks] = await Promise.all([
    expireOldApprovals(),
    recoverStaleInProgressTasks()
  ]);

  if (await isKillSwitchActive()) {
    return {
      ok: true,
      message: "Kill switch active; executor skipped after maintenance.",
      details: {
        expired_approvals: expiredApprovals,
        recovered_stale_tasks: recoveredTasks.length
      }
    };
  }

  const workerId = `vercel-executor-${Date.now()}`;
  const task = await claimNextTask(workerId);

  if (!task) {
    return {
      ok: true,
      message: "No pending task available.",
      details: {
        expired_approvals: expiredApprovals,
        recovered_stale_tasks: recoveredTasks.length
      }
    };
  }

  try {
    await executeTask(task);
    return {
      ok: true,
      message: `Processed task #${task.id}.`,
      details: { task_id: task.id, action_type: task.action_type }
    };
  } catch (error) {
    const err = error as Error;
    await failTask(task.id, err.message);
    await logExecution({
      taskId: task.id,
      actionType: "task_execution",
      details: { action_type: task.action_type },
      outcome: "failure",
      errorMessage: err.message
    });
    return {
      ok: false,
      message: `Task #${task.id} failed: ${err.message}`,
      details: { task_id: task.id }
    };
  }
}

async function executeTask(task: Task): Promise<void> {
  const requiresApproval = await taskRequiresApproval(task);
  if (requiresApproval) {
    await requestTaskApproval(task, "external contact or high-value action");
    return;
  }

  switch (task.action_type) {
    case "outbound_call":
      await executeOutboundCall(task);
      return;
    case "send_sms":
      await executeSms(task);
      return;
    case "send_email":
      await executeEmail(task);
      return;
    case "web_research":
      await executeWebResearch(task);
      return;
    case "opportunity_scan":
      await executeOpportunityScan(task);
      return;
    case "data_entry":
      await completeTask(task.id, "Data-entry task acknowledged; payload recorded in audit trail.", {
        ...task.metadata,
        data_entry_payload: task.action_payload
      });
      return;
    case "briefing":
      await executeBriefingTask(task);
      return;
    default:
      throw new Error(`Unsupported task action type: ${task.action_type}`);
  }
}

async function executeOutboundCall(task: Task): Promise<void> {
  await assertDailyLimit("calls_made", "max_calls_per_day");
  await assertExternalContactAllowed(task, "call");

  const toNumber = getRequiredString(task, "to_number");
  const contactId = getOptionalNumber(task, "contact_id");
  const call = await createRetellPhoneCall({
    toNumber,
    metadata: {
      task_id: task.id,
      task_description: task.description,
      ...(task.action_payload.metadata as Record<string, unknown> | undefined)
    },
    dynamicVariables: {
      task_description: task.description
    }
  });

  await incrementDailyMetric("calls_made");
  await recordRetellCall({
    taskId: task.id,
    contactId,
    callId: call.call_id,
    eventStatus: call.call_status ?? "created",
    fromNumber: call.from_number,
    toNumber: call.to_number,
    agentId: call.agent_id,
    metadata: { task_id: task.id }
  });

  await logExecution({
    taskId: task.id,
    actionType: "outbound_call_created",
    details: { call_id: call.call_id, to_number: toNumber },
    outcome: "pending"
  });
}

async function executeBriefingTask(task: Task): Promise<void> {
  await assertDailyLimit("calls_made", "max_calls_per_day");

  const toNumber = getRequiredString(task, "to_number");
  const env = getEnv();
  await assertExternalContactAllowed(task, "call");

  const call = await createRetellPhoneCall({
    toNumber,
    agentId: getExecutiveAssistantAgentId(env),
    metadata: {
      task_id: task.id,
      briefing_type: task.action_payload.briefing_type ?? "manual"
    },
    dynamicVariables: {
      ...executiveAssistantDynamicVariables,
      briefing_text: String(task.action_payload.briefing_text ?? task.description)
    }
  });

  await incrementDailyMetric("calls_made");
  await recordRetellCall({
    taskId: task.id,
    callId: call.call_id,
    eventStatus: call.call_status ?? "created",
    fromNumber: call.from_number,
    toNumber: call.to_number,
    agentId: call.agent_id,
    metadata: { briefing_type: task.action_payload.briefing_type ?? "manual" }
  });
  await completeTask(task.id, `Briefing call created via Retell: ${call.call_id}`);
}

async function executeSms(task: Task): Promise<void> {
  await assertDailyLimit("sms_sent", "max_sms_per_day");
  await assertExternalContactAllowed(task, "sms");

  const toNumber = getRequiredString(task, "to_number");
  const body = getRequiredString(task, "body");
  const contactId = getOptionalNumber(task, "contact_id");

  const result = await sendSms(toNumber, body, task.id, contactId ?? undefined);
  await completeTask(task.id, `SMS queued via Twilio: ${result.sid}`);
}

async function executeEmail(task: Task): Promise<void> {
  await assertDailyLimit("emails_sent", "max_emails_per_day");
  await assertExternalContactAllowed(task, "email");

  const to = getRequiredString(task, "to_email");
  const subject = getRequiredString(task, "subject");
  const text = getRequiredString(task, "body");
  const contactId = getOptionalNumber(task, "contact_id");

  const result = await sendEmailViaMake({
    to,
    subject,
    text,
    taskId: task.id,
    contactId: contactId ?? undefined,
    metadata: {
      source_task_id: task.id
    }
  });

  await completeTask(task.id, `Email sent via Make.com: ${result.messageId}`);
}

async function executeWebResearch(task: Task): Promise<void> {
  const url = getOptionalString(task, "url");
  const researchGoal = getOptionalString(task, "research_goal") ?? task.description;
  let sourceText = "";

  if (url) {
    const response = await fetchWithUrlSafety(url, {
      headers: {
        "User-Agent": "RoburAutonomousWorker/1.0 research"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Research fetch failed with HTTP ${response.status}`);
    }

    sourceText = stripHtml((await response.text()).slice(0, 20000));
  }

  const result = await createStructuredOutput<ResearchOutput>({
    taskId: task.id,
    schemaName: "robur_research_summary",
    schema: researchSchema,
    system: "You summarize business research for Robur Resources in Perth WA. Be factual, concise, and list next steps that do not contact external people unless compliance is satisfied.",
    user: `Research goal: ${researchGoal}\nURL: ${url ?? "none"}\nSource text:\n${sourceText || "No fetched source text supplied."}`
  });

  await completeTask(
    task.id,
    `${result.data.summary}\n\nNext steps:\n${result.data.recommended_next_steps.map((step) => `- ${step}`).join("\n")}`
  );
}

async function executeOpportunityScan(task: Task): Promise<void> {
  const scanner = await scanAusTenderOpportunities();
  const createdTasks = await createTasks(scanner.tasks);

  await completeTask(
    task.id,
    `Opportunity scan complete. New opportunities: ${scanner.opportunitiesCreated}. New follow-up tasks: ${createdTasks}.`
  );
}

function getRequiredString(task: Task, key: string): string {
  const value = task.action_payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Task #${task.id} missing action_payload.${key}`);
  }
  return value.trim();
}

function getOptionalString(task: Task, key: string): string | null {
  const value = task.action_payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getOptionalNumber(task: Task, key: string): number | null {
  const value = task.action_payload[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function stripHtml(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
