import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

import { COLLECTOR_SENTINEL } from "../../../scripts/tester-army/offer-collector.mjs";
import { offerServerMode, validateOfferProductionBuild } from "../../../scripts/tester-army/run-offer-local.mjs";
import { assertInstalledDependencies } from "../../../scripts/tester-army/installed-dependencies.mjs";

assertInstalledDependencies();

function explicitOrigin(name: string, collector = false) {
  const value = process.env[name];
  const url = new URL(value ?? "");
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || url.origin !== value || url.username || url.password || url.pathname !== "/" || url.search || url.hash || (collector && url.hostname !== "127.0.0.1")) throw new Error(`Explicit local ${name} required.`);
  return url;
}
if (!["26"].includes(process.versions.node.split(".")[0])) throw new Error("Offer profile requires Node 26.");
const serverMode = offerServerMode();
await validateOfferProductionBuild();
const appOrigin = explicitOrigin("E2E_OFFER_APP_ORIGIN");
const backend = explicitOrigin("E2E_OFFER_BACKEND_ORIGIN");
const collector = explicitOrigin("E2E_OFFER_COLLECTOR_ORIGIN", true);
if (new Set([appOrigin.origin, backend.origin, collector.origin]).size !== 3 || process.env.E2E_ARMY_BASE_URL !== appOrigin.origin || process.env.NEXT_PUBLIC_SUPABASE_URL !== backend.origin || process.env.RESEND_BASE_URL !== collector.origin || process.env.RESEND_API_KEY !== COLLECTOR_SENTINEL || process.env.EMAIL_FROM !== "ARMY Local <offer@army.invalid>") throw new Error("Offer profile origins or sentinel environment mismatch.");
const sandboxTermsEnabled = process.env.E2E_OFFER_SANDBOX_TERMS === "1" &&
  serverMode === "production" && backend.origin === "http://127.0.0.1:45585" && Number(appOrigin.port) > 0 &&
  ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_TARGET_ENV"].every((name) => process.env[name] === undefined);
if (process.env.E2E_OFFER_SANDBOX_TERMS === "1" && !sandboxTermsEnabled) throw new Error("Sandbox draft terms require the explicit native production offer profile without hosting markers.");
const archiveRoot = path.resolve(".e2e/army/offer/runs");
const runDirectory = path.resolve(process.env.E2E_OFFER_RUN_DIRECTORY ?? "");
if (!runDirectory.startsWith(`${archiveRoot}${path.sep}`)) throw new Error("Explicit new offer campaign run directory required.");
const output = path.relative(process.cwd(), path.join(runDirectory, "sdk")).replaceAll("\\", "/");
const directory = path.resolve(process.env.E2E_OFFER_COLLECTOR_DIRECTORY ?? "");
const pointer = path.resolve(process.env.E2E_OFFER_SECRET_POINTER ?? "");
if (directory !== path.join(runDirectory, "collector") || pointer !== path.join(runDirectory, "private", "portal-pointer.json")) throw new Error("Offer collector and private pointer must stay inside the owned campaign run.");
if (["E2E_SECRET_PORTALURL", "E2E_SECRET_PORTALTOKEN"].some((name) => process.env[name] !== undefined)) throw new Error("Offer secret providers cannot be overridden outside the private pointer.");
async function portalSecret(name: "portalUrl" | "portalToken"): Promise<string> {
  const parsed: unknown = JSON.parse(await readFile(pointer, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Private offer pointer unavailable.");
  const value = parsed as Record<string, unknown>;
  if (typeof value.portalUrl !== "string" || typeof value.portalToken !== "string") throw new Error("Private offer pointer shape invalid.");
  const url = new URL(value.portalUrl);
  if (url.origin !== appOrigin.origin || url.username || url.password || url.search || url.hash) throw new Error("Private offer pointer origin invalid.");
  if (url.pathname.startsWith("/portal/")) {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.portalToken) || url.pathname !== `/portal/${value.portalToken}`) throw new Error("Private offer pointer token does not match collected portal URL.");
  } else if (value.portalToken !== "ARMY-unused-capability-placeholder") {
    throw new Error("Historical dashboard CTA requires the exact unused-capability placeholder.");
  }
  const secret = name === "portalUrl" ? value.portalUrl : value.portalToken;
  if ([...secret].length < 6) throw new Error("Collected offer secret unavailable.");
  return secret;
}

export default {
  projectId: "miaouffrage-local-offer-emission",
  tests: ["e2e/army/local/offer-emission-auth.setup.e2e.ts", "e2e/army/local/offer-emission.e2e.ts"],
  targets: [{ name: "chromium-desktop", engine: web({ browser: "chromium", viewport: { width: 1280, height: 800 } }), app: {
    url: appOrigin.origin, readyUrl: `${appOrigin.origin}/login`, environment: "test",
    command: { executable: process.execPath, args: [path.resolve("node_modules/next/dist/bin/next"),
      ...(serverMode === "production" ? ["start"] : ["dev", "--webpack"]),
      "--experimental-next-config-strip-types", "--hostname", appOrigin.hostname.replace(/^\[|\]$/g, ""), "--port", appOrigin.port], cwd: process.cwd(), env: {
      E2E_ARMY: "1", E2E_ARMY_SUITE: "offer", NEXT_TELEMETRY_DISABLED: "1",
      E2E_OFFER_SERVER_MODE: serverMode, E2E_OFFER_SANDBOX_TERMS: sandboxTermsEnabled ? "1" : "",
      E2E_OFFER_APP_ORIGIN: appOrigin.origin, E2E_ARMY_BASE_URL: appOrigin.origin, E2E_OFFER_BACKEND_ORIGIN: backend.origin, E2E_OFFER_COLLECTOR_ORIGIN: collector.origin,
      E2E_OFFER_RUN_DIRECTORY: runDirectory, E2E_OFFER_COLLECTOR_DIRECTORY: directory, E2E_OFFER_SECRET_POINTER: pointer, E2E_OFFER_SERVER_GUARD: "1", E2E_OFFER_NETWORK_LOG: path.join(runDirectory, "public", "server-network.jsonl"),
      NODE_OPTIONS: `--import=${pathToFileURL(path.resolve("scripts/tester-army/offer-network-guard.mjs")).href}`,
      NEXT_PUBLIC_SUPABASE_URL: backend.origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      RESEND_BASE_URL: collector.origin, RESEND_API_KEY: COLLECTOR_SENTINEL, EMAIL_FROM: "ARMY Local <offer@army.invalid>",
      NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL: process.env.NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL ?? "",
      GEMINI_API_KEY: "", GOOGLE_GENERATIVE_AI_API_KEY: "",
    }, startupTimeout: 180_000, shutdownTimeout: 15_000, log: path.relative(process.cwd(), path.join(runDirectory, "public", "app.log")).replaceAll("\\", "/"), reuseExisting: false },
  } }],
  workers: 1, retries: 0, timeout: 180_000, actionTimeout: 30_000, assertionTimeout: 20_000, cleanupTimeout: 30_000,
  output, trace: "off", video: "off", cache: "off",
  credentials: { army: { username: process.env.E2E_LOGIN_EMAIL ?? "unconfigured@army.invalid", password: () => { const password = process.env.E2E_LOGIN_PASSWORD; if (!password) throw new Error("Offer dedicated native account password unavailable."); return password; } } },
  secrets: { portalUrl: () => portalSecret("portalUrl"), portalToken: () => portalSecret("portalToken") },
} satisfies E2EConfig;
