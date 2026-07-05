import { sha256Hex } from "@/src/lib/crypto";
import { incrementDailyMetric, logExecution, recordOutboundMessage } from "@/src/lib/db";
import { getEnv } from "@/src/lib/env";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  taskId?: number;
  metadata?: Record<string, unknown>;
  contactId?: number;
}

export async function sendEmailViaMake(input: SendEmailInput): Promise<{ messageId: string; status: string }> {
  const env = getEnv();

  if (!env.MAKE_EMAIL_WEBHOOK_URL || !env.FROM_EMAIL) {
    throw new Error("MAKE_EMAIL_WEBHOOK_URL and FROM_EMAIL are required for email sending");
  }

  const body = {
    to: input.to,
    from: env.FROM_EMAIL,
    reply_to: env.REPLY_TO_EMAIL ?? env.FROM_EMAIL,
    subject: input.subject,
    text: appendCommercialFooter(input.text),
    metadata: input.metadata ?? {}
  };

  const response = await fetch(env.MAKE_EMAIL_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  if (!response.ok) {
    await logExecution({
      taskId: input.taskId,
      actionType: "send_email",
      details: { to: input.to, subject: input.subject, provider_response: text.slice(0, 500) },
      outcome: "failure",
      errorMessage: `Make email webhook returned HTTP ${response.status}`
    });
    throw new Error(`Make email webhook failed with HTTP ${response.status}`);
  }

  await incrementDailyMetric("emails_sent");

  let parsed: { messageId?: string; id?: string; status?: string } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    parsed = { messageId: sha256Hex(`${input.to}:${input.subject}:${Date.now()}`), status: "sent" };
  }

  await recordOutboundMessage({
    taskId: input.taskId,
    contactId: input.contactId,
    channel: "email",
    provider: "make",
    providerMessageId: parsed.messageId ?? parsed.id ?? null,
    providerStatus: parsed.status ?? "sent",
    fromAddress: env.FROM_EMAIL,
    toAddress: input.to,
    subject: input.subject,
    bodyHash: sha256Hex(body.text),
    metadata: input.metadata
  });

  await logExecution({
    taskId: input.taskId,
    actionType: "send_email",
    details: {
      to: input.to,
      subject: input.subject,
      body_hash: sha256Hex(body.text),
      provider_message_id: parsed.messageId ?? parsed.id
    },
    outcome: "success"
  });

  return {
    messageId: parsed.messageId ?? parsed.id ?? "make-webhook",
    status: parsed.status ?? "sent"
  };
}

export function appendCommercialFooter(text: string): string {
  return `${text.trim()}

--
Robur Resources
To opt out of commercial messages, reply STOP or contact the sender.`;
}

export function extractMakeWebhookEventId(payload: Record<string, unknown>): string {
  const explicitId =
    getString(payload.event_id) ??
    getString(payload.provider_event_id) ??
    getString(payload.id) ??
    getString(payload.status_id) ??
    getString(payload.message_id) ??
    getString(payload.provider_message_id);
  const event = String(payload.event ?? payload.status ?? "unknown").toLowerCase();

  if (explicitId) {
    return `${event}:${explicitId}`;
  }

  return `${event}:body:${sha256Hex(JSON.stringify(payload))}`;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
