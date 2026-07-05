import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("seed idempotency", () => {
  it("uses a stable conflict target for seeded goals", () => {
    const seed = fs.readFileSync(path.join(process.cwd(), "supabase", "seed.sql"), "utf8");
    const migration = fs.readFileSync(
      path.join(process.cwd(), "supabase", "migrations", "0001_robur_autonomous_worker.sql"),
      "utf8"
    );

    expect(migration).toContain("idx_goals_goal_text_unique");
    expect(seed).toContain("on conflict(goal_text) do update");
  });
});
