import path from "node:path";
import { pathToFileURL } from "node:url";

import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";
import { chatgpt } from "e2e/oauth/chatgpt";

const critical = process.env.E2E_ARMY_SUITE === "critical";
const full = critical && process.env.E2E_ARMY_CRITICAL_SELECTION === "full";
const development = critical && process.env.E2E_ARMY_CRITICAL_SELECTION === "development";
const polish = critical && process.env.E2E_ARMY_CRITICAL_SELECTION === "polish";
const army021 = critical && process.env.E2E_ARMY_CRITICAL_SELECTION === "army-021";
const techDebt = critical && (army021 || process.env.E2E_ARMY_CRITICAL_SELECTION === "tech-debt-lot1");
const localBusiness = critical && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const coverage = process.env.E2E_ARMY_SUITE === "coverage";
const numericComponents = ["numeric-price", "numeric-decimals", "numeric-loss", "numeric-all"].includes(process.env.E2E_GENERATED_COMPONENTS_SELECTION ?? "");
const performance = process.env.E2E_ARMY_SUITE === "performance";
const live = performance && process.env.E2E_ARMY_SERVER_MODE === "live";
const production = performance || process.env.E2E_ARMY_SERVER_MODE === "production";
const output = coverage ? ".e2e/army/coverage" : critical ? ".e2e/army/critical" : performance ? ".e2e/army/performance" : ".e2e/army";
const baseUrl = new URL(
  process.env.E2E_ARMY_BASE_URL ?? "http://localhost:3107"
);
if (
  baseUrl.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname) ||
  baseUrl.username ||
  baseUrl.password ||
  baseUrl.pathname !== "/" ||
  baseUrl.search ||
  baseUrl.hash ||
  baseUrl.port === "0"
) {
  throw new Error("Tester Army requires a loopback HTTP origin with a fixed port.");
}

// Journeys share one account, tenant and ARMY fixtures: one worker by default.
// On 16/10/2026 (WSL, full critical suite) 3 workers first failed 2 runs out of
// 2 on the estimate-creation lock race (40001), then 2 workers failed 2 runs out
// of 3 on a transient HUB02 double render. With both fixed (GATE and HUB11
// journeys), 2 workers passed the full critical suite twice (68/68) and are
// qualified; 3 or 4 stay exploratory. Above 1, accepted only for critical
// journeys on the owned ephemeral stack, whose runner alone sets
// E2E_ARMY_LOCAL_DB_URL; never against a shared stack or for performance.
const workersSetting = process.env.E2E_ARMY_WORKERS ?? "";
if (workersSetting !== "" && !/^[1-4]$/.test(workersSetting)) {
  throw new Error(`E2E_ARMY_WORKERS must be an integer from 1 to 4 (default 1); received "${workersSetting}".`);
}
const workers = workersSetting === "" ? 1 : Number(workersSetting);
if (workers > 1 && !(critical && process.env.E2E_ARMY_LOCAL_DB_URL)) {
  throw new Error("E2E_ARMY_WORKERS above 1 is reserved for critical journeys on the owned ephemeral stack (npm run e2e:army:local or e2e:army:ci).");
}

// Next dev identifies itself as localhost; preserve hydration without config edits.
baseUrl.hostname = "localhost";
const app = {
  url: baseUrl.origin,
  readyUrl: `${baseUrl.origin}/login`,
  environment: "test" as const,
  ...(!live ? { command: {
    executable: process.execPath,
    args: [
      path.resolve("node_modules/next/dist/bin/next"),
      ...(production ? ["start"] : ["dev", "--webpack"]),
      ...(coverage && process.env.E2E_COVERAGE_STRIP_TYPES === "1" ? ["--experimental-next-config-strip-types"] : []),
      "--hostname",
      "localhost",
      "--port",
      baseUrl.port || "80",
    ],
    cwd: process.cwd(),
    // Only these per-run backend values reach the owned app. No login secrets.
    inheritEnv: [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ...((critical || performance || coverage) ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ],
    env: {
      E2E_ARMY: "1",
      ...((critical || coverage) ? { TAKEOFF_MODULE_ENABLED_BY_DEFAULT: "1" } : {}),
      NEXT_TELEMETRY_DISABLED: "1",
      ...(coverage || techDebt || localBusiness ? {
        NODE_OPTIONS: `--import=${pathToFileURL(path.resolve("scripts/tester-army/coverage-network-guard.mjs")).href}`,
        E2E_COVERAGE_BACKEND_ORIGIN: process.env.E2E_COVERAGE_BACKEND_ORIGIN!,
        E2E_ARMY_BASE_URL: baseUrl.origin,
        E2E_COVERAGE_NETWORK_LOG: process.env.E2E_COVERAGE_NETWORK_LOG!,
        GEMINI_API_KEY: "",
        GOOGLE_GENERATIVE_AI_API_KEY: "",
        ...(localBusiness ? { E2E_ARMY_BLOCK_WORKERS: "1" } : {}),
      } : {}),
    },
    startupTimeout: 180_000,
    shutdownTimeout: 15_000,
    log: `${output}/logs/app.log`,
    reuseExisting: false,
  } } : {}),
};

export default {
  projectId: coverage ? "miaouffrage-source-coverage" : critical ? "miaouffrage-critical-journeys" : performance ? "miaouffrage-performance" : "miaouffrage-anonymous-pilot",
  tests: polish ? ["e2e/army/critical/auth.setup.e2e.ts", "e2e/army/polish/**/*.e2e.ts"] : development ? ["e2e/army/critical/auth.setup.e2e.ts", "e2e/army/development/**/*.e2e.ts"] : full ? ["e2e/army/critical/**/*.e2e.ts", "e2e/army/extended/**/*.e2e.ts", "e2e/army/takeoff/**/*.e2e.ts", "e2e/army/local/tech-debt-lock-boundaries.e2e.ts", "e2e/army/local/estimate-create-calculation-gate.e2e.ts", "e2e/army/local/engine-v3-*.e2e.ts", "e2e/army/local/supplier-preselection-v1-totals.e2e.ts", "e2e/army/local/bulk-actions-v1-totals.e2e.ts"] : army021 ? ["e2e/army/critical/**/*.e2e.ts", "e2e/army/local/tech-debt-lock-boundaries.e2e.ts", "e2e/army/local/estimate-create-calculation-gate.e2e.ts"] : techDebt ? [
    "e2e/army/critical/auth.setup.e2e.ts",
    "e2e/army/critical/numeric-entry.e2e.ts",
    "e2e/army/critical/dpgf-import.e2e.ts",
    "e2e/army/local/tech-debt-lock-boundaries.e2e.ts",
  ] : coverage ? ["e2e/army/critical/auth.setup.e2e.ts", process.env.E2E_COVERAGE_SCENARIO_SET === "generated-components" ? process.env.E2E_GENERATED_COMPONENTS_SELECTION === "assembly-totals" ? "e2e/army/local/assembly-totals.e2e.ts" : numericComponents ? "e2e/army/local/generated-ouvrage-numeric-entry.e2e.ts" : "e2e/army/local/generated-ouvrage-components.e2e.ts" : process.env.E2E_COVERAGE_SCENARIO_SET === "navigation-lease" ? "e2e/army/local/editor-navigation-lease.e2e.ts" : process.env.E2E_COVERAGE_SCENARIO_SET === "generated-recovery" ? "e2e/army/local/estimate-generated-recovery.e2e.ts" : process.env.E2E_COVERAGE_SCENARIO_SET === "generated-atomic" ? "e2e/army/local/estimate-generated-atomic.e2e.ts" : process.env.E2E_COVERAGE_SCENARIO_SET === "batch-atomic" ? "e2e/army/local/estimate-batch*.e2e.ts" : process.env.E2E_COVERAGE_SCENARIO_SET === "create-atomic" ? "e2e/army/local/estimate-create-atomic.e2e.ts" : "e2e/army/local/source-coverage.e2e.ts"] : critical ? localBusiness ? ["e2e/army/critical/**/*.e2e.ts", "e2e/army/local/tech-debt-lock-boundaries.e2e.ts", "e2e/army/local/estimate-create-calculation-gate.e2e.ts", "e2e/army/local/engine-v3-*.e2e.ts"] : "e2e/army/critical/**/*.e2e.ts" : performance
    ? ["e2e/army/critical/auth.setup.e2e.ts", "e2e/army/performance/**/*.e2e.ts"]
    : "e2e/army/*.e2e.ts",
  targets: [
    {
      name: "chromium-desktop",
      engine: web({ browser: "chromium", viewport: { width: 1280, height: 800 } }),
      app,
    },
    {
      name: "chromium-mobile",
      engine: web({ browser: "chromium", viewport: { width: 390, height: 844 } }),
      app,
    },
  ],
  workers,
  retries: 0,
  // This lot normally takes a few minutes; a hung campaign must stay a failure.
  ...(critical ? { maxDuration: full ? 3_600_000 : techDebt ? 900_000 : 1_800_000 } : {}),
  timeout: 90_000,
  actionTimeout: 30_000,
  assertionTimeout: 15_000,
  cleanupTimeout: 30_000,
  output,
  // Generated Supabase tokens are not known to the SDK's password ledger.
  // Authenticated proof uses assertion steps and explicit business artifacts.
  // Since e2e 0.20 a trace is a markdown page (results/<test>/trace.md) rendered
  // from report.json, not a Playwright zip. "off" drops that page and the
  // per-step screen captures (step.screen in report.json, a screen read after
  // each action); report.json keeps the browser app log and navigation URLs in
  // every mode. scripts/run-tester-army.mjs pattern-scrubs authenticated
  // suites' report and trace pages before hashing them.
  trace: critical || performance || coverage ? "off" : "on",
  cache: process.env.E2E_ARMY_SUITE === "agent" ? "read-write" : "off",
  ...(critical || performance || coverage ? {
    credentials: {
      prehydration: {
        username: "army-prehydration@example.invalid",
        password: () => "ARMY-synthetic-unused-password",
      },
      army: {
        username: process.env.E2E_LOGIN_EMAIL ?? "unconfigured@example.invalid",
        password: () => {
          const password = process.env.E2E_LOGIN_PASSWORD;
          if (!password) throw new Error("E2E_LOGIN_PASSWORD is required for critical journeys.");
          return password;
        },
      },
    },
  } : {}),
  agents: {
    default: {
      model: chatgpt(process.env.E2E_ARMY_MODEL ?? "gpt-6-luna"),
      maxSteps: 6,
      maxModelCalls: 6,
      system:
        "Navigate only between the local public login and signup pages. Never fill inputs, submit forms, authenticate, upload, or follow external links. Verify the visible destination before finishing each goal.",
      context:
        "The French login heading is Connexion. Créer un compte is the signup link/heading; Se connecter is the signup return link. This is an anonymous navigation test.",
    },
  },
} satisfies E2EConfig;
