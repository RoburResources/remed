import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decideStaleTaskRecovery } from "@/src/lib/db";

describe("stale task recovery policy", () => {
  it("requeues below max attempts and fails at the bound", () => {
    expect(decideStaleTaskRecovery(0, 3)).toBe("requeued");
    expect(decideStaleTaskRecovery(1, 3)).toBe("requeued");
    expect(decideStaleTaskRecovery(2, 3)).toBe("failed");
  });

  it("is implemented in the Supabase migration with execution logging", () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), "supabase", "migrations", "0001_robur_autonomous_worker.sql"),
      "utf8"
    );

    expect(migration).toContain("recover_stale_in_progress_tasks");
    expect(migration).toContain("stale_task_recovery");
    expect(migration).toContain("for update skip locked");
  });
});
