import { NextRequest } from "next/server";
import { completeTaskIfOpen, logExecution, recordWebhookEvent, updateRetellCallByCallId } from "@/src/lib/db";
import { getEnv } from "@/src/lib/env";
import { extractRetellEventId, verifyRetellSignature } from "@/src/lib/integrations/retell";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const rawBody = await request.text();
  const env = getEnv();
  const signature = request.headers.get("x-retell-signature");

  if (!env.RETELL_API_KEY) {
    await logExecution({
      actionType: "retell_webhook_rejected",
      details: {},
      outcome: "failure",
      errorMessage: "Retell API key is not configured"
    });
    return new Response(null, { status: 503 });
  }

  const signatureValid = verifyRetellSignature({
    rawBody,
    apiKey: env.RETELL_API_KEY,
    signature
  });

  if (!signatureValid) {
    await logExecution({
      actionType: "retell_webhook_rejected",
      details: {},
      outcome: "failure",
      errorMessage: "Invalid Retell signature"
    });
    return new Response(null, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const eventId = extractRetellEventId(payload);
  const firstProcessing = await recordWebhookEvent({
    provider: "retell",
    eventId,
    signatureValid,
    payload
  });

  if (!firstProcessing) {
    return new Response(null, { status: 204 });
  }

  const event = String(payload.event ?? "unknown");
  const call = payload.call as Record<string, unknown> | undefined;

  if (!call || typeof call.call_id !== "string") {
    await logExecution({
      actionType: "retell_webhook_ignored",
      details: { event },
      outcome: "partial",
      errorMessage: "Webhook missing call.call_id"
    });
    return new Response(null, { status: 204 });
  }

  const callId = call.call_id;
  const transcript = typeof call.transcript === "string" ? call.transcript : null;
  const callAnalysis =
    call.call_analysis && typeof call.call_analysis === "object"
      ? (call.call_analysis as Record<string, unknown>)
      : null;

  const { taskId } = await updateRetellCallByCallId({
    callId,
    eventStatus: event,
    transcript,
    callAnalysis,
    endedAt: event.includes("ended") || event.includes("analyzed") ? new Date().toISOString() : null,
    metadata: {
      latest_event: event,
      disconnection_reason: call.disconnection_reason ?? null,
      call_status: call.call_status ?? null
    }
  });

  if (taskId && (event === "call_ended" || event === "call_analyzed")) {
    const summary = buildCallSummary(event, callId, transcript, callAnalysis);
    await completeTaskIfOpen(taskId, summary, {
      retell_call_id: callId,
      retell_event: event,
      call_analysis: callAnalysis
    });
  }

  await logExecution({
    taskId: taskId ?? undefined,
    actionType: "retell_webhook_processed",
    details: { event, call_id: callId },
    outcome: "success"
  });

  return new Response(null, { status: 204 });
}

function buildCallSummary(
  event: string,
  callId: string,
  transcript: string | null,
  callAnalysis: Record<string, unknown> | null
): string {
  const outcome =
    typeof callAnalysis?.call_successful === "boolean"
      ? `Call successful: ${callAnalysis.call_successful}`
      : "Call completed; analysis unavailable.";

  return `Retell ${event} received for call ${callId}. ${outcome}${transcript ? ` Transcript captured (${transcript.length} chars).` : ""}`;
}
