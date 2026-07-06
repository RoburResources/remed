import { describe, expect, it, vi } from "vitest";
import { Task } from "@/src/lib/types";

const getConfig = vi.hoisted(() => vi.fn());
const getContactById = vi.hoisted(() => vi.fn());
const recordComplianceEvent = vi.hoisted(() => vi.fn());

vi.mock("@/src/lib/env", () => ({
  getEnv: () => ({
    OWNER_PHONE: "+61400000000"
  })
}));

vi.mock("@/src/lib/db", () => ({
  getConfig,
  getContactById,
  recordComplianceEvent
}));

describe("external contact compliance gate", () => {
  it("fails closed when external contact is disabled", async () => {
    getConfig.mockResolvedValue(false);
    const { assertExternalContactAllowed } = await import("@/src/lib/compliance");

    await expect(assertExternalContactAllowed(makeTask(), "email")).rejects.toThrow(
      "External contact disabled"
    );
  });

  it("allows owner phone calls even when outside contact is disabled", async () => {
    getConfig.mockResolvedValue(false);
    const { assertExternalContactAllowed } = await import("@/src/lib/compliance");

    await expect(
      assertExternalContactAllowed(
        makeTask({
          action_type: "briefing",
          action_payload: { to_number: "+61400000000" }
        }),
        "call"
      )
    ).resolves.toBeUndefined();
  });

  it("requires task-specific owner approval for non-owner external contact", async () => {
    getConfig.mockResolvedValue(true);
    const { assertExternalContactAllowed } = await import("@/src/lib/compliance");

    await expect(assertExternalContactAllowed(makeTask({ approval_required: false }), "email")).rejects.toThrow(
      "specific owner approval"
    );
  });

  it("allows compliance evaluation only after task-specific approval exists", async () => {
    getConfig.mockResolvedValue(true);
    getContactById.mockResolvedValue({
      id: 1,
      opted_out: false,
      allowed_contact_channels: ["email"],
      consent_status: "express",
      dnc_status: "clear",
      email: "buyer@example.com",
      phone: null,
      timezone: "Australia/Perth"
    });
    const { assertExternalContactAllowed } = await import("@/src/lib/compliance");

    await expect(
      assertExternalContactAllowed(
        makeTask({
          approval_required: true,
          approval_used_at: new Date().toISOString(),
          approval_nonce_hash: null
        }),
        "email"
      )
    ).resolves.toBeUndefined();
  });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 10,
    goal_id: null,
    source: "test",
    description: "Send a test email",
    priority_score: 50,
    status: "pending",
    assigned_agent: null,
    action_type: "send_email",
    action_payload: { to_email: "buyer@example.com", contact_id: 1 },
    result_summary: null,
    metadata: {},
    estimated_value: 0,
    external_contact: true,
    approval_required: false,
    approval_nonce_hash: null,
    approval_expires_at: null,
    approval_used_at: null,
    approval_requested_at: null,
    attempt_count: 0,
    max_attempts: 3,
    idempotency_key: null,
    claimed_at: null,
    lease_expires_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    completed_at: null,
    ...overrides
  };
}
