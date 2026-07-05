import { describe, expect, it, vi } from "vitest";
import { Task } from "@/src/lib/types";

vi.mock("@/src/lib/env", () => ({
  getEnv: () => ({
    OWNER_PHONE: "+61400000000"
  })
}));

vi.mock("@/src/lib/db", () => ({
  getConfig: vi.fn().mockResolvedValue(false),
  getContactById: vi.fn(),
  recordComplianceEvent: vi.fn()
}));

describe("external contact compliance gate", () => {
  it("fails closed when external contact is disabled", async () => {
    const { assertExternalContactAllowed } = await import("@/src/lib/compliance");

    await expect(assertExternalContactAllowed(makeTask(), "email")).rejects.toThrow(
      "External contact disabled"
    );
  });
});

function makeTask(): Task {
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
    completed_at: null
  };
}
