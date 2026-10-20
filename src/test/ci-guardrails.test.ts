import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  {
    file: ".github/workflows/e2e-army-calc-v3.yml",
    runStep: "Run native database and TesterArmy calc-v3 phases",
    command: "node --import tsx scripts/run-tester-army-ci.ts calc-v3",
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

/** Job bodies of a workflow, by job id, in file order. */
function workflowJobs(workflow: string): Record<string, string> {
  const body = workflow.slice(workflow.search(/^jobs:\s*$/mu));
  const parts = body.split(/^ {2}([A-Za-z0-9_-]+):\s*$/mu).slice(1);
  const jobs: Record<string, string> = {};
  for (let index = 0; index < parts.length; index += 2) jobs[parts[index]] = parts[index + 1];
  return jobs;
}

/** Every `run:` value of a workflow, inline or block scalar, with its line number. */
function runValues(workflow: string): { line: number; script: string }[] {
  const lines = workflow.split(/\r?\n/u);
  const values: { line: number; script: string }[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/u.exec(line);
    if (!match) return;
    if (!/^[|>][+-]?\s*$/u.test(match[2])) {
      values.push({ line: index + 1, script: match[2] });
      return;
    }
    const indent = match[1].length;
    const body: string[] = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== "" && next.length - next.trimStart().length <= indent) break;
      body.push(next);
    }
    values.push({ line: index + 1, script: body.join("\n") });
  });
  return values;
}

/**
 * `${{ }}` expressions of a shell script other than a needed job's result. Every
 * `${{` counts, read up to its first `}}` (or the end of the script when none
 * closes it): braces inside an expression, as in format('{0}', ...), cannot
 * hide it, and the allowed form contains no brace or quote.
 */
function shellInterpolations(script: string): string[] {
  return (script.match(/\$\{\{[\s\S]*?(?:\}\}|$)/gu) ?? [])
    .filter((expression) => !/^\$\{\{\s*needs\.[A-Za-z0-9_-]+\.result\s*\}\}$/u.test(expression));
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

// Next 16.4 type-checks `next build` with the TypeScript CLI
// (experimental.useTypeScriptCli, on by default): `tsc` is spawned with
// process.env but without the parent's node arguments, so only NODE_OPTIONS
// gives it a heap limit. With `node --max-old-space-size=4096
// node_modules/next/dist/bin/next build` alone, tsc ran on V8's default heap
// (2240 MiB in a 12 GB WSL VM) and died near 2035 MB before any journey ran.
// On every host (Windows, WSL/Linux, macOS, CI, Vercel) a production or E2E
// build must start through scripts/next-build.mjs, whose environment comes
// from withNextBuildHeap() in scripts/next-build-env.mjs. Failure modes:
// - a package.json script, the Vercel buildCommand or a workflow line runs
//   `next build` itself (bare, npx next@<version>, a .bin shim such as
//   next.cmd, or next/dist/bin/next), so the local build, Vercel and
//   verify:production (npm run build) skip the launcher;
// - the canonical build script no longer runs the launcher;
// - the launcher exits 0 without running `next build`, or still hands Next a
//   lower heap than the floor, while `npm run build` reports success;
// - a script under scripts/** spawns the Next CLI with `build`, inline or
//   through a shared table such as buildCommands, with an env that is not the
//   helper's own result: a process.env spread, no env (inherits a parent
//   without the limit), a heap flag passed as a node argument only, or a helper
//   result whose NODE_OPTIONS is deleted or rewritten afterwards;
// - the launcher or build-local.mjs is no longer recognised as a Next build
//   spawn, or the command matcher misses a CLI form, making these checks vacuous;
// - the helper omits the limit, drops the caller's NODE_OPTIONS (network
//   guards use --import), lowers a larger limit the host already chose, or
//   keeps a lower one: absolute, or a percentage of RAM, which V8 applies over
//   any absolute size whatever their order.
const NEXT_BUILD_LAUNCHER = "scripts/next-build.mjs";
const NEXT_BUILD_ENV_MODULE = "scripts/next-build-env.mjs";
const NEXT_BUILD_ENVIRONMENT = "withNextBuildHeap";
const NEXT_BUILD_SPAWNERS = [NEXT_BUILD_LAUNCHER, "scripts/tester-army/build-local.mjs"];
const NEXT_BUILD_HEAP_MIB = 4096;
// The Next CLI as a program word: a path to next/dist/bin/next or to a .bin
// shim (next.cmd, next.ps1 on Windows), or a bare, possibly versioned name.
const NEXT_CLI_PATH = /(?:^|[\\/])(?:next[\\/]dist[\\/]bin|\.bin)[\\/]next(?:\.(?:c?js|mjs|cmd|ps1|exe))?$/u;
const NEXT_CLI_NAME = /^next(?:@[^\s\\/]+)?(?:\.(?:c?js|mjs|cmd|ps1|exe))?$/u;
const SPAWN_FUNCTIONS = new Set(["exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync"]);
const ARRAY_CALLBACKS = new Set(["every", "filter", "find", "flatMap", "forEach", "map", "some"]);

// True when these program words run the Next CLI's build command. A path such
// as .e2e/army/next is not the CLI: only a bin path or a bare name is.
function invokesNextBuild(words: readonly string[]): boolean {
  const cli = words.findIndex((word) => {
    const unquoted = word.replace(/^["']+|["']+$/gu, "");
    return NEXT_CLI_NAME.test(unquoted) || NEXT_CLI_PATH.test(unquoted);
  });
  return cli !== -1 && words.slice(cli + 1).includes("build");
}

// True when one shell command segment runs the Next CLI's build command.
function runsNextBuild(command: string): boolean {
  return command
    .split(/&&|\|\||[;|\r\n]/u)
    .some((segment) =>
      invokesNextBuild(segment.trim().split(/\s+/u).map((word) => word.replace(/^["']+|["']+$/gu, "")))
    );
}

type ScriptModule = {
  source: ts.SourceFile;
  // Local name -> expressions it takes its value from: initializer, iterated
  // collection, or the array whose iteration callback receives it.
  bindings: Map<string, ts.Expression[]>;
  imports: Map<string, { file: string; name: string }>;
};

// Repository-relative target of a relative import; the extension is resolved
// when the file exists, so a missing launcher still keeps its expected path.
function importTarget(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  return ["", ".ts", ".mts", ".mjs", ".js"]
    .map((extension) => `${base}${extension}`)
    .find((candidate) => fs.statSync(path.join(root, candidate), { throwIfNoEntry: false })?.isFile()) ?? base;
}

function parseScriptModule(file: string): ScriptModule {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, ts.Expression[]>();
  const imports = new Map<string, { file: string; name: string }>();
  const bind = (name: string, value: ts.Expression) => bindings.set(name, [...(bindings.get(name) ?? []), value]);
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const loop = node.parent.parent;
      const value = node.initializer ??
        (ts.isForOfStatement(loop) || ts.isForInStatement(loop) ? loop.expression : undefined);
      if (value) bind(node.name.text, value);
    } else if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isCallExpression(node.parent) &&
      ts.isPropertyAccessExpression(node.parent.expression) &&
      ARRAY_CALLBACKS.has(node.parent.expression.name.text)
    ) {
      const item = node.parameters[0]?.name;
      if (item && ts.isIdentifier(item)) bind(item.text, node.parent.expression.expression);
    } else if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = importTarget(file, node.moduleSpecifier.text);
      const named = node.importClause?.namedBindings;
      if (target && named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          imports.set(element.name.text, { file: target, name: (element.propertyName ?? element.name).text });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { source, bindings, imports };
}

function scriptModuleLoader() {
  const cache = new Map<string, ScriptModule | undefined>();
  return (file: string): ScriptModule | undefined => {
    if (!cache.has(file)) {
      cache.set(file, fs.existsSync(path.join(root, file)) ? parseScriptModule(file) : undefined);
    }
    return cache.get(file);
  };
}

// String literals an expression can take its value from, following local
// bindings and relative imports (buildCommands reaches build-local.mjs so).
function reachableLiterals(
  load: (file: string) => ScriptModule | undefined,
  file: string,
  node: ts.Node,
  seen = new Set<string>()
): string[] {
  const literals: string[] = [];
  const follow = (moduleFile: string, name: string) => {
    const target = load(moduleFile);
    const key = `${moduleFile}#${name}`;
    if (!target || seen.has(key)) return;
    seen.add(key);
    for (const value of target.bindings.get(name) ?? []) {
      literals.push(...reachableLiterals(load, moduleFile, value, seen));
    }
    const imported = target.imports.get(name);
    if (imported) follow(imported.file, imported.name);
  };
  const visit = (child: ts.Node) => {
    if (ts.isStringLiteralLike(child)) literals.push(child.text);
    const parent = child.parent;
    const isPropertyName =
      (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === child;
    if (ts.isIdentifier(child) && !isPropertyName) follow(file, child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return literals;
}

function isSpawnCall(call: ts.CallExpression): boolean {
  const callee = call.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
  return SPAWN_FUNCTIONS.has(name);
}

function startsNextBuild(
  load: (file: string) => ScriptModule | undefined,
  file: string,
  call: ts.CallExpression
): boolean {
  const [program, args] = call.arguments;
  const command = [program, args].filter(
    (argument): argument is ts.Expression => argument !== undefined && !ts.isObjectLiteralExpression(argument)
  );
  // A bare "next" names the CLI only as the program or one of its literal
  // arguments (npx next build), never inside a path such as .e2e/army/next.
  const words = [program, ...(args && ts.isArrayLiteralExpression(args) ? args.elements : [])]
    .filter((node): node is ts.StringLiteralLike => node !== undefined && ts.isStringLiteralLike(node))
    .map((node) => node.text);
  const reachable = command.flatMap((argument) => reachableLiterals(load, file, argument));
  return (
    (reachable.includes("build") && reachable.some((value) => NEXT_CLI_PATH.test(value))) ||
    invokesNextBuild(words) ||
    reachable.some(runsNextBuild)
  );
}

function isNextBuildEnvironmentCall(scope: ScriptModule, file: string, node: ts.Expression): boolean {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return false;
  const imported = scope.imports.get(node.expression.text);
  return imported
    ? imported.file === NEXT_BUILD_ENV_MODULE && imported.name === NEXT_BUILD_ENVIRONMENT
    : file === NEXT_BUILD_ENV_MODULE && node.expression.text === NEXT_BUILD_ENVIRONMENT;
}

function rewritesNodeOptions(source: ts.SourceFile, name: string): boolean {
  const targetsNodeOptions = (node: ts.Expression) => {
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== name) return false;
    const key = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : "";
    return key === "NODE_OPTIONS";
  };
  let rewritten = false;
  const visit = (node: ts.Node) => {
    const assigns =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      targetsNodeOptions(node.left);
    if (assigns || (ts.isDeleteExpression(node) && targetsNodeOptions(node.expression))) rewritten = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return rewritten;
}

function nextBuildEnvironmentProblem(scope: ScriptModule, file: string, call: ts.CallExpression) {
  const expected = `${NEXT_BUILD_ENVIRONMENT}() from ${NEXT_BUILD_ENV_MODULE}`;
  const options = call.arguments.slice(1).find(ts.isObjectLiteralExpression);
  const env = options?.properties.find(
    (property): property is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      property.name.getText() === "env"
  );
  if (!env) return `inherits its parent's environment instead of ${expected}`;
  const value = ts.isShorthandPropertyAssignment(env) ? env.name : env.initializer;
  if (isNextBuildEnvironmentCall(scope, file, value)) return undefined;
  if (!ts.isIdentifier(value)) return `its env (${value.getText()}) is not ${expected}`;
  const declarations: ts.VariableDeclaration[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === value.text) {
      declarations.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(scope.source);
  const [declaration] = declarations;
  if (
    declarations.length !== 1 ||
    !(ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) ||
    !declaration.initializer ||
    !isNextBuildEnvironmentCall(scope, file, declaration.initializer)
  ) {
    return `its env (${value.text}) is not a const result of ${expected}`;
  }
  if (rewritesNodeOptions(scope.source, value.text)) {
    return `its env (${value.text}) has NODE_OPTIONS deleted or rewritten`;
  }
  return undefined;
}

type NextBuildSpawn = { file: string; site: string; problem?: string };

function nextBuildSpawns(): NextBuildSpawn[] {
  const load = scriptModuleLoader();
  const files = fs
    .readdirSync(path.join(root, "scripts"), { recursive: true, encoding: "utf8" })
    .filter((name) => /\.[cm]?[jt]s$/u.test(name))
    .map((name) => path.posix.join("scripts", name.split(path.sep).join("/")))
    .sort();
  expect(files.length).toBeGreaterThan(0);

  return files.flatMap((file) => {
    const scope = load(file);
    if (!scope) return [];
    const spawns: NextBuildSpawn[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && isSpawnCall(node) && startsNextBuild(load, file, node)) {
        const line = scope.source.getLineAndCharacterOfPosition(node.getStart(scope.source)).line + 1;
        spawns.push({ file, site: `${file}:${line}`, problem: nextBuildEnvironmentProblem(scope, file, node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(scope.source);
    return spawns;
  });
}

type Environment = Record<string, string | undefined>;

// Old-space limit (MiB) V8 derives from NODE_OPTIONS on this host, 0 when none
// is set: a percentage of physical memory overrides any absolute size whatever
// their order; otherwise the last absolute size wins (measured on Node 24).
function effectiveHeapMib(nodeOptions: string | undefined): number {
  const words = (nodeOptions ?? "").split(/\s+/u);
  const last = (option: RegExp) => words.flatMap((word) => option.exec(word)?.[1] ?? []).at(-1);
  const percentage = last(/^--max[-_]old[-_]space[-_]size[-_]percentage=(\d+(?:\.\d+)?)$/u);
  if (percentage !== undefined) return (os.totalmem() * Number(percentage)) / 100 / 2 ** 20;
  return Number(last(/^--max[-_]old[-_]space[-_]size=(\d+)$/u) ?? 0);
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
    // A sub-action (actions/cache/restore) is pinned by its repository commit.
    for (const line of actionLines) {
      expect(line).toMatch(/uses:\s+[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-f0-9]{40}(?:\s+#\s+v\d[^\s]*)?$/u);
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

  // A browser cannot observe its parent CI's verdict or the local gate's
  // command selection. Execute the actual workflow shell and package chain;
  // only the child npm commands are controlled, without running other suites.
  it.each([
    { event: "pull_request", build: "skipped" },
    { event: "pull_request", build: "success" },
    { event: "push", build: "success" },
    { event: "workflow_dispatch", build: "success" },
  ])("accepts the complete quality results for $event (build=$build)", ({ event, build }) => {
    const script = runScript(stepNamed(read(".github/workflows/quality-gate.yml"), "Aggregate results"))
      .replaceAll("${{ needs.static.result }}", "success")
      .replaceAll("${{ needs.tests.result }}", "success")
      .replaceAll("${{ needs.build.result }}", build);
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", GITHUB_EVENT_NAME: event },
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });

  it.each([
    { event: "pull_request", job: "static", status: "skipped" },
    { event: "pull_request", job: "tests", status: "skipped" },
    { event: "push", job: "static", status: "skipped" },
    { event: "push", job: "tests", status: "skipped" },
    { event: "push", job: "build", status: "skipped" },
    { event: "workflow_dispatch", job: "build", status: "skipped" },
    ...["static", "tests", "build"].flatMap((job) =>
      ["failure", "cancelled", "", "unknown"].map((status) => ({ event: "pull_request", job, status }))
    ),
  ])("refuses $job=$status in the quality aggregate for $event", ({ event, job, status }) => {
    let script = runScript(stepNamed(read(".github/workflows/quality-gate.yml"), "Aggregate results"));
    for (const name of ["static", "tests", "build"]) {
      script = script.replaceAll(`\${{ needs.${name}.result }}`, name === job ? status : "success");
    }
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", GITHUB_EVENT_NAME: event },
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
    expect(result.stdout).not.toContain("Quality Gate au vert.");
  });

  it.each([
    { command: "check:repository-hygiene", job: "static" },
    { command: "check:army-recipes", job: "tests" },
  ].flatMap((entry) => ["local", "CI"].map((gate) => ({ ...entry, gate }))))(
    "runs $command and propagates its child failure in the $gate gate", ({ command, job, gate }) => {
      const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
      let shell = scripts["check:quality"];
      if (gate === "CI") {
        const jobs = workflowJobs(read(".github/workflows/quality-gate.yml"));
        const step = workflowSteps(jobs[job]).find((candidate) =>
          new RegExp(`^\\s+run: npm run ${command}\\s*$`, "mu").test(candidate)
        );
        expect(step, `${job} must run the real ${command} command`).toBeDefined();
        expect(step).toMatch(/^\s+if: \$\{\{ !cancelled\(\) \}\}$/mu);
        const ciCommand = /^\s+run: (.+)$/mu.exec(step!)?.[1];
        expect(ciCommand).toBeDefined();
        shell = ciCommand!;
      }
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quality-gate-commands-"));
      try {
        const executable = path.join(directory, "npm");
        const log = path.join(directory, "commands.log");
        fs.writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\nif [ "$1" = run ] && [ "$2" = "$FAIL_COMMAND" ]; then exit 31; fi\n');
        fs.chmodSync(executable, 0o755);
        for (const fail of ["", command]) {
          fs.writeFileSync(log, "");
          const result = spawnSync("bash", ["-c", shell], {
            cwd: directory, encoding: "utf8", env: {
              NODE_ENV: "test",
              PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
              COMMAND_LOG: log, FAIL_COMMAND: fail,
            },
          });
          const calls = fs.readFileSync(log, "utf8").trim().split("\n");
          expect(calls, `${command} must execute exactly once`).toContain(`run ${command}`);
          expect(calls.filter((call) => call === `run ${command}`)).toHaveLength(1);
          expect(result.status, `${result.stdout}${result.stderr}`).toBe(fail ? 31 : 0);
          if (fail) expect(calls.at(-1)).toBe(`run ${command}`);
        }
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it("runs the offline RMO admission check with the platform interpreter and refuses its absence", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quality-gate-python-"));
    try {
      const pythonCommand = process.platform === "win32" ? "python" : "python3";
      const probe = spawnSync(pythonCommand, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
      expect(probe.status, `${probe.stdout}${probe.stderr}`).toBe(0);
      // Windows needs the real installation beside python.exe (DLLs and stdlib),
      // and a file symlink can require privileges. POSIX keeps a single-command PATH.
      const presentPath = process.platform === "win32" ? path.dirname(probe.stdout.trim()) : directory;
      if (process.platform !== "win32") fs.symlinkSync(probe.stdout.trim(), path.join(directory, pythonCommand));
      const run = (interpreterPath: string) => spawnSync(process.execPath, ["scripts/tester-army/check-cctp-rmo.mjs"], {
        cwd: root, encoding: "utf8", timeout: 20_000,
        env: { NODE_ENV: "test", PATH: interpreterPath, SystemRoot: process.env.SystemRoot },
      });
      const present = run(presentPath);
      expect(present.status, `${present.stdout}${present.stderr}`).toBe(0);
      expect(JSON.parse(present.stdout)).toMatchObject({ passed: 12, total: 12 });
      if (process.platform !== "win32") fs.unlinkSync(path.join(directory, pythonCommand));
      const absent = run(directory);
      expect(absent.status, `${absent.stdout}${absent.stderr}`).not.toBe(0);
      expect(absent.stdout).not.toContain('"passed":12');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
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

  it("starts every job of an Army business workflow with the same target guard", () => {
    const guards = new Set<string>();
    let jobs = 0;
    for (const { file } of ARMY_WORKFLOWS) {
      for (const [id, job] of Object.entries(workflowJobs(read(file)))) {
        jobs += 1;
        const first = workflowSteps(job)[0] ?? "";
        expect(first, `${file} job ${id}`).toMatch(/^\s+id: target_guard$/mu);
        expect(first, `${file} job ${id}`).toContain("NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321");
        guards.add(runScript(first));
      }
    }
    expect(jobs).toBeGreaterThan(ARMY_WORKFLOWS.length);
    expect(guards.size).toBe(1);
  });

  // A `${{ }}` expression is pasted into the script text before the shell runs
  // it: a dispatch input (grep pattern, phase), a selector output listing a pull
  // request's file names, or a matrix value can then inject shell code. These
  // values reach a script only through `env:` and quoted expansion; only a
  // needed job's result, a fixed word, stays inline.
  it("never interpolates workflow inputs, step outputs or event text into a shell script", () => {
    const workflowDirectory = path.join(root, ".github", "workflows");
    const offenders: string[] = [];
    for (const name of fs.readdirSync(workflowDirectory).filter((entry) => /\.ya?ml$/u.test(entry)).sort()) {
      for (const { line, script } of runValues(read(`.github/workflows/${name}`))) {
        for (const expression of shellInterpolations(script)) offenders.push(`${name}:${line}: ${expression}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds every expression of a shell script, braces inside it and unclosed ones included", () => {
    const needed = '[[ "${{ needs.army-critical.result }}" == success ]]';
    expect(shellInterpolations(needed)).toEqual([]);
    expect(shellInterpolations(`node x \${{ format('{0}', inputs.grep) }} && ${needed}`)).toHaveLength(1);
    expect(shellInterpolations("echo ${{ toJSON(github.event.pull_request.title) }}")).toHaveLength(1);
    expect(shellInterpolations("echo ${{ needs.a.result || inputs.phase }}")).toHaveLength(1);
    expect(shellInterpolations('echo "${{ needs.a.result }}${{ inputs.phase }}"')).toHaveLength(1);
    // The workflow parser still expands an expression the scan cannot close.
    expect(shellInterpolations("echo ${{ inputs.phase")).toHaveLength(1);
  });

  it("filters a dispatched full run by --grep only, while the nightly schedule stays the whole full suite", () => {
    const workflow = read(".github/workflows/e2e-army-full.yml");
    const trigger = workflow.slice(0, workflow.search(/^permissions:/mu));
    expect(trigger).toMatch(/^ {2}schedule:\n {4}- cron: '15 3 \* \* \*'$/mu);
    expect(trigger).toMatch(/^ {4}inputs:\n {6}grep:\n(?: {8}.*\n)*? {8}required: false\n/mu);
    expect(trigger).toMatch(/^ {6}grep:\n(?: {8}.*\n)*? {8}type: string\n/mu);
    expect(trigger).toMatch(/^ {6}grep:\n(?: {8}.*\n)*? {8}default: ""\n/mu);
    const jobs = workflowJobs(workflow);
    const plan = stepNamed(jobs["army-full-plan"], "Plan the full suite shards");
    const run = stepNamed(jobs["army-full-shard"], "Run native database and TesterArmy full journeys");
    // A schedule has no inputs: the expression keeps it explicit and empty.
    const grepEnv = /^\s+ARMY_GREP: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.grep \|\| '' \}\}$/mu;
    expect(plan).toMatch(grepEnv);
    expect(run).toMatch(grepEnv);
    // A filtered dispatch is one unsharded shard of the runner's own --grep
    // selection, without the development job; otherwise each shard runs its files.
    expect(runScript(plan)).toContain('if [[ -n "$ARMY_GREP" ]]; then args+=(--unsharded "dispatch --grep"); fi');
    expect(run).toContain('run: node --import tsx scripts/run-tester-army-ci.ts full --shard "$ARMY_SHARD" ${ARMY_FILES:+--files "$ARMY_FILES"} ${ARMY_GREP:+--grep "$ARMY_GREP"}');
    expect(run).toMatch(/^\s+ARMY_FILES: \$\{\{ matrix\.files \}\}$/mu);
    expect(jobs["army-full-development"]).toMatch(/^ {4}if: needs\.army-full-plan\.outputs\.development == 'separate'$/mu);
    expect(stepNamed(jobs["army-full-development"], "Run native database and TesterArmy development journeys"))
      .toContain("run: node --import tsx scripts/run-tester-army-ci.ts full --phase development\n");

    // A filtered run proves a few tests only: its title, its check on the commit
    // and its artifact say so, while the nightly and an unfiltered dispatch keep
    // the names that qualify the full suite.
    const filtered = "github.event_name == 'workflow_dispatch' && inputs.grep != ''";
    const named = (whenFiltered: string, otherwise: string) => `\${{ ${filtered} && '${whenFiltered}' || '${otherwise}' }}`;
    expect(trigger).toMatch(/^run-name: /mu);
    expect(trigger).toContain(`\nrun-name: ${named("TesterArmy Full (filtré --grep, non qualifiant)", "TesterArmy Full")}\n`);
    expect(jobs["army-full"]).toMatch(/^\n {4}name: /u);
    expect(jobs["army-full"]).toContain(`\n    name: ${named("army-full (filtré --grep, non qualifiant)", "army-full")}\n`);
    expect(stepNamed(jobs["army-full"], "Retain sanitized business evidence"))
      .toContain(`\n          name: ${named("army-full-filtered-evidence", "army-full-evidence")}\n`);
    expect(stepNamed(jobs["army-full-shard"], "Announce a filtered full run")).toContain(`\n        if: ${filtered}\n`);
    // inputs.grep is read only by the two ARMY_GREP (plan and shard) and by that predicate.
    expect(workflow.split("inputs.grep").length - 1).toBe(2 + workflow.split(filtered).length - 1);
  });

  // Parallel jobs (docs/testing/tester-army-ci.md, "Jobs parallèles"): a
  // sharded suite is green only through its aggregate job. Ways the wiring
  // could turn a partial run into a green check: the aggregate does not need
  // every job it vouches for, runs only on success (a failed shard then shows
  // a skipped, not a red, check) or after a cancellation, hands the aggregator
  // other job results than its own, reads another suite's artifacts or misses
  // a shard's; the matrix is not the plan job's output or stops at the first
  // red shard; or the aggregate check changes the name watchers read.
  it("checks every sharded Army suite in one stable aggregate job that needs every job it plans", async () => {
    const { AGGREGATE_JOBS } = await import("../../scripts/tester-army/aggregate-shards");
    const fullName = "${{ github.event_name == 'workflow_dispatch' && inputs.grep != '' && 'army-full (filtré --grep, non qualifiant)' || 'army-full' }}";
    const suites = [
      { suite: "critical", file: ".github/workflows/e2e-army-critical.yml", output: "critical_shards", aggregate: "army-critical", name: "army-critical",
        unit: "army-critical-shard-${{ matrix.shard }}-evidence", pattern: "army-critical-shard-*-evidence", artifact: "army-critical-evidence" },
      { suite: "takeoff", file: ".github/workflows/e2e-army-critical.yml", output: "takeoff_shards", aggregate: "army-takeoff", name: "army-takeoff",
        unit: "army-takeoff-shard-${{ matrix.shard }}-evidence", pattern: "army-takeoff-shard-*-evidence", artifact: "army-takeoff-evidence" },
      { suite: "full", file: ".github/workflows/e2e-army-full.yml", output: "shards", aggregate: "army-full", name: fullName,
        unit: "army-full-shard-${{ matrix.shard }}-evidence", pattern: "army-full-*-evidence", artifact: "army-full-evidence" },
      { suite: "calc-v3", file: ".github/workflows/e2e-army-calc-v3.yml", output: "phases", aggregate: "army-calc-v3", name: "army-calc-v3",
        unit: "army-calc-v3-${{ matrix.phase }}-evidence", pattern: "army-calc-v3-*-evidence", artifact: "army-calc-v3-evidence" },
    ] as const;
    for (const { suite, file, output, aggregate, name, unit, pattern, artifact } of suites) {
      const workflow = read(file);
      const jobs = workflowJobs(workflow);
      const { plan, units, development } = AGGREGATE_JOBS[suite];
      const needed = [plan, units, ...(development ? [development] : [])];
      // A workflow holds exactly the jobs of the suites it aggregates (critical and takeoff share one).
      const fileJobs = suites.filter((other) => other.file === file).flatMap((other) => {
        const jobsOf = AGGREGATE_JOBS[other.suite];
        return [jobsOf.plan, jobsOf.units, ...(jobsOf.development ? [jobsOf.development] : []), other.aggregate];
      });
      expect(Object.keys(jobs).sort(), file).toEqual([...new Set(fileJobs)].sort());

      // The matrix is the plan job's output, and a red shard never cancels the others.
      expect(jobs[units], file).toMatch(new RegExp(`^ {4}needs: ${plan}$`, "mu"));
      expect(jobs[units], file).toMatch(/^ {6}fail-fast: false$/mu);
      expect(jobs[units], file).toContain(`: \${{ fromJSON(needs.${plan}.outputs.${output}) }}\n`);
      expect(jobs[units], file).toContain(`\n          name: ${unit}\n`);

      // The aggregate needs every job it vouches for and runs after their
      // failure, never after a cancelled run; its name is the stable check.
      const job = jobs[aggregate];
      expect(job, file).toContain(`\n    name: ${name}\n`);
      expect(job, file).toContain(`\n    needs: [${needed.join(", ")}]\n`);
      expect(job, file).toContain("\n    if: ${{ !cancelled() }}\n");
      const step = stepNamed(job, "Aggregate the");
      const results = [...step.matchAll(/^\s+([A-Z_]+_RESULT): \$\{\{ needs\.([a-z0-9-]+)\.result \}\}$/gmu)];
      expect(results.map((match) => match[2]).sort(), file).toEqual([...needed].sort());
      const script = runValues(step).map((value) => value.script).join("\n");
      expect(script, file).toContain(`scripts/tester-army/aggregate-shards.ts ${suite}`);
      for (const [, variable, need] of results) expect(script, file).toContain(`${need}=$${variable}`);
      expect(script, file).toContain('--revision "$GITHUB_SHA"');
      const upload = stepNamed(job, "Retain sanitized business evidence");
      expect(upload, file).toContain("\n        if: always() && steps.aggregate.outputs.evidence != ''\n");
      expect(upload, file).toContain("\n          path: ${{ steps.aggregate.outputs.evidence }}\n");
      expect(upload, file).toContain(artifact);

      // It downloads every unit's artifact and none of the aggregate's own.
      expect(job, file).toContain(`\n          pattern: ${pattern}\n`);
      const glob = new RegExp(`^${pattern.replace(/\./gu, "\\.").replace("*", "[^/]+")}$`, "u");
      const units_ = (suite === "calc-v3" ? ["journeys", "offers"] : ["1", "12"]).map((value) => unit.replace(/\$\{\{ matrix\.[a-z]+ \}\}/u, value));
      if (development) {
        units_.push("army-full-development-evidence");
        expect(jobs[development], file).toContain("\n          name: army-full-development-evidence\n");
      }
      for (const name_ of units_) expect(glob.test(name_), `${file} ${name_}`).toBe(true);
      expect(glob.test(artifact), file).toBe(false);
      expect(workflow.split(`name: ${artifact}\n`).length - 1, file).toBeLessThanOrEqual(1);
    }
  });

  it("runs every production-served calc-v3 phase nightly and on the pull requests that edit it, any phase on dispatch", async () => {
    const { CALC_V3_PHASES, CALC_V3_PHASE_DEFINITIONS } = await import("../../scripts/tester-army/calc-v3-phases");
    const workflow = read(".github/workflows/e2e-army-calc-v3.yml");
    const trigger = workflow.slice(0, workflow.search(/^permissions:/mu));
    const cron = /^ {2}schedule:\n(?: {4}#.*\n)* {4}- cron: '([^']+)'$/mu.exec(trigger)?.[1];
    expect(cron).toBeDefined();
    // Offset from the nightly full suite (03:15 UTC) and the backup (02:25 UTC).
    expect(cron).not.toBe("15 3 * * *");
    expect(cron).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/u);
    const options = /^ {6}phase:\n(?: {8}(?!options:).*\n)*? {8}options:\n((?: {10}- .*\n)+)/mu.exec(trigger)?.[1];
    expect(options?.split("\n").filter(Boolean).map((line) => line.trim().replace(/^- /u, ""))).toEqual(["nightly", "all", ...CALC_V3_PHASES]);
    expect(trigger).toMatch(/^ {6}phase:\n(?: {8}.*\n)*? {8}type: choice\n/mu);
    expect(trigger).toMatch(/^ {6}phase:\n(?: {8}.*\n)*? {8}default: nightly\n/mu);
    // GitHub schedules and dispatches only a workflow already on the default
    // branch: a pull request that edits this one runs its nightly selection, so
    // the change is proven before it merges; no other pull request runs it.
    expect(trigger).toMatch(/^ {2}pull_request:\n {4}branches: \[main\]\n {4}paths:\n {6}- \.github\/workflows\/e2e-army-calc-v3\.yml\n(?! {6}- )/mu);
    expect(trigger.match(/^ {2}[a-z_]+:/gmu)).toEqual(["  workflow_dispatch:", "  pull_request:", "  schedule:"]);
    // Each push to that pull request replaces its previous run; a nightly or a
    // dispatch is never cancelled.
    expect(workflow).toContain("\n  group: army-calc-v3-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}\n");
    expect(workflow).toContain("\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n");

    // The nightly selection is exactly the phases the owned production build
    // serves. Since sub-lot 2.7 that includes emission and emission-v3; a phase
    // moved back to next dev must also leave the nightly list.
    const plan = stepNamed(workflow, "Plan the calc-v3 phases");
    const nightly = /^\s+CALC_V3_NIGHTLY_PHASES: "([a-z0-9 -]+)"$/mu.exec(plan)?.[1].split(" ");
    expect(nightly).toEqual(CALC_V3_PHASES.filter((phase) => CALC_V3_PHASE_DEFINITIONS[phase].serverMode === "production"));
    if (CALC_V3_PHASE_DEFINITIONS.emission.serverMode !== "production") expect(nightly).not.toContain("emission");
    expect(plan).toMatch(/^\s+CALC_V3_SELECTION: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.phase \|\| 'nightly' \}\}$/mu);
    // One job and one owned stack per planned phase ("all" is one job of the
    // whole campaign); only evidence that passed the runner's privacy check
    // is uploaded.
    const run = stepNamed(workflow, "Run native database and TesterArmy calc-v3 phases");
    expect(run).toMatch(/^\s+CALC_V3_PHASE: \$\{\{ matrix\.phase \}\}$/mu);
    const script = runScript(run);
    expect(script).toContain('node --import tsx scripts/run-tester-army-ci.ts calc-v3 --phase "$CALC_V3_PHASE"');
    expect(script).toContain('if [[ "$CALC_V3_PHASE" == "all" ]]; then\n  node --import tsx scripts/run-tester-army-ci.ts calc-v3\n');
    expect(script).not.toMatch(/\|\|\s*true/u);
    expect(workflow).not.toContain("E2E_ARMY_WORKERS");

    // The plan script itself, run for real when bash is available: each
    // selection gives its JSON list, and a value a list cannot carry verbatim is refused.
    if (!canRunGuard && !process.env.CI) return;
    const planned = (selection: string) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-calc-v3-plan-"));
      try {
        const output = path.join(directory, "output.txt");
        fs.writeFileSync(output, "");
        const result = spawnSync("bash", ["-c", runScript(plan)], {
          encoding: "utf8",
          env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? "", GITHUB_OUTPUT: output,
            CALC_V3_NIGHTLY_PHASES: nightly!.join(" "), CALC_V3_SELECTION: selection },
        });
        return { status: result.status, phases: /^phases=(.*)$/mu.exec(fs.readFileSync(output, "utf8"))?.[1] };
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    };
    expect(planned("nightly")).toEqual({ status: 0, phases: JSON.stringify(nightly) });
    expect(planned("all")).toEqual({ status: 0, phases: '["all"]' });
    expect(planned("emission")).toEqual({ status: 0, phases: '["emission"]' });
    for (const injected of ['journeys","x', "journeys components", "x$(id)"]) {
      expect(planned(injected), injected).toEqual({ status: 1, phases: undefined });
    }
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

  it("runs one Army worker unless critical journeys use the owned ephemeral stack", () => {
    // Journeys share one account, tenant and ARMY fixtures. Parallel workers
    // would write concurrently to a shared stack's fixtures or measure
    // performance budgets under load; on the owned stack (the only runner that
    // sets E2E_ARMY_LOCAL_DB_URL) 2 workers are qualified (two green full
    // critical runs on 16/10/2026) and 3 stay exploratory. Each case
    // re-evaluates e2e.config.ts as the e2e CLI would load it.
    const ownedDatabase = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    const cases = [
      { env: {}, workers: 1 as number | string },
      { env: { E2E_ARMY_SUITE: "critical", E2E_ARMY_LOCAL_DB_URL: ownedDatabase, E2E_ARMY_WORKERS: "3" }, workers: 3 },
      { env: { E2E_ARMY_SUITE: "critical", E2E_ARMY_WORKERS: "2" }, workers: "refused" },
      { env: { E2E_ARMY_SUITE: "performance", E2E_ARMY_LOCAL_DB_URL: ownedDatabase, E2E_ARMY_WORKERS: "3" }, workers: "refused" },
      { env: { E2E_ARMY_SUITE: "coverage", E2E_ARMY_LOCAL_DB_URL: ownedDatabase, E2E_ARMY_WORKERS: "2" }, workers: "refused" },
      { env: { E2E_ARMY_SUITE: "agent", E2E_ARMY_LOCAL_DB_URL: ownedDatabase, E2E_ARMY_WORKERS: "2" }, workers: "refused" },
      { env: { E2E_ARMY_SUITE: "critical", E2E_ARMY_LOCAL_DB_URL: ownedDatabase, E2E_ARMY_WORKERS: "9" }, workers: "refused" },
    ];
    const probe = [
      'import { pathToFileURL } from "node:url";',
      "const results = [];",
      "for (const [index, env] of JSON.parse(process.env.ARMY_WORKER_CASES).entries()) {",
      '  for (const name of ["E2E_ARMY_SUITE", "E2E_ARMY_CRITICAL_SELECTION", "E2E_ARMY_LOCAL_DB_URL", "E2E_ARMY_WORKERS"]) {',
      "    delete process.env[name];",
      "  }",
      "  Object.assign(process.env, env);",
      "  try {",
      '    const loaded = await import(`${pathToFileURL("e2e.config.ts").href}?case=${index}`);',
      "    results.push((loaded.default?.default ?? loaded.default).workers);",
      "  } catch (error) {",
      '    results.push(String(error?.message).startsWith("E2E_ARMY_WORKERS") ? "refused" : String(error));',
      "  }",
      "}",
      "console.log(JSON.stringify(results));",
    ].join("\n");
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", probe], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        E2E_ARMY_BASE_URL: "http://localhost:3107",
        ARMY_WORKER_CASES: JSON.stringify(cases.map(({ env }) => env)),
      },
      timeout: 60_000,
      windowsHide: true,
    });

    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null")).toEqual(cases.map(({ workers }) => workers));
  }, 60_000);

  it("uses the project-pinned Supabase CLI for backups", () => {
    const workflow = read(".github/workflows/supabase-backup.yml");

    expect(workflow).not.toMatch(/^\s{2}workflow_dispatch:/mu);
    expect(workflow).toContain("run: npm ci --ignore-scripts");
    expect(workflow).toContain("run: npm audit signatures");
    expect(workflow).toContain("npx --no-install supabase --version");
    expect(workflow).toContain('= "2.121.0"');
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

  it("starts every production and E2E Next build through the heap-limit launcher", () => {
    const { scripts } = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const { buildCommand } = JSON.parse(read("vercel.json")) as { buildCommand?: string };
    const commands: [string, string][] = Object.entries(scripts).map(([name, command]) => [
      `package.json scripts.${name}`,
      command,
    ]);
    if (buildCommand) commands.push(["vercel.json buildCommand", buildCommand]);
    const workflowDirectory = path.join(root, ".github", "workflows");
    for (const name of fs.readdirSync(workflowDirectory).filter((entry) => /\.ya?ml$/u.test(entry)).sort()) {
      read(path.posix.join(".github/workflows", name))
        .split(/\r?\n/u)
        .forEach((line, index) => commands.push([`.github/workflows/${name}:${index + 1}`, line]));
    }

    // The matcher must see every CLI form, or the offender list below is vacuous.
    const forms = {
      "next build --webpack": true,
      "npx next@16.4.0 build --webpack": true,
      "node_modules\\.bin\\next.cmd build --webpack": true,
      "node node_modules/next/dist/bin/next build --webpack": true,
      "node scripts/next-build.mjs --webpack": false,
      "next dev --webpack": false,
    };
    expect(Object.fromEntries(Object.keys(forms).map((command) => [command, runsNextBuild(command)]))).toEqual(forms);

    const offenders = commands
      .filter(([, command]) => runsNextBuild(command))
      .map(([where, command]) => `${where}: ${command.trim()}`);
    if (!scripts.build?.split("&&").some((step) => step.trim().startsWith(`node ${NEXT_BUILD_LAUNCHER}`))) {
      offenders.push(`package.json scripts.build does not run node ${NEXT_BUILD_LAUNCHER}: ${scripts.build}`);
    }

    expect(
      offenders,
      "Next 16.4 type-checks with a tsc child that inherits NODE_OPTIONS, not node arguments; " +
        `start production and E2E builds with node ${NEXT_BUILD_LAUNCHER}.`
    ).toEqual([]);
  });

  it("gives every scripted Next build the launcher's heap-limit environment", () => {
    const spawns = nextBuildSpawns();
    const offenders = spawns
      .filter(({ problem }) => problem)
      .map(({ site, problem }) => `${site}: ${problem}`);
    const detected = new Set(spawns.map(({ file }) => file));
    const undetected = NEXT_BUILD_SPAWNERS.filter((file) => !detected.has(file));

    expect(
      { offenders, undetected },
      "A Next build spawned from scripts/** must receive " +
        `${NEXT_BUILD_ENVIRONMENT}() from ${NEXT_BUILD_ENV_MODULE} as its env, unchanged; ` +
        "a --max-old-space-size node argument does not reach the type-check child."
    ).toEqual({ offenders: [], undetected: [] });
  });

  it("gives the type-check child at least the build heap without dropping the caller's NODE_OPTIONS", async () => {
    const helpers = path.join(root, NEXT_BUILD_ENV_MODULE);
    expect(fs.existsSync(helpers), `${NEXT_BUILD_ENV_MODULE} holds the Next build heap helpers`).toBe(true);
    const exported = ((await import(pathToFileURL(helpers).href)) as Record<string, unknown>)[NEXT_BUILD_ENVIRONMENT];
    expect(exported, `${NEXT_BUILD_ENV_MODULE} exports ${NEXT_BUILD_ENVIRONMENT}()`).toBeTypeOf("function");
    const environmentFor = exported as (environment: Environment) => Environment;

    // A lower caller value would bring the tsc crash back: it is raised, a
    // larger one is kept. 1 % of RAM stays below 4096 MiB on any build host.
    const guard = "--import=file:///guard.mjs";
    const cases = [
      { input: { E2E_ARMY: "1" }, kept: [] as string[], heap: NEXT_BUILD_HEAP_MIB },
      { input: { NODE_OPTIONS: guard }, kept: [guard], heap: NEXT_BUILD_HEAP_MIB },
      { input: { NODE_OPTIONS: `${guard} --max-old-space-size=8192` }, kept: [guard], heap: 8192 },
      { input: { NODE_OPTIONS: `${guard} --max-old-space-size=2048` }, kept: [guard], heap: NEXT_BUILD_HEAP_MIB },
      { input: { NODE_OPTIONS: "--max_old_space_size=1536 --trace-warnings" }, kept: ["--trace-warnings"], heap: NEXT_BUILD_HEAP_MIB },
      { input: { NODE_OPTIONS: "--max-old-space-size=8192 --max-old-space-size-percentage=1" }, kept: [], heap: NEXT_BUILD_HEAP_MIB },
    ];
    for (const { input, kept, heap } of cases) {
      const label = JSON.stringify(input);
      const output = environmentFor({ ...input });
      const nodeOptions = output.NODE_OPTIONS ?? "";
      for (const [key, value] of Object.entries(input).filter(([name]) => name !== "NODE_OPTIONS")) {
        expect(output[key], `${label} ${key}`).toBe(value);
      }
      expect(nodeOptions.split(/\s+/u), label).toEqual(expect.arrayContaining(kept));
      expect(effectiveHeapMib(nodeOptions), label).toBeGreaterThanOrEqual(heap);
    }
  });

  it("runs next build from the launcher with a lower caller heap raised and reported", () => {
    const result = spawnSync(process.execPath, [NEXT_BUILD_LAUNCHER, "--help"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "--max-old-space-size=2048" },
      timeout: 60_000,
      windowsHide: true,
    });

    expect({ status: result.status, error: result.error?.message }).toEqual({ status: 0, error: undefined });
    expect(result.stdout).toContain(
      `[next-build] next build --help with NODE_OPTIONS --max-old-space-size=${NEXT_BUILD_HEAP_MIB}`
    );
    expect(result.stderr).toContain(`[next-build] raised NODE_OPTIONS heap from 2048 to ${NEXT_BUILD_HEAP_MIB} MiB`);
    expect(result.stdout, "the launcher must reach the Next CLI").toContain("Usage: next build");
  }, 60_000);
});
