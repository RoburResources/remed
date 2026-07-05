import {
  createEvaluation,
  getCompletedTasksWithoutEvaluation,
  getRecentTasks,
  isKillSwitchActive,
  logExecution
} from "@/src/lib/db";
import { createStructuredOutput } from "@/src/lib/openai";
import { Task, WorkerResult } from "@/src/lib/types";

interface EvaluationOutput {
  success: "true" | "false" | "partial";
  lesson_learned: string;
  strategy_used: string;
  improvement_suggestion: string;
  brief_summary: string;
}

const evaluationSchema = {
  type: "object",
  properties: {
    success: { type: "string", enum: ["true", "false", "partial"] },
    lesson_learned: { type: "string" },
    strategy_used: { type: "string" },
    improvement_suggestion: { type: "string" },
    brief_summary: { type: "string" }
  },
  required: ["success", "lesson_learned", "strategy_used", "improvement_suggestion", "brief_summary"],
  additionalProperties: false
};

export async function runEvaluator(): Promise<WorkerResult> {
  if (await isKillSwitchActive()) {
    return { ok: true, message: "Kill switch active; evaluator skipped." };
  }

  const tasks = await getCompletedTasksWithoutEvaluation(50);
  let evaluated = 0;

  for (const task of tasks) {
    const evaluation = await evaluateTask(task);
    await createEvaluation({
      taskId: task.id,
      success: evaluation.success,
      lessonLearned: evaluation.lesson_learned,
      strategyUsed: evaluation.strategy_used,
      improvementSuggestion: evaluation.improvement_suggestion
    });
    evaluated += 1;
  }

  const recentTasks = await getRecentTasks(100);
  const completed = recentTasks.filter((task) => task.status === "completed").length;
  const failed = recentTasks.filter((task) => task.status === "failed").length;
  const successRate = completed + failed > 0 ? completed / (completed + failed) : null;

  await logExecution({
    actionType: "daily_evaluation",
    details: { evaluated, success_rate: successRate },
    outcome: "success"
  });

  return {
    ok: true,
    message: `Evaluated ${evaluated} completed task(s).`,
    details: { evaluated, success_rate: successRate ?? "n/a" }
  };
}

async function evaluateTask(task: Task): Promise<EvaluationOutput> {
  if (task.action_type === "outbound_call" && !task.result_summary?.toLowerCase().includes("call")) {
    return {
      success: "partial",
      lesson_learned: "Outbound call task completed without strong provider outcome detail.",
      strategy_used: task.action_type,
      improvement_suggestion: "Wait for Retell call_analyzed payload before considering call tasks truly successful.",
      brief_summary: task.result_summary ?? task.description
    };
  }

  const result = await createStructuredOutput<EvaluationOutput>({
    taskId: task.id,
    schemaName: "robur_task_evaluation",
    schema: evaluationSchema,
    system: "Evaluate Robur Resources autonomous worker outcomes. Mark success true only when the task produced a concrete, auditable result. Use partial when work happened but business outcome is not proven.",
    user: `Task #${task.id}\nAction: ${task.action_type}\nDescription: ${task.description}\nResult: ${task.result_summary ?? "No result summary"}\nMetadata: ${JSON.stringify(task.metadata)}`
  });

  return result.data;
}
