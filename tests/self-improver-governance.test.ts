import { beforeEach, describe, expect, it, vi } from "vitest";

const setConfig = vi.hoisted(() => vi.fn());
const createPolicyChangeRequest = vi.hoisted(() => vi.fn());
const logExecution = vi.hoisted(() => vi.fn());

vi.mock("@/src/lib/db", () => ({
  setConfig,
  createPolicyChangeRequest,
  logExecution,
  getRecentEvaluations: vi.fn(),
  isKillSwitchActive: vi.fn()
}));

describe("self-improver policy restrictions", () => {
  beforeEach(() => {
    setConfig.mockReset();
    createPolicyChangeRequest.mockReset();
    logExecution.mockReset();
  });

  it("applies low-risk self-improvement config changes", async () => {
    const { applySelfImprovementConfigUpdates } = await import("@/src/lib/workers/self-improver");

    await expect(
      applySelfImprovementConfigUpdates([
        { key: "priority_weight_research", value: 1.2, description: "safe tune" }
      ])
    ).resolves.toEqual({ applied: ["priority_weight_research"], proposed: [] });

    expect(setConfig).toHaveBeenCalledWith("priority_weight_research", 1.2, "safe tune");
    expect(createPolicyChangeRequest).not.toHaveBeenCalled();
  });

  it("creates a proposal instead of applying protected policy changes", async () => {
    createPolicyChangeRequest.mockResolvedValue({ id: 7 });
    const { applySelfImprovementConfigUpdates } = await import("@/src/lib/workers/self-improver");

    await expect(
      applySelfImprovementConfigUpdates([
        { key: "external_contact_enabled", value: true, description: "unsafe tune" }
      ])
    ).resolves.toEqual({ applied: [], proposed: ["7"] });

    expect(setConfig).not.toHaveBeenCalled();
    expect(createPolicyChangeRequest).toHaveBeenCalledWith(expect.objectContaining({
      protectedPolicyKeys: ["external_contact_enabled"]
    }));
  });
});
