import { beforeEach, describe, expect, it, vi } from "vitest";
import { Task } from "@/src/lib/types";

const assertDailyLimit = vi.hoisted(() => vi.fn());
const claimNextTask = vi.hoisted(() => vi.fn());
const completeTask = vi.hoisted(() => vi.fn());
const createTasks = vi.hoisted(() => vi.fn());
const expireOldApprovals = vi.hoisted(() => vi.fn());
const failTask = vi.hoisted(() => vi.fn());
const getConfig = vi.hoisted(() => vi.fn());
const getRecentOpportunities = vi.hoisted(() => vi.fn());
const getRecentTasks = vi.hoisted(() => vi.fn());
const incrementDailyMetric = vi.hoisted(() => vi.fn());
const isKillSwitchActive = vi.hoisted(() => vi.fn());
const logExecution = vi.hoisted(() => vi.fn());
const recordRetellCall = vi.hoisted(() => vi.fn());
const recoverStaleInProgressTasks = vi.hoisted(() => vi.fn());
const requestTaskApproval = vi.hoisted(() => vi.fn());
const taskRequiresApproval = vi.hoisted(() => vi.fn());
const assertExternalContactAllowed = vi.hoisted(() => vi.fn());
const createRetellPhoneCall = vi.hoisted(() => vi.fn());

const mockEnv = {
  OWNER_PHONE: "+61400000000",
  RETELL_AGENT_ID: "agent_rachel_or_default",
  RETELL_EXECUTIVE_ASSISTANT_AGENT_ID: "agent_executive_assistant"
};

vi.mock("@/src/lib/db", () => ({
  assertDailyLimit,
  claimNextTask,
  completeTask,
  createTasks,
  expireOldApprovals,
  failTask,
  getConfig,
  getRecentOpportunities,
  getRecentTasks,
  incrementDailyMetric,
  isKillSwitchActive,
  logExecution,
  recordRetellCall,
  recoverStaleInProgressTasks
}));

vi.mock("@/src/lib/approval", () => ({
  requestTaskApproval,
  taskRequiresApproval
}));

vi.mock("@/src/lib/compliance", () => ({
  assertExternalContactAllowed
}));

vi.mock("@/src/lib/env", () => ({
  getEnv: () => mockEnv,
  getExecutiveAssistantAgentId: (env = mockEnv) => env.RETELL_EXECUTIVE_ASSISTANT_AGENT_ID ?? env.RETELL_AGENT_ID
}));

vi.mock("@/src/lib/integrations/retell", () => ({
  createRetellPhoneCall
}));

vi.mock("@/src/lib/integrations/email", () => ({
  sendEmailViaMake: vi.fn()
}));

vi.mock("@/src/lib/integrations/twilio", () => ({
  sendSms: vi.fn()
}));

vi.mock("@/src/lib/openai", () => ({
  createStructuredOutput: vi.fn()
}));

vi.mock("@/src/lib/scanners/austender", () => ({
  scanAusTenderOpportunities: vi.fn()
}));

vi.mock("@/src/lib/url-safety", () => ({
  fetchWithUrlSafety: vi.fn()
}));

describe("executive assistant Retell routing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    assertDailyLimit.mockResolvedValue(undefined);
    completeTask.mockResolvedValue(undefined);
    createTasks.mockResolvedValue(0);
    expireOldApprovals.mockResolvedValue(0);
    getConfig.mockResolvedValue(true);
    getRecentOpportunities.mockResolvedValue([]);
    getRecentTasks.mockResolvedValue([]);
    incrementDailyMetric.mockResolvedValue(undefined);
    isKillSwitchActive.mockResolvedValue(false);
    logExecution.mockResolvedValue(undefined);
    recordRetellCall.mockResolvedValue(undefined);
    recoverStaleInProgressTasks.mockResolvedValue([]);
    taskRequiresApproval.mockResolvedValue(false);
    assertExternalContactAllowed.mockResolvedValue(undefined);
    createRetellPhoneCall.mockResolvedValue({
      call_id: "call_123",
      call_status: "registered",
      agent_id: "agent_executive_assistant",
      from_number: "+61800000000",
      to_number: "+61400000000"
    });
  });

  it("uses the dedicated executive assistant agent and natural voice profile for owner briefings", async () => {
    const { runMorningBriefing } = await import("@/src/lib/workers/briefings");

    await expect(runMorningBriefing()).resolves.toEqual(
      expect.objectContaining({ ok: true, message: "morning briefing call created." })
    );

    expect(createRetellPhoneCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toNumber: mockEnv.OWNER_PHONE,
        agentId: "agent_executive_assistant",
        dynamicVariables: expect.objectContaining({
          executive_assistant_voice_profile: expect.stringContaining("Female Australian executive assistant"),
          executive_assistant_conversation_style: expect.stringContaining("Australian English"),
          briefing_type: "morning"
        })
      })
    );
  });

  it("leaves default outbound call agent routing untouched", async () => {
    claimNextTask.mockResolvedValue(makeTask());
    const { runTaskExecutor } = await import("@/src/lib/workers/task-executor");

    await expect(runTaskExecutor()).resolves.toEqual(
      expect.objectContaining({ ok: true, message: "Processed task #20." })
    );

    expect(createRetellPhoneCall).toHaveBeenCalledWith(
      expect.not.objectContaining({
        agentId: "agent_executive_assistant"
      })
    );
  });
});

function makeTask(): Task {
  return {
    id: 20,
    goal_id: null,
    source: "test",
    description: "Call approved supplier",
    priority_score: 70,
    status: "pending",
    assigned_agent: null,
    action_type: "outbound_call",
    action_payload: { to_number: "+61411111111", contact_id: 1 },
    result_summary: null,
    metadata: {},
    estimated_value: 0,
    external_contact: true,
    approval_required: true,
    approval_nonce_hash: null,
    approval_expires_at: null,
    approval_used_at: new Date().toISOString(),
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
