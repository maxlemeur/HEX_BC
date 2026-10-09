import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { BrowserContext, Request } from "@playwright/test";

export const POLISH_PHASE = process.env.POLISH_PHASE?.trim() || "after";
export const POLISH_ASSERT = process.env.POLISH_ASSERT === "1";
export const POLISH_OUTPUT_DIR = path.join(process.cwd(), ".e2e", "polish", POLISH_PHASE);
export const AUTH_STATE_FILE = path.join(process.cwd(), "e2e", ".auth", "playwright-user.json");

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type RecordedWrite = {
  method: string;
  url: string;
  verdict: "blocked" | "allowed";
  reason: string;
};

function readPublicEnv(name: string) {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  const dotEnvPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(dotEnvPath)) return null;
  const line = fs
    .readFileSync(dotEnvPath, "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim();
  return value ? value : null;
}

export function resolveSupabaseHost() {
  const raw = readPublicEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

/** Keeps the artifact repeatable without publishing the full project ref. */
export function maskHost(host: string | null) {
  if (!host) return null;
  const [ref, ...rest] = host.split(".");
  if (!ref || ref.length <= 6) return host;
  return [`${ref.slice(0, 3)}…${ref.slice(-3)}`, ...rest].join(".");
}

const READ_ONLY_MAPPING_ACTIONS = new Set([
  "preview",
  "structure-preview",
  "suggestions",
  "validate",
  "duplicates",
]);

function mappingAction(request: Request) {
  try {
    const body: unknown = JSON.parse(request.postData() ?? "null");
    return body && typeof body === "object" && "action" in body ? String(body.action) : "";
  } catch {
    return "";
  }
}

function classifyWrite(request: Request, appOrigin: string, supabaseHost: string | null) {
  const url = new URL(request.url());
  const isApp = url.origin === appOrigin;
  const isSupabase = supabaseHost !== null && url.hostname === supabaseHost;

  if (!isApp && !isSupabase) {
    return { verdict: "blocked" as const, reason: "external host" };
  }
  if (isSupabase && url.pathname.startsWith("/auth/v1/token")) {
    return { verdict: "allowed" as const, reason: "auth session refresh" };
  }
  if (isApp && url.pathname.startsWith("/__nextjs")) {
    return { verdict: "allowed" as const, reason: "next dev overlay" };
  }
  if (isApp && /web-vitals/i.test(url.pathname)) {
    return { verdict: "allowed" as const, reason: "web vitals beacon" };
  }
  if (isSupabase && url.pathname.startsWith("/rest/v1/rpc/")) {
    // Read RPCs are POSTs; recorded so the run shows which screens call them on load.
    return { verdict: "allowed" as const, reason: "supabase rpc (recorded)" };
  }
  if (isApp && request.headers()["next-action"]) {
    return { verdict: "allowed" as const, reason: "server action (recorded)" };
  }
  if (isApp && url.pathname === "/api/mappings" && READ_ONLY_MAPPING_ACTIONS.has(mappingAction(request))) {
    // The mapping screen computes suggestions and previews through POST; `create` and
    // `save-template` stay blocked.
    return { verdict: "allowed" as const, reason: "read-only mapping action (recorded)" };
  }
  return { verdict: "blocked" as const, reason: "mutation on shared data" };
}

/**
 * Aborts writes against the shared Supabase project and the app API while screens are
 * audited. Read RPCs and server actions are let through but recorded, so a screen that
 * writes on load shows up in the artifact instead of silently mutating shared data.
 */
export async function installWriteGuard(context: BrowserContext, appOrigin: string) {
  const supabaseHost = resolveSupabaseHost();
  const writes: RecordedWrite[] = [];

  await context.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (READ_METHODS.has(method)) {
      await route.continue();
      return;
    }
    const { verdict, reason } = classifyWrite(request, appOrigin, supabaseHost);
    const url = new URL(request.url());
    writes.push({ method, url: `${url.origin}${url.pathname}`, verdict, reason });
    if (verdict === "blocked") {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  return {
    drain() {
      return writes.splice(0, writes.length);
    },
  };
}

export function gitRevision() {
  try {
    const head = execSync("git -c safe.directory=* rev-parse HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git -c safe.directory=* status --porcelain", { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean).length;
    return { head, dirtyEntries: dirty };
  } catch {
    return { head: null, dirtyEntries: null };
  }
}

export function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
