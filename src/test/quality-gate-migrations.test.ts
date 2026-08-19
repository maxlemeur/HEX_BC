import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflow = fs.readFileSync(
  path.join(process.cwd(), ".github", "workflows", "quality-gate.yml"),
  "utf8"
);

describe("Quality Gate migration order guard", () => {
  it("fetches full Git history so the append-only guard can compare to origin/main", () => {
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("persist-credentials: false");
  });

  it("runs the existing append-only migration Git guard", () => {
    expect(workflow).toContain("run: npm run supabase:migrations:git-guard");
    expect(workflow).toContain("github.event.pull_request.base.sha");
    expect(workflow).toContain("github.event.before");
    expect(workflow).toContain("MIGRATION_DIFF_MODE:");
    expect(workflow.indexOf("supabase:migrations:git-guard")).toBeGreaterThan(
      workflow.indexOf("npm ci")
    );
    expect(workflow.indexOf("supabase:migrations:git-guard")).toBeLessThan(
      workflow.indexOf("run: npm run check:architecture")
    );
  });
});
