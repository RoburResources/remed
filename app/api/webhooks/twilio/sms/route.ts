import { NextRequest } from "next/server";
import { parseApprovalCommand, resolveApprovalCommand } from "@/src/lib/approval";
import { logExecution, recordOptOutByPhone, recordWebhookEvent, setConfig } from "@/src/lib/db";
import { getEnv } from "@/src/lib/env";
import { parseFormEncoded, parseInboundSms, sendSms, verifyTwilioSignature } from "@/src/lib/integrations/twilio";
import { sha256Hex } from "@/src/lib/crypto";

export const dynamic = "force-dynamic";

const OPT_OUT_COMMANDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);

export async function POST(request: NextRequest): Promise<Response> {
  const rawBody = await request.text();
  const params = parseFormEncoded(rawBody);
  const env = getEnv();
  const canonicalUrl = canonicalWebhookUrl(request.url, env.PUBLIC_BASE_URL);
  const signature = request.headers.get("x-twilio-signature");

  if (!env.TWILIO_AUTH_TOKEN) {
    await logExecution({
      actionType: "twilio_webhook_rejected",
      details: { canonical_url: canonicalUrl },
      outcome: "failure",
      errorMessage: "Twilio auth token is not configured"
    });
    return new Response("<Response></Response>", { status: 503, headers: twimlHeaders() });
  }

  const signatureValid = verifyTwilioSignature({
    url: canonicalUrl,
    params,
    authToken: env.TWILIO_AUTH_TOKEN,
    signature
  });

  if (!signatureValid) {
    await logExecution({
      actionType: "twilio_webhook_rejected",
      details: { canonical_url: canonicalUrl, from: params.From ?? null },
      outcome: "failure",
      errorMessage: "Invalid Twilio signature"
    });
    return new Response("<Response></Response>", { status: 403, headers: twimlHeaders() });
  }

  const sms = parseInboundSms(params);
  const upper = sms.body.toUpperCase().trim();
  const eventId = sms.messageSid || `body:${sha256Hex(rawBody)}`;
  const firstProcessing = await recordWebhookEvent({
    provider: "twilio_sms",
    eventId,
    signatureValid,
    payload: params
  });

  if (!firstProcessing) {
    return emptyTwiml();
  }

  await logExecution({
    actionType: "inbound_sms",
    details: { from: sms.from, to: sms.to, message_sid: sms.messageSid, body: sms.body },
    outcome: "success"
  });

  if (OPT_OUT_COMMANDS.has(upper)) {
    if (sms.from === env.OWNER_PHONE) {
      await setConfig("kill_switch_active", true, "Kill switch activated by owner SMS STOP.");
      await setConfig("system_status", "paused", "Paused by owner STOP command.");
      await sendSms(env.OWNER_PHONE, "[Robur AI] Autonomous operations STOPPED. Send START to resume.");
      return emptyTwiml();
    }

    await recordOptOutByPhone(sms.from, {
      provider: "twilio",
      message_sid: sms.messageSid,
      command: upper
    });
    return emptyTwiml();
  }

  if (sms.from !== env.OWNER_PHONE) {
    await logExecution({
      actionType: "inbound_sms_non_owner",
      details: { from: sms.from, command: upper },
      outcome: "partial"
    });
    return emptyTwiml();
  }

  if (upper === "START") {
    await setConfig("kill_switch_active", false, "Kill switch deactivated by owner SMS START.");
    await setConfig("system_status", "active", "Resumed by owner START command.");
    await sendSms(env.OWNER_PHONE, "[Robur AI] Autonomous operations RESUMED.");
    return emptyTwiml();
  }

  if (upper === "STATUS") {
    await sendSms(env.OWNER_PHONE, "[Robur AI] Status command received. Use /api/admin/status for full protected status.");
    return emptyTwiml();
  }

  const approval = parseApprovalCommand(sms.body);
  if (approval) {
    const message = await resolveApprovalCommand(approval, sms.from);
    await sendSms(env.OWNER_PHONE, `[Robur AI] ${message}`);
    return emptyTwiml();
  }

  await sendSms(
    env.OWNER_PHONE,
    "[Robur AI] Unknown command. Valid commands: STOP, START, STATUS, APPROVE #<task_id> <nonce>, REJECT #<task_id> <nonce>."
  );
  return emptyTwiml();
}

function canonicalWebhookUrl(requestUrl: string, publicBaseUrl: string): string {
  const incoming = new URL(requestUrl);
  const base = new URL(publicBaseUrl);
  return `${base.origin}${incoming.pathname}${incoming.search}`;
}

function emptyTwiml(): Response {
  return new Response("<Response></Response>", { status: 200, headers: twimlHeaders() });
}

function twimlHeaders(): HeadersInit {
  return {
    "Content-Type": "text/xml; charset=utf-8",
    "Cache-Control": "no-store"
  };
}
