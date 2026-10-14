import path from "node:path";
import { pathToFileURL } from "node:url";

import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";
import { chatgpt } from "e2e/oauth/chatgpt";

const critical = process.env.E2E_ARMY_SUITE === "critical";
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
    env: {
      E2E_ARMY: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL ? { NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL } : {}),
      ...(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? { NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY } : {}),
      // The runner does not inherit this variable. Keep server credentials paired
      // with the selected backend instead of falling back to another .env.local.
      ...((critical || performance || coverage) && process.env.SUPABASE_SERVICE_ROLE_KEY
        ? { SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY }
        : {}),
      ...(coverage ? {
        NODE_OPTIONS: `--import=${pathToFileURL(path.resolve("scripts/tester-army/coverage-network-guard.mjs")).href}`,
        E2E_COVERAGE_BACKEND_ORIGIN: process.env.E2E_COVERAGE_BACKEND_ORIGIN!,
        E2E_ARMY_BASE_URL: baseUrl.origin,
        E2E_COVERAGE_NETWORK_LOG: process.env.E2E_COVERAGE_NETWORK_LOG!,
        GEMINI_API_KEY: "",
        GOOGLE_GENERATIVE_AI_API_KEY: "",
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
  tests: coverage ? ["e2e/army/critical/auth.setup.e2e.ts", process.env.E2E_COVERAGE_SCENARIO_SET === "generated-components" ? process.env.E2E_GENERATED_COMPONENTS_SELECTION === "assembly-totals" ? "e2e/army/local/assembly-totals.e2e.ts" : numericComponents ? "e2e/army/local/generated-ouvrage-numeric-entry.e2e.ts" : "e2e/army/local/generated-ouvrage-components.e2e.ts" : process.env.E2E_COVERAGE_SCENARIO_SET === "navigation-lease" ? "e2e/army/local/editor-navigation-lease.e2e.ts" : process.env.E2E_COVERAGE_SCENARIO_SET === "generated-recovery" ? "e2e/army/local/estimate-generated-recovery.e2e.ts" : process.env.E2E_COVERAGE_SCENARIO_SET === "generated-atomic" ? "e2e/army/local/estimate-generated-atomic.e2e.ts" : process.env.E2E_COVERAGE_SCENARIO_SET === "batch-atomic" ? "e2e/army/local/estimate-batch*.e2e.ts" : process.env.E2E_COVERAGE_SCENARIO_SET === "create-atomic" ? "e2e/army/local/estimate-create-atomic.e2e.ts" : "e2e/army/local/source-coverage.e2e.ts"] : critical ? "e2e/army/critical/**/*.e2e.ts" : performance
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
  workers: 1,
  retries: 0,
  timeout: 90_000,
  actionTimeout: 30_000,
  assertionTimeout: 15_000,
  cleanupTimeout: 30_000,
  output,
  // Generated Supabase tokens are not known to the SDK's password ledger.
  // Authenticated proof uses assertion steps and explicit business artifacts.
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
