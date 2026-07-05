import { createTasks, getActiveGoals, getConfig, getRecentTasks, isKillSwitchActive, logExecution } from "@/src/lib/db";
import { createStructuredOutput } from "@/src/lib/openai";
import { scanAusTenderOpportunities } from "@/src/lib/scanners/austender";
import { GeneratedTask, WorkerResult } from "@/src/lib/types";

interface TaskGenerationOutput {
  tasks: GeneratedTask[];
}

const taskGenerationSchema = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          goal_id: { type: ["number", "null"] },
          source: { type: "string" },
          description: { type: "string" },
          priority_score: { type: "number", minimum: 0, maximum: 100 },
          action_type: {
            type: "string",
            enum: ["outbound_call", "send_email", "send_sms", "web_research", "data_entry", "opportunity_scan", "briefing"]
          },
          action_payload: { type: "object", additionalProperties: true },
          metadata: { type: "object", additionalProperties: true },
          estimated_value: { type: "number" },
          external_contact: { type: "boolean" }
        },
        required: [
          "goal_id",
          "source",
          "description",
          "priority_score",
          "action_type",
          "action_payload",
          "metadata",
          "estimated_value",
          "external_contact"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["tasks"],
  additionalProperties: false
};

export async function runTaskGenerator(): Promise<WorkerResult> {
  const started = Date.now();

  if (await isKillSwitchActive()) {
    return { ok: true, message: "Kill switch active; generation skipped." };
  }

  const goals = await getActiveGoals();
  if (goals.length === 0) {
    return { ok: true, message: "No active goals." };
  }

  const recentTasks = await getRecentTasks(120);
  const pendingCount = recentTasks.filter((task) => task.status === "pending").length;
  if (pendingCount >= 30) {
    return { ok: true, message: `Queue already has ${pendingCount} pending tasks; generation skipped.` };
  }

  const maxTasks = await getConfig<number>("max_tasks_per_generation_cycle", 5);
  const minInternalRatio = await getConfig<number>("min_internal_task_ratio", 0.6);

  const scanner = await scanAusTenderOpportunities().catch(async (error: Error) => {
    await logExecution({
      actionType: "opportunity_scan",
      details: { scanner: "austender" },
      outcome: "failure",
      errorMessage: error.message
    });
    return { opportunitiesCreated: 0, tasks: [] };
  });

  const goalContext = goals
    .map((goal) => `#${goal.id} priority ${goal.priority}: ${goal.goal_text}`)
    .join("\n");

  const recentContext = recentTasks
    .slice(0, 40)
    .map((task) => `#${task.id} [${task.status}] ${task.action_type}: ${task.description}`)
    .join("\n");

  const llm = await createStructuredOutput<TaskGenerationOutput>({
    schemaName: "robur_task_generation",
    schema: taskGenerationSchema,
    system: `You generate safe, high-ROI internal tasks for Robur Resources in Perth WA.
Generate at most ${maxTasks} tasks.
At least ${Math.ceil(maxTasks * minInternalRatio)} tasks must be internal: web_research, data_entry, or opportunity_scan.
Do not create external-contact tasks unless the task explicitly includes contact_id and consent proof requirements in metadata.
Prioritize building supplier/buyer databases, AusTender monitoring, compliance preparation, and broker revenue analysis.`,
    user: `Active goals:\n${goalContext}\n\nRecent tasks to avoid duplicates:\n${recentContext}`,
  });

  const generatedTasks = normalizeGeneratedTasks(llm.data.tasks, maxTasks);
  const allTasks = [...scanner.tasks, ...generatedTasks].slice(0, maxTasks);
  const created = await createTasks(allTasks);

  await logExecution({
    actionType: "task_generation",
    details: {
      tasks_created: created,
      generated_candidates: generatedTasks.length,
      scanner_opportunities_created: scanner.opportunitiesCreated,
      duration_ms: Date.now() - started
    },
    outcome: "success",
    durationMs: Date.now() - started
  });

  return {
    ok: true,
    message: `Created ${created} task(s).`,
    details: {
      created,
      scanner_opportunities_created: scanner.opportunitiesCreated
    }
  };
}

function normalizeGeneratedTasks(tasks: GeneratedTask[], maxTasks: number): GeneratedTask[] {
  return tasks.slice(0, maxTasks).map((task) => ({
    ...task,
    source: task.source || "task_generator",
    priority_score: Math.max(0, Math.min(100, Number(task.priority_score))),
    estimated_value: Math.max(0, Number(task.estimated_value ?? 0)),
    external_contact: Boolean(task.external_contact),
    action_payload: task.action_payload ?? {},
    metadata: {
      ...(task.metadata ?? {}),
      generated_by: "openai_responses"
    }
  }));
}
