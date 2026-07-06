import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  RETELL_API_KEY: "retell-api-key",
  RETELL_AGENT_ID: "agent-default"
}));

vi.mock("@/src/lib/env", () => ({
  getEnv: () => mockEnv
}));

describe("createRetellWebCall", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("creates a web call with the selected agent and dynamic variables", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          call_id: "call_web_123",
          access_token: "short-lived-access-token",
          call_status: "registered",
          agent_id: "agent-executive"
        }),
        { status: 200 }
      )
    );

    const { createRetellWebCall } = await import("@/src/lib/integrations/retell");
    const result = await createRetellWebCall({
      agentId: "agent-executive",
      metadata: { interface: "browser_voice" },
      dynamicVariables: { conversation_mode: "live_browser_voice" }
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.retellai.com/v2/create-web-call",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer retell-api-key",
          "Content-Type": "application/json"
        })
      })
    );
    expect(body).toMatchObject({
      agent_id: "agent-executive",
      metadata: { interface: "browser_voice" },
      retell_llm_dynamic_variables: { conversation_mode: "live_browser_voice" }
    });
    expect(result).toMatchObject({
      call_id: "call_web_123",
      access_token: "short-lived-access-token"
    });
  });

  it("surfaces Retell API failures without exposing credentials", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: "error", message: "Invalid API Key." }), { status: 401 })
    );

    const { createRetellWebCall } = await import("@/src/lib/integrations/retell");

    await expect(createRetellWebCall({ agentId: "agent-executive" })).rejects.toThrow(
      "Retell create-web-call failed with HTTP 401"
    );
  });
});
