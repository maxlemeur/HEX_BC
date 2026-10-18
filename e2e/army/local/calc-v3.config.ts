import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

import { COLLECTOR_SENTINEL } from "../../../scripts/tester-army/offer-collector.mjs";
import {
  CALC_V3_EMAIL_FROM, CALC_V3_FORBIDDEN_PORTS, CALC_V3_PHASE_DEFINITIONS, isCalcV3Phase,
} from "../../../scripts/tester-army/calc-v3-phases";

// Lot 2 profile on the owned ephemeral native stack only. It is started by
// `scripts/run-tester-army-ci.ts calc-v3`, one TesterArmy invocation per phase;
// failure modes are fixed in docs/testing/tester-army-calc-v3.md. It refuses
// the developers' long-running stack (API 45585, DB 33485), any non-loopback
// origin and any environment the owned-stack runner did not mark. Every phase
// serves the owned production build; since 2.7 the emission phases get the
// sandbox terms of the owned calc-v3 production profile
// (src/lib/estimates/pdf-terms-server.ts), a development phase keeps next dev.
// offer-emission.config.ts stays unchanged.
function loopbackOrigin(name: string, options: { ipv4Only?: boolean } = {}) {
  const value = process.env[name];
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error(`calc-v3 requires an explicit loopback ${name}.`); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.port ||
    url.origin !== value || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    (options.ipv4Only && url.hostname !== "127.0.0.1")) {
    throw new Error(`calc-v3 requires an explicit loopback ${name}.`);
  }
  if (CALC_V3_FORBIDDEN_PORTS.has(url.port)) throw new Error(`calc-v3 refuses ${name} on the developers' long-running stack port ${url.port}.`);
  return url;
}

function ownedDirectory(name: string, root: string) {
  const configured = process.env[name];
  const directory = path.resolve(configured ?? "");
  const parent = path.resolve(root);
  if (!configured || !directory.startsWith(`${parent}${path.sep}`)) throw new Error(`calc-v3 requires ${name} inside ${root}.`);
  return directory;
}

if (process.versions.node.split(".")[0] !== "24") throw new Error("calc-v3 profile requires Node 24.");
if (process.env.E2E_CALC_V3_OWNED_STACK !== "1") throw new Error("calc-v3 runs only on the owned ephemeral stack of run-tester-army-ci.ts calc-v3.");
const phase = process.env.E2E_CALC_V3_PHASE;
if (!isCalcV3Phase(phase)) throw new Error("calc-v3 requires an explicit E2E_CALC_V3_PHASE.");
const definition = CALC_V3_PHASE_DEFINITIONS[phase];
const emission = definition.sentinelCollector === true;
const appOrigin = loopbackOrigin("E2E_ARMY_BASE_URL");
const backend = loopbackOrigin("NEXT_PUBLIC_SUPABASE_URL", { ipv4Only: true });
if (appOrigin.hostname !== "localhost") throw new Error("calc-v3 serves the app on localhost for Next hydration.");
if (process.env.E2E_COVERAGE_BACKEND_ORIGIN !== backend.origin || process.env.E2E_ALLOWED_SUPABASE_HOST !== backend.hostname) {
  throw new Error("calc-v3 backend, coverage origin and allowed host must name the same owned stack.");
}
if (process.env.E2E_ARMY_LOCAL_DB_URL !== undefined) {
  let database: URL;
  try { database = new URL(process.env.E2E_ARMY_LOCAL_DB_URL); } catch { throw new Error("calc-v3 refuses an unreadable PostgreSQL route."); }
  if (database.hostname !== backend.hostname || !database.port || CALC_V3_FORBIDDEN_PORTS.has(database.port)) {
    throw new Error("calc-v3 refuses a PostgreSQL route outside the owned stack.");
  }
}
const serverMode = definition.serverMode;
if ((process.env.E2E_ARMY_SERVER_MODE ?? "") !== serverMode) throw new Error(`calc-v3 phase ${phase} requires server mode ${serverMode}.`);
if (["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_TARGET_ENV"].some((name) => process.env[name] !== undefined)) {
  throw new Error("calc-v3 refuses hosting markers.");
}

let output: string;
let appEnvironment: Record<string, string>;
let secrets: E2EConfig["secrets"] | undefined;
if (emission) {
  const collector = loopbackOrigin("E2E_OFFER_COLLECTOR_ORIGIN", { ipv4Only: true });
  if (new Set([appOrigin.origin, backend.origin, collector.origin]).size !== 3 ||
    process.env.E2E_OFFER_APP_ORIGIN !== appOrigin.origin || process.env.E2E_OFFER_BACKEND_ORIGIN !== backend.origin ||
    process.env.RESEND_BASE_URL !== collector.origin || process.env.RESEND_API_KEY !== COLLECTOR_SENTINEL ||
    process.env.EMAIL_FROM !== CALC_V3_EMAIL_FROM) {
    throw new Error("calc-v3 emission origins or sentinel collector environment mismatch.");
  }
  // offer-emission-fixtures.ts confines the campaign under .e2e/army/offer/runs.
  const runDirectory = ownedDirectory("E2E_OFFER_RUN_DIRECTORY", ".e2e/army/offer/runs");
  if (!path.basename(runDirectory).includes("-calc-v3-")) throw new Error("calc-v3 emission requires its own named campaign directory.");
  const collectorDirectory = path.resolve(process.env.E2E_OFFER_COLLECTOR_DIRECTORY ?? "");
  const pointer = path.resolve(process.env.E2E_OFFER_SECRET_POINTER ?? "");
  const networkLog = path.resolve(process.env.E2E_OFFER_NETWORK_LOG ?? "");
  if (collectorDirectory !== path.join(runDirectory, "collector") || pointer !== path.join(runDirectory, "private", "portal-pointer.json") ||
    networkLog !== path.join(runDirectory, "public", "server-network.jsonl") || path.resolve(process.env.E2E_CALC_V3_OUTPUT ?? "") !== path.join(runDirectory, "sdk")) {
    throw new Error("calc-v3 emission collector, pointer, network log and output must stay inside its campaign.");
  }
  if (["E2E_SECRET_PORTALURL", "E2E_SECRET_PORTALTOKEN"].some((name) => process.env[name] !== undefined)) {
    throw new Error("calc-v3 portal secrets come only from the private pointer.");
  }
  output = path.join(runDirectory, "sdk");
  appEnvironment = {
    E2E_OFFER_SERVER_MODE: serverMode === "production" ? "production" : "dev",
    E2E_OFFER_SANDBOX_TERMS: serverMode === "production" ? "1" : "",
    // The owned-stack marker checked above: the sandbox terms of the owned calc-v3 production
    // profile also require it and this campaign directory in the app process (pdf-terms-server.ts).
    E2E_CALC_V3_OWNED_STACK: "1",
    E2E_OFFER_APP_ORIGIN: appOrigin.origin, E2E_OFFER_BACKEND_ORIGIN: backend.origin, E2E_OFFER_COLLECTOR_ORIGIN: collector.origin,
    E2E_OFFER_RUN_DIRECTORY: runDirectory, E2E_OFFER_COLLECTOR_DIRECTORY: collectorDirectory, E2E_OFFER_SECRET_POINTER: pointer,
    E2E_OFFER_SERVER_GUARD: "1", E2E_OFFER_NETWORK_LOG: networkLog,
    NODE_OPTIONS: `--import=${pathToFileURL(path.resolve("scripts/tester-army/offer-network-guard.mjs")).href}`,
    RESEND_BASE_URL: collector.origin, RESEND_API_KEY: COLLECTOR_SENTINEL, EMAIL_FROM: CALC_V3_EMAIL_FROM,
    NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL: "",
  };
  const portalSecret = async (name: "portalUrl" | "portalToken"): Promise<string> => {
    const parsed: unknown = JSON.parse(await readFile(pointer, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Private calc-v3 offer pointer unavailable.");
    const value = parsed as Record<string, unknown>;
    if (typeof value.portalUrl !== "string" || typeof value.portalToken !== "string") throw new Error("Private calc-v3 offer pointer shape invalid.");
    const url = new URL(value.portalUrl);
    if (url.origin !== appOrigin.origin || url.username || url.password || url.search || url.hash) throw new Error("Private calc-v3 offer pointer origin invalid.");
    if (url.pathname.startsWith("/portal/")) {
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.portalToken) || url.pathname !== `/portal/${value.portalToken}`) {
        throw new Error("Private calc-v3 offer pointer token does not match its collected portal URL.");
      }
    } else if (value.portalToken !== "ARMY-unused-capability-placeholder") {
      throw new Error("Historical dashboard CTA requires the exact unused-capability placeholder.");
    }
    const secret = name === "portalUrl" ? value.portalUrl : value.portalToken;
    if ([...secret].length < 6) throw new Error("Collected calc-v3 offer secret unavailable.");
    return secret;
  };
  secrets = { portalUrl: () => portalSecret("portalUrl"), portalToken: () => portalSecret("portalToken") };
} else {
  output = ownedDirectory("E2E_CALC_V3_OUTPUT", ".e2e/army/calc-v3/runs");
  const networkLog = ownedDirectory("E2E_COVERAGE_NETWORK_LOG", ".e2e/army/coverage");
  if (["RESEND_API_KEY", "RESEND_BASE_URL", "EMAIL_FROM"].some((name) => process.env[name])) {
    throw new Error("calc-v3 production phases never configure an email transport.");
  }
  appEnvironment = {
    // Same server guard as the critical local business campaign (e2e.config.ts).
    NODE_OPTIONS: `--import=${pathToFileURL(path.resolve("scripts/tester-army/coverage-network-guard.mjs")).href}`,
    E2E_COVERAGE_BACKEND_ORIGIN: backend.origin, E2E_COVERAGE_NETWORK_LOG: networkLog, E2E_ARMY_BLOCK_WORKERS: "1",
  };
}

const relativeOutput = path.relative(process.cwd(), output).replaceAll("\\", "/");

export default {
  projectId: `miaouffrage-calc-v3-${phase}`,
  tests: [...definition.tests],
  targets: [{
    name: "chromium-desktop",
    engine: web({ browser: "chromium", viewport: { width: 1280, height: 800 } }),
    app: {
      url: appOrigin.origin,
      readyUrl: `${appOrigin.origin}/login`,
      environment: "test",
      command: {
        executable: process.execPath,
        args: [path.resolve("node_modules/next/dist/bin/next"), ...(serverMode === "production" ? ["start"] : ["dev", "--webpack"]),
          "--hostname", "localhost", "--port", appOrigin.port],
        cwd: process.cwd(),
        // Only the per-run owned backend values reach the app; no login secret.
        inheritEnv: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
        env: {
          E2E_ARMY: "1", E2E_ARMY_SUITE: "calc-v3", E2E_CALC_V3_PHASE: phase, NEXT_TELEMETRY_DISABLED: "1",
          TAKEOFF_MODULE_ENABLED_BY_DEFAULT: "1", E2E_ARMY_BASE_URL: appOrigin.origin,
          GEMINI_API_KEY: "", GOOGLE_GENERATIVE_AI_API_KEY: "",
          ...appEnvironment,
        },
        startupTimeout: 180_000,
        shutdownTimeout: 15_000,
        log: `${relativeOutput}/logs/app.log`,
        reuseExisting: false,
      },
    },
  }],
  workers: 1,
  retries: 0,
  maxDuration: definition.maxDuration,
  timeout: 90_000,
  actionTimeout: 30_000,
  assertionTimeout: emission ? 20_000 : 15_000,
  cleanupTimeout: 30_000,
  output: relativeOutput,
  // Generated Supabase tokens are not SDK secrets: authenticated traces stay off
  // and the campaign scrubs report.json and text evidence before archiving.
  trace: "off",
  video: "off",
  cache: "off",
  credentials: {
    army: {
      username: process.env.E2E_LOGIN_EMAIL ?? "unconfigured@example.invalid",
      password: () => {
        const password = process.env.E2E_LOGIN_PASSWORD;
        if (!password) throw new Error("E2E_LOGIN_PASSWORD is required for calc-v3 journeys.");
        return password;
      },
    },
  },
  ...(secrets ? { secrets } : {}),
} satisfies E2EConfig;
