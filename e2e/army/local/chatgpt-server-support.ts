import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

/** Each realm owns its account; parallel fixtures must never share its private profile. */
export async function createLocalChatGptOwner() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const database = new URL(process.env.E2E_ARMY_LOCAL_DB_URL!);
  if (!["localhost", "127.0.0.1"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
      !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Owned local ChatGPT backend required.");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const client = createClient(backend.origin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options);
  const email = `army-chatgpt-${randomUUID()}@example.test`;
  // Reuse the campaign password so the SDK's registered secret redactor covers it.
  const { data, error } = await client.auth.signUp({ email, password: process.env.E2E_LOGIN_PASSWORD! });
  if (error || !data.session || !data.user) throw new Error("Could not create the owned ChatGPT fixture account.");
  const member = await client.from("tenant_memberships").select("tenant_id,role").eq("user_id", data.user.id).single();
  if (member.error || !member.data || member.data.role !== "admin") throw new Error("The ChatGPT fixture must own exactly one tenant.");
  const service = createClient(backend.origin, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const tenant = await service.from("tenants").update({ name: `ARMY ChatGPT ${data.user.id}` })
    .eq("id", member.data.tenant_id).eq("created_by", data.user.id).select("id").single();
  if (tenant.error || !tenant.data) throw new Error("Could not name the owned ARMY ChatGPT tenant.");
  const policy = await service.rpc("set_tenant_calc_policy", {
    p_tenant_id: member.data.tenant_id, p_actor_user_id: data.user.id, p_new_estimate_calc_engine: 2,
    p_default_sale_coefficient_fo: null, p_default_sale_coefficient_mo: null, p_allowed_tax_rates_bp: null,
    p_change_reason: "Owned ChatGPT acceptance fixture",
  });
  if (policy.error) throw new Error("Could not prepare the ChatGPT fixture calculation policy.");
  return { client, email, userId: data.user.id };
}

/** Next development servers also need separate output and TypeScript files. */
export async function prepareChatGptServerWorkspace() {
  const id = `chatgpt-${randomUUID()}`;
  const distDir = path.resolve(`.build/tester-army/next-${id}`);
  const tsconfig = path.resolve(`.build/tester-army/tsconfig-${id}.json`);
  await mkdir(path.dirname(tsconfig), { recursive: true });
  await writeFile(tsconfig, JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { paths: { "@/*": ["../../src/*"] } },
    include: ["../../next-env.d.ts", "../../src/**/*.ts", "../../src/**/*.tsx", `next-${id}/types/**/*.ts`, `next-${id}/dev/types/**/*.ts`],
    exclude: ["../../node_modules", "../../src/**/*.test.ts", "../../src/**/*.test.tsx"] }), { flag: "wx" });
  return { id, environment: { E2E_ARMY: "1", E2E_ARMY_DEV_SERVER_ID: id }, assertReady: () => access(distDir), cleanup: async () => {
    // Preserve only numeric resource metadata, never traced URLs or OAuth parameters.
    const memory: Array<{ event: string; values: Record<string, string> }> = [];
    for (const file of [path.join(distDir, "dev/trace"), path.join(distDir, "trace")]) {
      const content = await readFile(file, "utf8").catch(() => "");
      for (const line of content.split("\n")) {
        let events;
        try { events = JSON.parse(line); } catch { continue; }
        if (!Array.isArray(events)) continue;
        for (const event of events) {
          if (!["start-dev-server", "server-restart-close-to-memory-threshold"].includes(event.name)) continue;
          const values = Object.fromEntries(Object.entries(event.tags ?? {}).filter(([key, value]) =>
            key.startsWith("memory.") && /^\d+$/.test(String(value))).map(([key, value]) => [key, String(value)]));
          memory.push({ event: event.name, values });
        }
      }
    }
    const artifacts = path.resolve(".e2e/army/critical/artifacts");
    await mkdir(artifacts, { recursive: true });
    await writeFile(path.join(artifacts, `${id}-resources.json`), JSON.stringify(memory));
    await rm(distDir, { recursive: true, force: true });
    await rm(tsconfig, { force: true });
  } };
}

/**
 * The compile waves of a ChatGPT development server. "profile" and "journeys" are the readiness of a server: the real
 * protected pages and the callback's missing-state rejection, before UI assertions. The two "takeoff" waves are every
 * other page and API route the tests of chatgpt-local-takeoff.e2e.ts use, so that no test waits for a compile.
 */
export type ChatGptCompileWave = "profile" | "journeys" | (typeof TAKEOFF_JOURNEY_WAVES)[number];

/**
 * In the order Next compiles them when they are asked together (run 43073132489): the pages with the estimate
 * routes, then the job routes. One wave a hook: see compileChatGptRoutes.
 */
export const TAKEOFF_JOURNEY_WAVES = ["takeoff-editor", "takeoff-jobs"] as const;

type CompileRequest = { path: string; method?: "OPTIONS"; anonymous?: boolean; expected: number[] };

function compileRequests(wave: ChatGptCompileWave): CompileRequest[] {
  const absent = "00000000-0000-4000-8000-000000000001";
  // GETs refuse through absent IDs and missing OAuth state. Next may start streaming a page before its missing
  // project, version or job calls notFound(): 200 or 404.
  const page = (path: string): CompileRequest => ({ path, expected: [200, 404] });
  // Next answers OPTIONS from the compiled module's exports (204, Allow), without running a handler.
  const route = (path: string): CompileRequest => ({ path, method: "OPTIONS", expected: [204] });
  const callback: CompileRequest = { path: "/auth/chatgpt/callback", expected: [302, 303, 307] };
  if (wave === "profile") {
    return [{ path: "/dashboard", expected: [200] }, { path: "/dashboard/profile", expected: [200] }, callback];
  }
  if (wave === "journeys") {
    return [
      ...["/dashboard", "/dashboard/profile", "/dashboard/estimates/new", `/dashboard/estimates/${absent}/edit`]
        .map(path => ({ path, expected: [200] })),
      { path: `/api/estimates/${absent}`, expected: [404] },
      { path: `/api/estimates/${absent}/suggestion-learning`, expected: [200, 404] },
      page(`/dashboard/affaires/${absent}/plans`), page(`/dashboard/affaires/${absent}/takeoff`), callback,
      ...[`/api/takeoff/plan-sets/${absent}/files`, `/api/takeoff/plan-sets/${absent}/files/reconcile`]
        .map(path => ({ path, expected: [400, 403, 404, 405] })),
    ];
  }
  // The entries the tests of chatgpt-local-takeoff.e2e.ts compiled in their own bodies (the compile-path spans of
  // this server's Next trace, the same 23 in two runs). There, a first use waited for its compile, and for any
  // compile already running, inside one 30 s action: in CI, V3C08's first item write took 17 to 22 s in green runs
  // and timed out at 30 s.
  if (wave === "takeoff-editor") {
    return [
      // A session would be redirected to the dashboard before the login page compiles.
      { path: "/login", anonymous: true, expected: [200] },
      ...[`/dashboard/affaires/${absent}`, `/dashboard/estimates/${absent}/takeoff/new`,
        `/dashboard/estimates/${absent}/takeoff/${absent}`].map(page),
      ...["/api/feature-flags", "/api/estimates", "/api/estimates/templates",
        ...["draft-versions", "outliers", "gating", "lock", "items", "batch"].map(name => `/api/estimates/${absent}/${name}`),
      ].map(route),
    ];
  }
  return [`/api/affaires/${absent}/dpgf-source`, "/api/takeoff/plan-sets", "/api/takeoff/activity-center",
    "/api/takeoff/jobs", `/api/takeoff/jobs/${absent}`,
    ...["retry", "resubmit", "reconcile"].map(command => `/api/takeoff/jobs/${absent}/${command}`),
    "/api/internal/takeoff/process-job", "/api/google-drive/connection"].map(route);
}

/**
 * Compiles one wave of a ChatGPT development server and fails on any unexpected answer.
 *
 * Call each wave from a hook of its own. The runner gives every beforeAll the default test limit (90 s, e2e.config.ts)
 * and has no limit per hook: on a CI shard running its two workers, the "journeys" wave alone takes 50 to 60 s, and
 * the server start, that wave and the takeoff waves in one hook passed 90 s before any test ran (run 43075417216).
 */
export async function compileChatGptRoutes(origin: string, email: string, wave: ChatGptCompileWave) {
  const app = new URL(origin);
  if (app.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(app.hostname)) throw new Error("Local ChatGPT server required.");
  const cookies = new Map<string, string>();
  const started = Date.now();
  const requests: Array<{ method: string; path: string; status: number | null; elapsedMs: number }> = [];
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: values => { for (const { name, value } of values) cookies.set(name, value); } },
  });
  try {
    const login = await client.auth.signInWithPassword({ email, password: process.env.E2E_LOGIN_PASSWORD! });
    if (login.error) throw new Error("ChatGPT readiness login failed.");
    // Under the 90 s of the hook, so that a slow compile fails here, by name and with its timings kept.
    const boundMs = 80_000;
    const signal = AbortSignal.timeout(boundMs);
    const compile = async (request: CompileRequest) => {
      const requestStarted = Date.now();
      const method = request.method ?? "GET";
      let status: number | null = null;
      try {
        const response = await fetch(new URL(request.path, origin), { method, redirect: "manual", signal,
          headers: request.anonymous ? {} : { cookie: [...cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ") } });
        status = response.status;
        if (!request.expected.includes(response.status)) {
          throw new Error(`ChatGPT readiness failed for ${method} ${request.path}: ${response.status}.`);
        }
        if (request.path.endsWith("/suggestion-learning") && response.status === 200) {
          // Disabled learning returns its empty state before checking the version.
          const body = await response.json();
          if (body?.ok !== true || body.data?.config?.enabled !== false ||
              !Array.isArray(body.data?.proposals) || body.data.proposals.length !== 0) {
            throw new Error("ChatGPT readiness expected disabled suggestion learning.");
          }
        } else {
          await response.text();
        }
      } catch (error) {
        // The bound rejects with a bare "The operation was aborted due to timeout": name the wave and the entry.
        if (signal.aborted && error === signal.reason) {
          throw new Error(`ChatGPT readiness wave ${wave} had no ${status === null ? "answer" : "complete answer"} for ${method} ${
            request.path} within ${boundMs / 1000} s.`, { cause: error });
        }
        throw error;
      } finally {
        requests.push({ method, path: request.path, status, elapsedMs: Date.now() - requestStarted });
      }
    };
    // Submit the wave's entries together: Next coalesces pending entries and serializes its Webpack compiler.
    // Barriers inside a wave create extra cold builds.
    for (const result of await Promise.allSettled(compileRequests(wave).map(compile))) {
      if (result.status === "rejected") throw result.reason;
    }
  } finally {
    try {
      const artifacts = path.resolve(".e2e/army/critical/artifacts");
      await mkdir(artifacts, { recursive: true });
      // Only constant refusal paths, response statuses and timings; no cookies or bodies.
      await writeFile(path.join(artifacts, `chatgpt-readiness-${app.port}-${wave}.json`),
        JSON.stringify({ wave, elapsedMs: Date.now() - started, requests }));
    } finally {
      await client.auth.signOut({ scope: "local" });
    }
  }
}
