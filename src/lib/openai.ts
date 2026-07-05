import { logExecution, reconcileReservedApiSpend, reserveApiSpendBudget } from "@/src/lib/db";
import { getEnv } from "@/src/lib/env";

interface OpenAIUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: OpenAIUsage;
}

export async function createStructuredOutput<T>(input: {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  taskId?: number;
}): Promise<{ data: T; usage: OpenAIUsage; estimatedSpendCents: number }> {
  const env = getEnv();

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for LLM task generation/evaluation");
  }

  const reservedSpend = await reserveApiSpendBudget({
    taskId: input.taskId,
    actionType: "openai_response",
    estimatedSpendCents: estimateOpenAIPreflightSpendCents(input),
    details: {
      model: env.OPENAI_MODEL,
      schema_name: input.schemaName
    }
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: input.system
        },
        {
          role: "user",
          content: input.user
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: input.schema
        }
      }
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI Responses API failed with HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  const parsed = JSON.parse(raw) as OpenAIResponse;
  const outputText = extractOutputText(parsed);

  if (!outputText) {
    throw new Error("OpenAI response did not contain output text");
  }

  const usage = parsed.usage ?? {};
  const estimatedSpendCents = estimateOpenAISpendCents(usage);

  await reconcileReservedApiSpend({
    taskId: input.taskId,
    actionType: "openai_response",
    reservedSpendCents: reservedSpend.reservedSpendCents,
    actualSpendCents: estimatedSpendCents,
    details: {
      model: env.OPENAI_MODEL,
      schema_name: input.schemaName,
      usage
    }
  });

  await logExecution({
    taskId: input.taskId,
    actionType: "openai_response",
    details: {
      model: env.OPENAI_MODEL,
      schema_name: input.schemaName,
      usage
    },
    outcome: "success",
    tokensCost: usage.total_tokens ?? undefined,
    apiSpendCents: estimatedSpendCents
  });

  return {
    data: JSON.parse(outputText) as T,
    usage,
    estimatedSpendCents
  };
}

export function extractOutputText(response: OpenAIResponse): string {
  if (response.output_text) {
    return response.output_text;
  }

  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

export function estimateOpenAISpendCents(usage: OpenAIUsage): number {
  const env = getEnv();
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;

  const cents =
    (inputTokens / 1000) * env.OPENAI_COST_INPUT_CENTS_PER_1K +
    (outputTokens / 1000) * env.OPENAI_COST_OUTPUT_CENTS_PER_1K;

  return Math.max(1, Math.ceil(cents));
}

export function estimateOpenAIPreflightSpendCents(input: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}): number {
  const promptChars = input.system.length + input.user.length + JSON.stringify(input.schema).length;
  const estimatedInputTokens = Math.ceil(promptChars / 4);
  const estimatedOutputTokens = 2000;

  return estimateOpenAISpendCents({
    input_tokens: estimatedInputTokens,
    output_tokens: estimatedOutputTokens
  });
}
