import { createPolicyChangeRequest, getRecentEvaluations, isKillSwitchActive, logExecution, setConfig } from "@/src/lib/db";
import { createStructuredOutput } from "@/src/lib/openai";
import { isProtectedPolicyKey, redactSensitiveText } from "@/src/lib/policy";
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

  const applied = await applySelfImprovementConfigUpdates([
    {
      key: "priority_weight_calls",
      value: clamp(result.data.call_weight),
      description: "Self-improver tuned call priority weight."
    },
    {
      key: "priority_weight_email",
      value: clamp(result.data.email_weight),
      description: "Self-improver tuned email priority weight."
    },
    {
      key: "priority_weight_research",
      value: clamp(result.data.research_weight),
      description: "Self-improver tuned research priority weight."
    }
  ]);

  await logExecution({
    actionType: "self_improvement",
    details: result.data as unknown as Record<string, unknown>,
    outcome: "success"
  });

  return {
    ok: true,
    message: "Self-improvement weights updated.",
    details: {
      applied_config_updates: applied.applied,
      proposed_policy_changes: applied.proposed,
      key_insights: result.data.key_insights,
      safety_recommendations: result.data.safety_recommendations
    }
  };
}

export async function applySelfImprovementConfigUpdates(
  updates: Array<{ key: string; value: unknown; description?: string }>
): Promise<{ applied: string[]; proposed: string[] }> {
  const applied: string[] = [];
  const proposed: string[] = [];

  for (const update of updates) {
    if (isProtectedPolicyKey(update.key)) {
      const proposal = await createPolicyChangeRequest({
        requestedBy: "self_improver",
        requestSource: "self_improver",
        requestText: `Self-improver proposed changing ${update.key}`,
        riskLevel: "high",
        protectedPolicyKeys: [update.key],
        proposedChangeSummary: `Self-improver proposed a protected policy change for ${update.key}. It was not applied.`,
        proposedDiffOrConfig: {
          key: update.key,
          proposed_value: redactSensitiveText(String(update.value))
        },
        auditMetadata: {
          blocked_by: "protected_policy_guard"
        }
      });

      proposed.push(String(proposal.id));
      await logExecution({
        actionType: "self_improvement_policy_change_blocked",
        details: { key: update.key, policy_change_request_id: proposal.id },
        outcome: "partial"
      });
      continue;
    }

    await setConfig(update.key, update.value, update.description);
    applied.push(update.key);
  }

  return { applied, proposed };
}

function clamp(value: number): number {
  return Math.max(0.5, Math.min(2, Number(value.toFixed(2))));
}
