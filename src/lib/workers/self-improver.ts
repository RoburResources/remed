import { getRecentEvaluations, isKillSwitchActive, logExecution, setConfig } from "@/src/lib/db";
import { createStructuredOutput } from "@/src/lib/openai";
import { WorkerResult } from "@/src/lib/types";

interface ImprovementOutput {
  call_weight: number;
  email_weight: number;
  research_weight: number;
  key_insights: string[];
  safety_recommendations: string[];
}

const improvementSchema = {
  type: "object",
  properties: {
    call_weight: { type: "number", minimum: 0.5, maximum: 2 },
    email_weight: { type: "number", minimum: 0.5, maximum: 2 },
    research_weight: { type: "number", minimum: 0.5, maximum: 2 },
    key_insights: { type: "array", items: { type: "string" } },
    safety_recommendations: { type: "array", items: { type: "string" } }
  },
  required: ["call_weight", "email_weight", "research_weight", "key_insights", "safety_recommendations"],
  additionalProperties: false
};

export async function runSelfImprover(): Promise<WorkerResult> {
  if (await isKillSwitchActive()) {
    return { ok: true, message: "Kill switch active; self-improver skipped." };
  }

  const evaluations = await getRecentEvaluations(50);
  if (evaluations.length < 5) {
    return { ok: true, message: "Not enough evaluation data for self-improvement." };
  }

  const result = await createStructuredOutput<ImprovementOutput>({
    schemaName: "robur_self_improvement",
    schema: improvementSchema,
    system: "You tune prioritization weights for a safety-first autonomous business worker. Do not recommend bypassing compliance, approvals, signatures, or kill switches.",
    user: `Recent evaluations:\n${JSON.stringify(evaluations.slice(0, 50))}`
  });

  await setConfig("priority_weight_calls", clamp(result.data.call_weight), "Self-improver tuned call priority weight.");
  await setConfig("priority_weight_email", clamp(result.data.email_weight), "Self-improver tuned email priority weight.");
  await setConfig("priority_weight_research", clamp(result.data.research_weight), "Self-improver tuned research priority weight.");

  await logExecution({
    actionType: "self_improvement",
    details: result.data as unknown as Record<string, unknown>,
    outcome: "success"
  });

  return {
    ok: true,
    message: "Self-improvement weights updated.",
    details: {
      key_insights: result.data.key_insights,
      safety_recommendations: result.data.safety_recommendations
    }
  };
}

function clamp(value: number): number {
  return Math.max(0.5, Math.min(2, Number(value.toFixed(2))));
}
