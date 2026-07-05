import { describe, expect, it } from "vitest";
import { parseApprovalCommand } from "@/src/lib/approval";

describe("approval command parsing", () => {
  it("requires task id and nonce", () => {
    expect(parseApprovalCommand("APPROVE")).toBeNull();
    expect(parseApprovalCommand("APPROVE #123 184921")).toEqual({
      action: "approve",
      taskId: 123,
      nonce: "184921"
    });
    expect(parseApprovalCommand("reject 123 000001")).toEqual({
      action: "reject",
      taskId: 123,
      nonce: "000001"
    });
  });

  it("rejects malformed nonces", () => {
    expect(parseApprovalCommand("APPROVE #123 12345")).toBeNull();
    expect(parseApprovalCommand("APPROVE #123 1234567")).toBeNull();
    expect(parseApprovalCommand("APPROVE abc 123456")).toBeNull();
  });
});
