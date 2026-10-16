import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const ARMY_WORKFLOWS = [
  {
    file: ".github/workflows/e2e-army-critical.yml",
    runStep: "Run native database and TesterArmy critical journeys",
    command: "run: node --import tsx scripts/run-tester-army-ci.ts critical",
  },
  {
    file: ".github/workflows/e2e-army-full.yml",
    runStep: "Run native database and TesterArmy full journeys",
    command: "run: node --import tsx scripts/run-tester-army-ci.ts full",
  },
] as const;

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function workflowSteps(workflow: string): string[] {
  return workflow.split(/^\s+- name:/mu).slice(1);
}

function stepNamed(workflow: string, name: string): string {
  const step = workflowSteps(workflow).find((candidate) =>
    candidate.trimStart().startsWith(name)
  );
  expect(step, `step "${name}"`).toBeDefined();
  return step ?? "";
}

// Body of a `run: |` block scalar, without its indentation.
function runScript(step: string): string {
  const lines = step.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^\s+run: \|$/u.test(line));
  expect(start).toBeGreaterThan(-1);
  const indent = lines[start].indexOf("run:") + 2;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && line.length - line.trimStart().length < indent) {
      break;
    }
    body.push(line.slice(indent));
  }
  return body.join("\n");
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

// The guard is a bash script: run it for real when a bash >= 4 that receives
// our environment is available (always the case on the ubuntu CI runner).
const bashProbe = spawnSync(
  "bash",
  ["-c", 'printf "%s:%s" "${BASH_VERSINFO[0]}" "${GUARD_PROBE:-}"'],
  { encoding: "utf8", env: { ...process.env, GUARD_PROBE: "ok" } }
);
const [bashMajor, probeEnv] = (bashProbe.stdout ?? "").split(":");
const canRunGuard = Number(bashMajor) >= 4 && probeEnv === "ok";

const PROD = "prodref.supabase.co";
const STAGING = "stagingref.supabase.co";

type GuardCase = {
  label: string;
  url: string;
  staging?: string;
  production?: string;
  accepted: boolean;
};

const GUARD_CASES: GuardCase[] = [
  { label: "production URL, current configuration (no variables)", url: `https://${PROD}`, accepted: false },
  { label: "staging variable equal to production", url: `https://${PROD}`, staging: PROD, production: PROD, accepted: false },
  { label: "production variable missing", url: `https://${STAGING}`, staging: STAGING, accepted: false },
  { label: "production URL with a distinct staging host", url: `https://${PROD}`, staging: STAGING, production: PROD, accepted: false },
  { label: "production variable pasted as a URL", url: `https://${PROD}`, staging: PROD, production: `https://${PROD}`, accepted: false },
  { label: "production variable with a trailing dot", url: `https://${PROD}`, staging: PROD, production: `${PROD}.`, accepted: false },
  { label: "production variable with a trailing slash", url: `https://${PROD}`, staging: PROD, production: ` ${PROD}/`, accepted: false },
  { label: "production variable wildcard", url: `https://${PROD}`, staging: PROD, production: "*", accepted: false },
  { label: "staging variable pasted as a URL", url: `https://${STAGING}`, staging: `https://${STAGING}`, production: PROD, accepted: false },
  { label: "userinfo", url: `https://${STAGING}@${PROD}`, staging: STAGING, production: PROD, accepted: false },
  { label: "suffix", url: `https://${STAGING}.${PROD}`, staging: STAGING, production: PROD, accepted: false },
  { label: "explicit port", url: `https://${STAGING}:443`, staging: STAGING, production: PROD, accepted: false },
  { label: "path", url: `https://${STAGING}/rest/v1`, staging: STAGING, production: PROD, accepted: false },
  { label: "plain http", url: `http://${STAGING}`, staging: STAGING, production: PROD, accepted: false },
  { label: "look-alike loopback", url: `http://localhost.${PROD}`, accepted: false },
  { label: "embedded newline", url: `https://${STAGING}\nhttps://${PROD}`, staging: STAGING, production: PROD, accepted: false },
  { label: "distinct staging host", url: `https://${STAGING}`, staging: STAGING, production: PROD, accepted: true },
  { label: "distinct staging host, case and spaces", url: ` https://STAGINGREF.supabase.co/ `, staging: ` ${STAGING.toUpperCase()} `, production: PROD.toUpperCase(), accepted: true },
  { label: "loopback 127.0.0.1", url: "http://127.0.0.1:54321", accepted: true },
  { label: "loopback [::1]", url: "http://[::1]:54321", accepted: true },
];

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

  // The audited host guard remains; the business runner now owns an ephemeral
  // native stack. Neither a PR nor a nightly run receives shared credentials.
  it("runs Army business workflows only with their isolated native stack", () => {
    const guards = new Set<string>();
    for (const { file, runStep, command } of ARMY_WORKFLOWS) {
      const workflow = read(file);
      const steps = workflowSteps(workflow);
      expect(workflow, file).not.toContain("secrets.");
      expect(workflow, file).not.toContain("environment: e2e-staging");
      expect(workflow, file).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(workflow, file).not.toContain("pull_request_target");
      expect(steps[0], file).toMatch(/^\s+id: target_guard$/mu);
      expect(steps[0], file).toContain("NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321");
      guards.add(runScript(steps[0]));
      expect(stepNamed(workflow, runStep), file).toContain(command);
      expect(workflow, file).toContain("npx @e2e-dev/web install chromium --with-deps");
      expect(workflow, file).toContain("steps.journeys.outputs.evidence");
      expect(workflow, file).toContain("if-no-files-found: error");
      expect(workflow, file).not.toContain("continue-on-error");
      expectInstallStepsToHaveNoSecrets(workflow);
    }
    expect(guards.size).toBe(1);
  });

  it.skipIf(!canRunGuard && !process.env.CI)(
    "refuses every Supabase target except loopback or a distinct, well-formed staging host",
    () => {
      expect(canRunGuard, "bash >= 4 is required on CI").toBe(true);

      for (const { file } of ARMY_WORKFLOWS) {
        const script = runScript(workflowSteps(read(file))[0]);
        for (const scenario of GUARD_CASES) {
          const result = spawnSync("bash", ["-e", "-c", script], {
            encoding: "utf8",
            env: {
              NODE_ENV: process.env.NODE_ENV,
              PATH: process.env.PATH ?? "",
              NEXT_PUBLIC_SUPABASE_URL: scenario.url,
              E2E_STAGING_SUPABASE_HOST: scenario.staging ?? "",
              PRODUCTION_SUPABASE_HOST: scenario.production ?? "",
            },
          });
          expect(
            result.status === 0,
            `${file} | ${scenario.label}: ${result.stdout}${result.stderr}`
          ).toBe(scenario.accepted);
        }
      }
    }
  );

  it("keeps Army business runs deterministic and authenticated evidence private", () => {
    const config = read("e2e.config.ts");
    expect(config).toContain("workers: 1");
    expect(config).toContain("retries: 0");
    expect(config).toContain('trace: critical || performance || coverage ? "off" : "on"');
    expect(config).toContain('E2E_ARMY_BLOCK_WORKERS: "1"');
    expect(config).toContain("maxDuration:");
    const source = ts.createSourceFile(
      "run-tester-army-ci.ts", read("scripts/run-tester-army-ci.ts"), ts.ScriptTarget.Latest, true
    );
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "runLocalSupabaseCi") {
        calls.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(calls).toHaveLength(1);
    expect(ts.isAwaitExpression(calls[0].parent)).toBe(true);
    const options = calls[0].arguments[0];
    expect(options && ts.isObjectLiteralExpression(options)).toBe(true);
    const callbacks = options && ts.isObjectLiteralExpression(options)
      ? options.properties.filter((property) => ts.isShorthandPropertyAssignment(property) && property.name.text === "runApplication")
      : [];
    expect(callbacks).toHaveLength(1);
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
