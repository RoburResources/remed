import { NextRequest } from "next/server";
import { logExecution, recordOptOutByEmail, recordWebhookEvent, updateOutboundMessageStatus } from "@/src/lib/db";
import { getEnv } from "@/src/lib/env";
import { extractMakeWebhookEventId } from "@/src/lib/integrations/email";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const env = getEnv();

  if (!env.MAKE_WEBHOOK_SECRET) {
    return Response.json({ ok: false, error: "MAKE_WEBHOOK_SECRET not configured" }, { status: 503 });
  }

  const suppliedSecret = request.headers.get("x-robur-webhook-secret");
  if (suppliedSecret !== env.MAKE_WEBHOOK_SECRET) {
    await logExecution({
      actionType: "make_email_webhook_rejected",
      details: {},
      outcome: "failure",
      errorMessage: "Invalid Make webhook secret"
    });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as {
    event_id?: string;
    provider_event_id?: string;
    id?: string;
    status_id?: string;
    message_id?: string;
    event?: string;
    provider_message_id?: string;
    status?: string;
    email?: string;
    from?: string;
    task_id?: number;
    metadata?: Record<string, unknown>;
  };

  const event = String(payload.event ?? payload.status ?? "unknown").toLowerCase();
  const email = payload.email ?? payload.from;
  const eventId = extractMakeWebhookEventId(payload as Record<string, unknown>);
  const firstProcessing = await recordWebhookEvent({
    provider: "make_email",
    eventId,
    signatureValid: true,
    payload: payload as Record<string, unknown>
  });

  if (!firstProcessing) {
    return Response.json({ ok: true, duplicate: true });
  }

  if ((event === "unsubscribe" || event === "opt_out" || event === "complaint") && email) {
    await recordOptOutByEmail(email, {
      provider: "make",
      event,
      payload
    });
  }

  if (payload.provider_message_id && payload.status) {
    await updateOutboundMessageStatus({
      provider: "make",
      providerMessageId: payload.provider_message_id,
      status: payload.status,
      metadata: payload.metadata ?? { event }
    });
  }

  await logExecution({
    taskId: payload.task_id,
    actionType: "make_email_webhook_processed",
    details: { event, provider_message_id: payload.provider_message_id ?? null, email: email ?? null },
    outcome: "success"
  });

  return Response.json({ ok: true });
}
