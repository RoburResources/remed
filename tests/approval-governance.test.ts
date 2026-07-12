import { describe, expect, it, vi } from "vitest";
import { hashApprovalNonce } from "@/src/lib/crypto";
import { Task } from "@/src/lib/types";

const getConfig = vi.hoisted(() => vi.fn().mockResolvedValue(50000));

vi.mock("@/src/lib/db", () => ({
  getConfig,
  logExecution: vi.fn(),
  updateTask: vi.fn()
}));

vi.mock("@/src/lib/env", () => ({
  getEnv: () => ({
    OWNER_PHONE: "+61000000000",
    OWNER_EMAIL: "michael@robur.com.au",
    APPROVAL_SECRET: "approval-secret-with-enough-length"
  })
}));

vi.mock("@/src/lib/integrations/twilio", () => ({
  sendSms: vi.fn()
}));

describe("owner approval governance", () => {
  it("requires approval for non-owner external calls even if external_contact is false", async () => {
    const { taskRequiresApproval } = await import("@/src/lib/approval");

    await expect(taskRequiresApproval(makeTask({ external_contact: false }))).resolves.toBe(true);
  });

  it("requires approval for non-owner briefing calls", async () => {
    const { taskRequiresApproval } = await import("@/src/lib/approval");

    await expect(
      taskRequiresApproval(
        makeTask({
          action_type: "briefing",
          external_contact: false,
          action_payload: { to_number: "+61000000001", contact_id: 1 }
        })
      )
    ).resolves.toBe(true);
  });

  it("does not require outside-contact approval for owner briefing calls", async () => {
    const { taskRequiresApproval } = await import("@/src/lib/approval");

    await expect(
      taskRequiresApproval(
        makeTask({
          action_type: "briefing",
          external_contact: false,
          action_payload: { to_number: "+61000000000" }
        })
      )
    ).resolves.toBe(false);
  });

  it("does not require outside-contact approval for owner email", async () => {
    const { taskRequiresApproval } = await import("@/src/lib/approval");

    await expect(
      taskRequiresApproval(
        makeTask({
          action_type: "send_email",
          external_contact: true,
          action_payload: { to_email: "Michael@Robur.com.au" }
        })
      )
    ).resolves.toBe(false);
  });

  it("does not let a command for one task approve another task", async () => {
    const { assertApprovalCommandMayResolve } = await import("@/src/lib/approval");

    expect(() =>
      assertApprovalCommandMayResolve(makeApprovalTask({ id: 124 }), { action: "approve", taskId: 123, nonce: "111111" }, approvalInput())
    ).toThrow("cannot approve task");
  });

  it("does not allow expired approval nonces", async () => {
    const { assertApprovalCommandMayResolve } = await import("@/src/lib/approval");
    const task = makeApprovalTask({
      approval_expires_at: new Date(Date.now() - 1000).toISOString()
    });

    expect(() =>
      assertApprovalCommandMayResolve(task, { action: "approve", taskId: task.id, nonce: "111111" }, approvalInput())
    ).toThrow("expired");
  });

  it("does not allow reused approval nonces", async () => {
    const { assertApprovalCommandMayResolve } = await import("@/src/lib/approval");
    const task = makeApprovalTask({
      approval_used_at: new Date().toISOString()
    });

    expect(() =>
      assertApprovalCommandMayResolve(task, { action: "approve", taskId: task.id, nonce: "111111" }, approvalInput())
    ).toThrow("already used");
  });
});

function approvalInput() {
  return {
    actorPhone: "+61000000000",
    ownerPhone: "+61000000000",
    approvalSecret: "approval-secret-with-enough-length"
  };
}

function makeApprovalTask(overrides: Partial<Task> = {}): Task {
  return makeTask({
    status: "awaiting_approval",
    approval_required: true,
    approval_nonce_hash: hashApprovalNonce(123, "111111", "approval-secret-with-enough-length"),
    approval_expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides
  });
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 123,
    goal_id: null,
    source: "test",
    description: "Call a supplier",
    priority_score: 50,
    status: "pending",
    assigned_agent: null,
    action_type: "outbound_call",
    action_payload: { to_number: "+61000000001", contact_id: 1 },
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
