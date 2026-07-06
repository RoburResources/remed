import { beforeEach, describe, expect, it, vi } from "vitest";

const reserveApiSpendBudget = vi.hoisted(() => vi.fn());
const reconcileReservedApiSpend = vi.hoisted(() => vi.fn());
const logExecution = vi.hoisted(() => vi.fn());

vi.mock("@/src/lib/db", () => ({
  reserveApiSpendBudget,
  reconcileReservedApiSpend,
  logExecution
}));

vi.mock("@/src/lib/env", () => ({
  getEnv: () => ({
    OPENAI_API_KEY: "openai-api-key-test-value",
    OPENAI_MODEL: "gpt-test",
    OPENAI_COST_INPUT_CENTS_PER_1K: 1,
    OPENAI_COST_OUTPUT_CENTS_PER_1K: 4
  })
}));

describe("OpenAI preflight spend enforcement", () => {
  beforeEach(() => {
    vi.resetModules();
    reserveApiSpendBudget.mockReset();
    reconcileReservedApiSpend.mockReset();
    logExecution.mockReset();
    vi.unstubAllGlobals();
  });

  it("does not call OpenAI when the daily cap blocks preflight", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    reserveApiSpendBudget.mockRejectedValue(new Error("OpenAI daily spend cap would be exceeded"));

    const { createStructuredOutput } = await import("@/src/lib/openai");

    await expect(
      createStructuredOutput<{ ok: boolean }>({
        system: "system",
        user: "user",
        schemaName: "test_schema",
        schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }
      })
    ).rejects.toThrow("spend cap");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reconciles reserved spend after a successful response", async () => {
    reserveApiSpendBudget.mockResolvedValue({
      reservedSpendCents: 9,
      currentSpendCents: 10,
      maxSpendCents: 500
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output_text: "{\"ok\":true}",
            usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
          }),
          { status: 200 }
        )
      )
    );

    const { createStructuredOutput } = await import("@/src/lib/openai");
    const result = await createStructuredOutput<{ ok: boolean }>({
      system: "system",
      user: "user",
      schemaName: "test_schema",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }
    });

    expect(result.data.ok).toBe(true);
    expect(reserveApiSpendBudget).toHaveBeenCalledBefore(reconcileReservedApiSpend);
    expect(reconcileReservedApiSpend).toHaveBeenCalledWith(expect.objectContaining({
      reservedSpendCents: 9,
      actualSpendCents: expect.any(Number)
    }));
  });
});
