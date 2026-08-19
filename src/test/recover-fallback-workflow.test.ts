import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("recover durable fallback workflow", () => {
  const workflow = read(".github/workflows/recover-durable-fallback.yml");

  it("schedules GET recover with CRON_SECRET and fail-closed app URL", () => {
    expect(workflow).toContain('cron: "*/5 * * * *"');
    expect(workflow).not.toMatch(/^\s{2}workflow_dispatch:/mu);
    expect(workflow).toContain("permissions:\n      contents: read");
    expect(workflow).toContain("Validate required secrets");
    expect(workflow).toContain("secrets.CRON_SECRET");
    expect(workflow).toContain("secrets.HEX_APP_URL");
    expect(workflow).toContain("vars.APP_URL");
    expect(workflow).toContain("Authorization: Bearer ${CRON_SECRET}");
    expect(workflow).toContain("-X GET");
    expect(workflow).toContain("/api/internal/workflows/recover");
    expect(workflow).toContain('echo "Missing secret: CRON_SECRET"');
    expect(workflow).toContain(
      'echo "Missing secret HEX_APP_URL (or variable APP_URL)"'
    );
    expect(workflow).toContain("must be an https origin");
    expect(workflow.indexOf("secrets.CRON_SECRET")).toBeGreaterThan(
      workflow.indexOf("Validate required secrets")
    );
  });

  it("does not leak CRON_SECRET into logs or unpinned actions", () => {
    expect(workflow).not.toMatch(/echo\s+["']?\$\{?CRON_SECRET/u);
    expect(workflow).not.toContain("curl -v");
    expect(workflow).not.toContain("set -x");
    const actionLines = workflow
      .split(/\r?\n/u)
      .filter((line) => line.includes("uses:"));
    for (const line of actionLines) {
      expect(line).toMatch(
        /uses:\s+[\w.-]+\/[\w.-]+@[a-f0-9]{40}(?:\s+#\s+v\d[^\s]*)?$/u
      );
    }
  });
});

describe("supabase backup failure notification", () => {
  const workflow = read(".github/workflows/supabase-backup.yml");

  it("emits a visible failure after dump/upload without loosening secret order", () => {
    expect(workflow).toContain("name: Notify backup failure");
    expect(workflow).toContain("if: failure()");
    expect(workflow).toContain('echo "::error::Supabase backup failed"');
    expect(workflow).toContain("secrets.BACKUP_ALERT_WEBHOOK");
    expect(workflow.indexOf("Notify backup failure")).toBeGreaterThan(
      workflow.indexOf("name: Dump database")
    );
    expect(workflow.indexOf("Notify backup failure")).toBeGreaterThan(
      workflow.indexOf("name: Upload backup artifact")
    );
    expect(workflow.indexOf("secrets.BACKUP_ALERT_WEBHOOK")).toBeGreaterThan(
      workflow.indexOf("Validate required secrets")
    );
    expect(workflow.indexOf("secrets.SUPABASE_DB_URL")).toBeGreaterThan(
      workflow.indexOf("Validate required secrets")
    );
    expect(workflow.indexOf("secrets.SUPABASE_DB_URL")).toBeGreaterThan(
      workflow.indexOf("npm audit signatures")
    );
    expect(workflow).not.toMatch(/^\s{2}workflow_dispatch:/mu);
  });
});
