import { hmacHex, safeEqual, sha256Hex } from "@/src/lib/crypto";
import { getEnv } from "@/src/lib/env";

export interface RetellCreatePhoneCallInput {
  toNumber: string;
  fromNumber?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
  dynamicVariables?: Record<string, unknown>;
}

export interface RetellCreatePhoneCallResponse {
  call_id: string;
  call_status: string;
  agent_id?: string;
  from_number: string;
  to_number: string;
  [key: string]: unknown;
}

export interface RetellCreateWebCallInput {
  agentId?: string;
  metadata?: Record<string, unknown>;
  dynamicVariables?: Record<string, unknown>;
}

export interface RetellCreateWebCallResponse {
  call_id: string;
  access_token: string;
  call_status?: string;
  agent_id?: string;
  [key: string]: unknown;
}

export async function createRetellPhoneCall(input: RetellCreatePhoneCallInput): Promise<RetellCreatePhoneCallResponse> {
  const env = getEnv();
  const agentId = input.agentId ?? env.RETELL_AGENT_ID;

  if (!env.RETELL_API_KEY || !agentId) {
    throw new Error("Retell credentials are not configured");
  }

  const fromNumber = input.fromNumber ?? env.RETELL_FROM_NUMBER ?? env.TWILIO_PHONE_NUMBER;
  if (!fromNumber) {
    throw new Error("Retell from_number is not configured");
  }

  const body: Record<string, unknown> = {
    from_number: fromNumber,
    to_number: input.toNumber,
    override_agent_id: agentId,
    metadata: input.metadata ?? {}
  };

  if (input.dynamicVariables) {
    body.retell_llm_dynamic_variables = input.dynamicVariables;
  }

  const response = await fetch("https://api.retellai.com/v2/create-phone-call", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RETELL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Retell create-phone-call failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return JSON.parse(text) as RetellCreatePhoneCallResponse;
}

export async function createRetellWebCall(input: RetellCreateWebCallInput): Promise<RetellCreateWebCallResponse> {
  const env = getEnv();
  const agentId = input.agentId ?? env.RETELL_AGENT_ID;

  if (!env.RETELL_API_KEY || !agentId) {
    throw new Error("Retell web-call credentials are not configured");
  }

  const body: Record<string, unknown> = {
    agent_id: agentId,
    metadata: input.metadata ?? {}
  };

  if (input.dynamicVariables) {
    body.retell_llm_dynamic_variables = input.dynamicVariables;
  }

  const response = await fetch("https://api.retellai.com/v2/create-web-call", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RETELL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Retell create-web-call failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return JSON.parse(text) as RetellCreateWebCallResponse;
}

export function verifyRetellSignature(input: {
  rawBody: string;
  apiKey: string;
  signature: string | null;
  nowMs?: number;
}): boolean {
  if (!input.signature) return false;

  const match = /^v=(\d+),d=([a-fA-F0-9]+)$/.exec(input.signature);
  if (!match) return false;

  const timestamp = Number(match[1]);
  const digest = match[2];
  const nowMs = input.nowMs ?? Date.now();

  if (!Number.isFinite(timestamp) || Math.abs(nowMs - timestamp) > 5 * 60 * 1000) {
    return false;
  }

  const expected = hmacHex("sha256", input.apiKey, `${input.rawBody}${timestamp}`);
  return safeEqual(expected, digest);
}

export function extractRetellEventId(payload: Record<string, unknown>): string {
  const explicitId = getString(payload.event_id) ?? getString(payload.id);
  const event = String(payload.event ?? "unknown");
  if (explicitId) {
    return `${event}:${explicitId}`;
  }

  const call = payload.call;
  if (call && typeof call === "object" && "call_id" in call && typeof call.call_id === "string") {
    return `${event}:${call.call_id}`;
  }

  return `${event}:body:${sha256Hex(JSON.stringify(payload))}`;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
