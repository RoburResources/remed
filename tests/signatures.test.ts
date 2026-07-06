import { describe, expect, it } from "vitest";
import { hmacBase64, hmacHex } from "@/src/lib/crypto";
import { verifyRetellSignature } from "@/src/lib/integrations/retell";
import { verifyTwilioSignature } from "@/src/lib/integrations/twilio";

describe("webhook signature verification", () => {
  it("verifies Retell raw-body signatures", () => {
    const rawBody = JSON.stringify({ event: "call_analyzed", call: { call_id: "call_123" } });
    const apiKey = "key_test";
    const timestamp = Date.now();
    const digest = hmacHex("sha256", apiKey, `${rawBody}${timestamp}`);

    expect(
      verifyRetellSignature({
        rawBody,
        apiKey,
        signature: `v=${timestamp},d=${digest}`,
        nowMs: timestamp
      })
    ).toBe(true);

    expect(
      verifyRetellSignature({
        rawBody: `${rawBody} `,
        apiKey,
        signature: `v=${timestamp},d=${digest}`,
        nowMs: timestamp
      })
    ).toBe(false);
  });

  it("verifies Twilio form signatures", () => {
    const url = "https://worker.example.com/api/webhooks/twilio/sms";
    const params = {
      Body: "STATUS",
      From: "+61000000000",
      MessageSid: "SM123",
      To: "+61000000000"
    };
    const twilioAuth = "auth_token";
    const payload = Object.keys(params)
      .sort()
      .reduce((acc, key) => `${acc}${key}${params[key as keyof typeof params]}`, url);
    const signature = hmacBase64("sha1", twilioAuth, payload);

    expect(verifyTwilioSignature({ url, params, authToken: twilioAuth, signature })).toBe(true);
    expect(verifyTwilioSignature({ url, params, authToken: "wrong", signature })).toBe(false);
  });
});
