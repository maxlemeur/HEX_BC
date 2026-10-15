import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function workflowSteps(workflow: string): string[] {
  return workflow.split(/^\s+- name:/mu).slice(1);
}

function expectServiceRoleOnlyOnRunStep(workflow: string, runStepName: string) {
  const steps = workflowSteps(workflow);
  const withServiceRole = steps.filter((step) =>
    step.includes("SUPABASE_SERVICE_ROLE_KEY")
  );
  expect(withServiceRole).toHaveLength(1);
  expect(withServiceRole[0]).toMatch(new RegExp(`^\\s*${runStepName}`, "u"));
  expect(withServiceRole[0]).toContain(
    "SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"
  );
  expect(workflow).not.toContain("E2E_SUPABASE_SERVICE_ROLE_KEY");
}

function expectInstallStepsToHaveNoSecrets(workflow: string) {
  const installSteps = workflowSteps(workflow).filter(
    (step) =>
      /^\s+run:\s*npm ci\b/mu.test(step) ||
      /^\s+run:\s*npx playwright install\b/mu.test(step)
  );

  expect(installSteps.length).toBeGreaterThan(0);
  for (const step of installSteps) {
    expect(step).not.toContain("secrets.");
    expect(step).not.toMatch(/^\s+env:/mu);
  }
}

// @e2e-dev/web >= 0.14: route.continue() sends the request straight to the
// network, skipping every older route; route.fallback() hands it to the route
// registered before. Routes run newest first, so an observer that ends in
// continue() silently bypasses the campaign guard installed before it (origin
// allowlist, send/status/email/approve/invite blocks, offer recipient,
// lifecycle and labor-role admissions). Every journey keeps passing: a guard
// only fails a test when it sees a forbidden request, so no E2E assertion can
// notice that it no longer sees any. Failure modes covered here: an observer
// or mock (inline, extracted, or in a *-support.ts / *-fixtures.ts helper)
// ends in continue(); a guard file gains a continue() outside its guard; a
// guard scope gains a second catch-all; an allowlisted guard disappears.
// Only the final allow decision of a guard that is the oldest route for its
// requests may call continue(). Keyed by file | enclosing scopes | route
// pattern, with the exact number of calls.
const ARMY_ROUTE_GUARD_CONTINUES: Record<string, number> = {
  "e2e/army/anonymous-login.e2e.ts | beforeEach | **/*": 1,
  "e2e/army/public-navigation.e2e.ts | beforeEach | **/*": 1,
  "e2e/army/critical/access-boundaries.e2e.ts | test | **/*": 1,
  "e2e/army/critical/fixtures.ts | restrictCriticalBrowser | **/*": 1,
  "e2e/army/local/brief-evidence.e2e.ts | test | **/*": 1,
  "e2e/army/local/offer-emission-fixtures.ts | restrictOfferBrowser | **/*": 1,
  "e2e/army/local/purchase-decimals.e2e.ts | fixture | **/*": 1,
  "e2e/army/local/purchase-draft-eligibility.e2e.ts | test | **/*": 1,
  "e2e/army/local/purchase-preparation.e2e.ts | campaign | **/*": 1,
  "e2e/army/local/purchase-readiness.e2e.ts | readinessTestFor > fixture | **/*": 1,
  "e2e/army/local/resend-portal-fixtures.ts | restrictOfferBrowser | **/*": 1,
  "e2e/army/performance/editor-grid.e2e.ts | test | **/*": 1,
};

type RouteContinueSite = { site: string; key: string; scope: string; pattern: string };

function scopeName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name?.getText() ?? "<anonymous>";
  }
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return undefined;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
    return parent.name.getText();
  }
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression;
    return ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText();
  }
  return "<anonymous>";
}

// The pattern of the browser.route() call this function is the handler of.
function routePattern(handler: ts.Node): string | undefined {
  const call = handler.parent;
  if (!call || !ts.isCallExpression(call) || call.arguments[1] !== handler) return undefined;
  const callee = call.expression;
  const pattern = call.arguments[0];
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "route" || !pattern) {
    return undefined;
  }
  return ts.isStringLiteralLike(pattern) ? pattern.text : pattern.getText();
}

function armyRouteContinueSites(): RouteContinueSite[] {
  const files = fs
    .readdirSync(path.join(root, "e2e", "army"), { recursive: true, encoding: "utf8" })
    .filter((name) => /\.[cm]?[jt]sx?$/u.test(name))
    .map((name) => path.posix.join("e2e/army", name.split(path.sep).join("/")))
    .sort();
  expect(files.length).toBeGreaterThan(0);

  return files.flatMap((file) => {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const sites: RouteContinueSite[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "continue"
      ) {
        let handler: ts.Node = node.parent;
        while (!ts.isFunctionLike(handler) && !ts.isSourceFile(handler)) handler = handler.parent;
        const scopes: string[] = [];
        for (let ancestor: ts.Node | undefined = handler.parent; ancestor; ancestor = ancestor.parent) {
          const name = scopeName(ancestor);
          if (name) scopes.unshift(name);
        }
        const scope = scopes.join(" > ") || "<module>";
        const pattern = routePattern(handler) ?? "<not a route handler>";
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        sites.push({ site: `${file}:${line}`, key: `${file} | ${scope} | ${pattern}`, scope, pattern });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return sites;
  });
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
    const nightly = read(".github/workflows/e2e-playwright-nightly.yml");

    // Staging credentials must never be readable from an unreviewed PR branch.
    expect(workflow).not.toMatch(/^\s{2}pull_request:/mu);
    expect(workflow).not.toMatch(/pull_request_target/u);
    expect(workflow).not.toMatch(/^\s{2}workflow_dispatch:/mu);
    expect(workflow).toContain("environment: e2e-staging");
    expect(workflow).toContain("E2E_ALLOWED_SUPABASE_HOST");
    // Decision 2026-08-19: the production project is the only Supabase project,
    // so the service-role key is allowed — but only on the Playwright run step.
    expectServiceRoleOnlyOnRunStep(workflow, "Run critical Playwright suite");
    expect(workflow).not.toMatch(
      /^\s{6}NEXT_PUBLIC_SUPABASE_(?:URL|ANON_KEY):.*secrets/mu
    );
    expect(workflow.indexOf("secrets.")).toBeGreaterThan(
      workflow.indexOf("Validate required environment")
    );
    expectInstallStepsToHaveNoSecrets(workflow);
    expect(workflow).toContain("!test-results/**/trace.zip");
    expect(workflow).toContain("retention-days: 3");

    expect(nightly).toContain('cron: "15 3 * * *"');
    expect(nightly).toContain("run: npm run e2e:pw");
    expect(nightly).not.toMatch(/^\s{2}pull_request:/mu);
    expect(nightly).not.toMatch(/pull_request_target/u);
    expect(nightly).not.toMatch(/^\s{2}workflow_dispatch:/mu);
    expect(nightly).toContain("environment: e2e-staging");
    expect(nightly).toContain("E2E_ALLOWED_SUPABASE_HOST");
    expectServiceRoleOnlyOnRunStep(nightly, "Run full Playwright suite");
    expect(nightly).not.toMatch(
      /^\s{6}NEXT_PUBLIC_SUPABASE_(?:URL|ANON_KEY):.*secrets/mu
    );
    expect(nightly.indexOf("secrets.")).toBeGreaterThan(
      nightly.indexOf("Validate required environment")
    );
    expectInstallStepsToHaveNoSecrets(nightly);
    expect(nightly).toContain("!test-results/**/trace.zip");
    expect(nightly).toContain("retention-days: 3");
  });

  it("makes the critical Playwright project deterministic in CI", () => {
    const config = read("playwright.config.ts");
    const planCenter = read("e2e/estimates/plan-center.spec.ts");
    const criticalProject = config.slice(
      config.indexOf('name: "chromium-critical"'),
      config.indexOf("webServer:")
    );

    expect(config).toContain("failOnFlakyTests: !!process.env.CI");
    expect(config).toContain('trace: "off"');
    expect(config).toContain('name: "chromium-critical"');
    expect(criticalProject).not.toMatch(/testIgnore/u);
    expect(criticalProject).not.toContain("team-a-hub-dev-scenarios");
    expect(criticalProject).toContain("dashboard-ux\\.spec\\.ts");
    expect(criticalProject).toContain("duplicate\\.spec\\.ts");
    expect(criticalProject).toContain("full-lifecycle\\.spec\\.ts");
    expect(criticalProject).toContain("hub-launch-metre\\.spec\\.ts");
    expect(criticalProject).toContain("import-dpgf\\.spec\\.ts");
    expect(criticalProject).toContain("plan-center\\.spec\\.ts");
    expect(criticalProject).toContain("team-a-hub-prod\\.spec\\.ts");
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
    expect(workflow).toContain('= "2.120.0"');
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
  it("keeps every TesterArmy campaign guard on the path of the routes registered after it", () => {
    const grouped = new Map<string, RouteContinueSite[]>();
    for (const site of armyRouteContinueSites()) {
      grouped.set(site.key, [...(grouped.get(site.key) ?? []), site]);
    }

    const offenders = [...grouped]
      .filter(([key, sites]) => sites.length > (ARMY_ROUTE_GUARD_CONTINUES[key] ?? 0))
      .flatMap(([, sites]) => sites)
      .sort((a, b) => a.site.localeCompare(b.site, "en", { numeric: true }))
      .map(({ site, scope, pattern }) => `${site} (in ${scope}, route ${pattern})`);
    const staleGuards = Object.entries(ARMY_ROUTE_GUARD_CONTINUES)
      .filter(([key, count]) => (grouped.get(key)?.length ?? 0) < count)
      .map(([key]) => key);

    expect(
      { offenders, staleGuards },
      "@e2e-dev/web >=0.14 route.continue() skips older routes (campaign guards); " +
        "use route.fallback() in observers. Only the final allow decision of a guard " +
        "that is the oldest route for its requests may call continue() " +
        "(ARMY_ROUTE_GUARD_CONTINUES)."
    ).toEqual({ offenders: [], staleGuards: [] });
  });
});
