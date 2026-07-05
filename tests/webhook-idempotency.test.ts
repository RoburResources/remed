import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hmacBase64, hmacHex } from "@/src/lib/crypto";
import { extractMakeWebhookEventId } from "@/src/lib/integrations/email";
import { extractRetellEventId } from "@/src/lib/integrations/retell";

const logExecution = vi.hoisted(() => vi.fn());
const recordWebhookEvent = vi.hoisted(() => vi.fn());
const recordOptOutByPhone = vi.hoisted(() => vi.fn());
const recordOptOutByEmail = vi.hoisted(() => vi.fn());
const setConfig = vi.hoisted(() => vi.fn());
const updateOutboundMessageStatus = vi.hoisted(() => vi.fn());
const updateRetellCallByCallId = vi.hoisted(() => vi.fn());
const completeTaskIfOpen = vi.hoisted(() => vi.fn());

vi.mock("@/src/lib/db", () => ({
  logExecution,
  recordWebhookEvent,
  recordOptOutByPhone,
  recordOptOutByEmail,
  setConfig,
  updateOutboundMessageStatus,
  updateRetellCallByCallId,
  completeTaskIfOpen
}));

vi.mock("@/src/lib/env", () => ({
  getEnv: () => ({
    PUBLIC_BASE_URL: "https://worker.example.com",
    TWILIO_AUTH_TOKEN: "twilio-token",
    OWNER_PHONE: "+61000000000",
    MAKE_WEBHOOK_SECRET: "make-secret-with-length",
    RETELL_API_KEY: "retell-api-key"
  })
}));

describe("webhook idempotency", () => {
  beforeEach(() => {
    recordWebhookEvent.mockReset();
    logExecution.mockReset();
    recordOptOutByPhone.mockReset();
    recordOptOutByEmail.mockReset();
    setConfig.mockReset();
    updateOutboundMessageStatus.mockReset();
    updateRetellCallByCallId.mockReset();
    completeTaskIfOpen.mockReset();
  });

  it("returns success without Twilio SMS side effects for duplicate MessageSid", async () => {
    recordWebhookEvent.mockResolvedValue(false);
    const rawBody = new URLSearchParams({
      Body: "STOP",
      From: "+61000000001",
      To: "+61000000000",
      MessageSid: "SM123"
    }).toString();
    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());
    const url = "https://worker.example.com/api/webhooks/twilio/sms";
    const payload = Object.keys(params)
      .sort()
      .reduce((acc, key) => `${acc}${key}${params[key]}`, url);
    const signature = hmacBase64("sha1", "twilio-token", payload);
    const { POST } = await import("@/app/api/webhooks/twilio/sms/route");

    const response = await POST(
      new NextRequest(url, {
        method: "POST",
        headers: {
          "x-twilio-signature": signature,
          "content-type": "application/x-www-form-urlencoded"
        },
        body: rawBody
      })
    );

    expect(response.status).toBe(200);
    expect(recordWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({
      provider: "twilio_sms",
      eventId: "SM123"
    }));
    expect(recordOptOutByPhone).not.toHaveBeenCalled();
    expect(setConfig).not.toHaveBeenCalled();
  });

  it("rejects invalid Twilio signatures before recording events", async () => {
    const { POST } = await import("@/app/api/webhooks/twilio/sms/route");
    const response = await POST(
      new NextRequest("https://worker.example.com/api/webhooks/twilio/sms", {
        method: "POST",
        headers: { "x-twilio-signature": "bad" },
        body: "Body=STATUS&From=%2B61000000000&MessageSid=SM124"
      })
    );

    expect(response.status).toBe(403);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("returns success without Make email side effects for duplicate provider events", async () => {
    recordWebhookEvent.mockResolvedValue(false);
    const { POST } = await import("@/app/api/webhooks/make/email/route");
    const response = await POST(
      new NextRequest("https://worker.example.com/api/webhooks/make/email", {
        method: "POST",
        headers: {
          "x-robur-webhook-secret": "make-secret-with-length",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          event: "unsubscribe",
          provider_message_id: "msg_123",
          email: "buyer@example.com"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, duplicate: true });
    expect(recordOptOutByEmail).not.toHaveBeenCalled();
    expect(updateOutboundMessageStatus).not.toHaveBeenCalled();
  });

  it("rejects Make email callbacks without the shared secret", async () => {
    const { POST } = await import("@/app/api/webhooks/make/email/route");
    const response = await POST(
      new NextRequest("https://worker.example.com/api/webhooks/make/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "delivered", provider_message_id: "msg_124" })
      })
    );

    expect(response.status).toBe(401);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("returns success without Retell side effects for duplicate events", async () => {
    recordWebhookEvent.mockResolvedValue(false);
    const rawBody = JSON.stringify({ event: "call_analyzed", call: { call_id: "call_123" } });
    const timestamp = Date.now();
    const signature = `v=${timestamp},d=${hmacHex("sha256", "retell-api-key", `${rawBody}${timestamp}`)}`;
    const { POST } = await import("@/app/api/webhooks/retell/route");

    const response = await POST(
      new NextRequest("https://worker.example.com/api/webhooks/retell", {
        method: "POST",
        headers: {
          "x-retell-signature": signature,
          "content-type": "application/json"
        },
        body: rawBody
      })
    );

    expect(response.status).toBe(204);
    expect(updateRetellCallByCallId).not.toHaveBeenCalled();
    expect(completeTaskIfOpen).not.toHaveBeenCalled();
  });

  it("extracts stable Make and Retell idempotency keys", () => {
    expect(extractMakeWebhookEventId({ event: "delivered", provider_message_id: "msg_1" })).toBe(
      "delivered:msg_1"
    );
    expect(extractRetellEventId({ event: "call_ended", call: { call_id: "call_1" } })).toBe("call_ended:call_1");
    expect(extractRetellEventId({ event: "unknown", sample: true })).toBe(
      extractRetellEventId({ event: "unknown", sample: true })
    );
  });
});
