import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("CI and local quality guardrails", () => {
  it("pins every third-party action to an immutable commit", () => {
    const workflowDirectory = path.join(root, ".github", "workflows");
    const actionLines = fs
      .readdirSync(workflowDirectory)
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .flatMap((name) =>
        fs
          .readFileSync(path.join(workflowDirectory, name), "utf8")
          .split(/\r?\n/u)
          .filter((line) => line.includes("uses:"))
      );

    expect(actionLines.length).toBeGreaterThan(0);
    for (const line of actionLines) {
      expect(line).toMatch(/uses:\s+[\w.-]+\/[\w.-]+@[a-f0-9]{40}(?:\s+#\s+v\d[^\s]*)?$/u);
    }
  });

  it("keeps the existing quality check fail-closed and production-aware", () => {
    const workflow = read(".github/workflows/quality-gate.yml");

    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("github.ref || github.run_id");
    expect(workflow).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}"
    );
    expect(workflow).toContain("run: npm run audit:dependencies");
    expect(workflow).toContain("run: npm run audit:signatures");
    expect(workflow).toContain("run: npm run check:architecture");
    expect(workflow).toContain("run: npm run test:critical-coverage");
    expect(workflow).toContain("run: npm run verify:production");
    expect(workflow).not.toContain("continue-on-error");
  });

  it("never exposes remote E2E secrets to pull-request or install steps", () => {
    const workflow = read(".github/workflows/e2e-playwright-critical.yml");

    expect(workflow).not.toMatch(/^\s{2}pull_request:/mu);
    expect(workflow).not.toMatch(/^\s{2}workflow_dispatch:/mu);
    expect(workflow).toContain("environment: e2e-staging");
    expect(workflow).toContain("E2E_ALLOWED_SUPABASE_HOST");
    expect(workflow).not.toContain("E2E_SUPABASE_SERVICE_ROLE_KEY");
    expect(workflow).not.toMatch(
      /^\s{6}NEXT_PUBLIC_SUPABASE_(?:URL|ANON_KEY):.*secrets/mu
    );
    expect(workflow.indexOf("secrets.")).toBeGreaterThan(
      workflow.indexOf("Validate required environment")
    );
    expect(workflow).toContain("!test-results/**/trace.zip");
    expect(workflow).toContain("retention-days: 3");
  });

  it("makes the critical Playwright project deterministic in CI", () => {
    const config = read("playwright.config.ts");
    const hub = read("e2e/estimates/hub-launch-metre.spec.ts");
    const planCenter = read("e2e/estimates/plan-center.spec.ts");

    expect(config).toContain("failOnFlakyTests: !!process.env.CI");
    expect(config).toContain('trace: process.env.CI ? "off" : "on-first-retry"');
    expect(config).toContain('name: "chromium-critical"');
    expect(config).toContain("team-a-hub-dev-scenarios\\.spec\\.ts");
    expect(hub).toContain("!process.env.CI && !plansPageLoaded");
    expect(planCenter).toContain(
      '!process.env.CI && pageState === "unavailable"'
    );
  });

  it("uses the project-pinned Supabase CLI for backups", () => {
    const workflow = read(".github/workflows/supabase-backup.yml");

    expect(workflow).not.toMatch(/^\s{2}workflow_dispatch:/mu);
    expect(workflow).toContain("run: npm ci --ignore-scripts");
    expect(workflow).toContain("run: npm audit signatures");
    expect(workflow).toContain("npx --no-install supabase --version");
    expect(workflow).toContain('= "2.109.1"');
    expect(workflow).not.toContain("npm install -g supabase");
    expect(workflow).not.toMatch(/^\s+supabase db dump/mu);
    expect(workflow).not.toMatch(
      /^\s{6}SUPABASE_DB_URL:.*secrets\.SUPABASE_DB_URL/mu
    );
    expect(workflow.indexOf("secrets.SUPABASE_DB_URL")).toBeGreaterThan(
      workflow.indexOf("Validate required secrets")
    );
    expect(workflow.indexOf("secrets.SUPABASE_DB_URL")).toBeGreaterThan(
      workflow.indexOf("npm audit signatures")
    );
  });

  it("does not let manual refs execute release credentials", () => {
    const workflow = read(".github/workflows/release-please.yml");

    expect(workflow).not.toMatch(/^\s{2}workflow_dispatch:/mu);
    expect(workflow).toContain('branches: ["main"]');
  });

  it("keeps local test resource limits and dependency update automation explicit", () => {
    const vitest = read("vitest.config.ts");
    const dependabot = read(".github/dependabot.yml");

    expect(vitest).toContain('pool: "forks"');
    expect(vitest).toContain("maxWorkers: 4");
    expect(dependabot).toContain('package-ecosystem: "npm"');
    expect(dependabot).toContain('package-ecosystem: "github-actions"');
  });
});
