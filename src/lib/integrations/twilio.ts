import { hmacBase64, safeEqual, sha256Hex } from "@/src/lib/crypto";
import { getEnv, hasTwilioCredentials } from "@/src/lib/env";
import { incrementDailyMetric, logExecution, recordOutboundMessage } from "@/src/lib/db";

export interface InboundSms {
  from: string;
  to: string;
  body: string;
  messageSid: string;
}

export function parseFormEncoded(rawBody: string): Record<string, string> {
  const params = new URLSearchParams(rawBody);
  const output: Record<string, string> = {};

  for (const [key, value] of params.entries()) {
    output[key] = value;
  }

  return output;
}

export function verifyTwilioSignature(input: {
  url: string;
  params: Record<string, string>;
  authToken: string;
  signature: string | null;
}): boolean {
  if (!input.signature) return false;

  const payload = Object.keys(input.params)
    .sort()
    .reduce((acc, key) => `${acc}${key}${input.params[key]}`, input.url);

  const expected = hmacBase64("sha1", input.authToken, payload);
  return safeEqual(expected, input.signature);
}

export function parseInboundSms(params: Record<string, string>): InboundSms {
  return {
    from: params.From ?? "",
    to: params.To ?? "",
    body: (params.Body ?? "").trim(),
    messageSid: params.MessageSid ?? params.SmsMessageSid ?? ""
  };
}

export async function sendSms(to: string, body: string, taskId?: number, contactId?: number): Promise<{ sid: string; status: string }> {
  const env = getEnv();

  if (!hasTwilioCredentials(env)) {
    throw new Error("Twilio credentials are not configured");
  }

  await incrementDailyMetric("sms_sent", 0);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      To: to,
      From: env.TWILIO_PHONE_NUMBER ?? "",
      Body: body
    }).toString()
  });

  const text = await response.text();

  if (!response.ok) {
    await logExecution({
      taskId,
      actionType: "send_sms",
      details: { to, body_hash: sha256Hex(body), provider_response: text },
      outcome: "failure",
      errorMessage: `Twilio returned HTTP ${response.status}`
    });
    throw new Error(`Twilio SMS failed with HTTP ${response.status}`);
  }

  const data = JSON.parse(text) as { sid?: string; status?: string };
  await incrementDailyMetric("sms_sent");

  await recordOutboundMessage({
    taskId,
    contactId,
    channel: "sms",
    provider: "twilio",
    providerMessageId: data.sid ?? null,
    providerStatus: data.status ?? "queued",
    fromAddress: env.TWILIO_PHONE_NUMBER,
    toAddress: to,
    bodyHash: sha256Hex(body)
  });

  await logExecution({
    taskId,
    actionType: "send_sms",
    details: { to, body_hash: sha256Hex(body), sid: data.sid, status: data.status },
    outcome: "success"
  });

  return {
    sid: data.sid ?? "unknown",
    status: data.status ?? "queued"
  };
}
