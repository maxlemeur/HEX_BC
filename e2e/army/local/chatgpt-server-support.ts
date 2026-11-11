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
 * Compile the real protected pages and the callback's missing-state rejection before UI assertions; for the takeoff
 * journey file, also every page and API route its tests use, so no test waits for a compile.
 */
export async function warmChatGptServer(origin: string, email: string, workflow: "profile" | "decisions" | "takeoff") {
  const app = new URL(origin);
  if (app.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(app.hostname)) throw new Error("Local ChatGPT server required.");
  const cookies = new Map<string, string>();
  const started = Date.now();
  const requests: Array<{ wave: number; method: string; path: string; status: number | null; elapsedMs: number }> = [];
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: values => { for (const { name, value } of values) cookies.set(name, value); } },
  });
  try {
    const login = await client.auth.signInWithPassword({ email, password: process.env.E2E_LOGIN_PASSWORD! });
    if (login.error) throw new Error("ChatGPT readiness login failed.");
    const absentPlanSet = "00000000-0000-4000-8000-000000000001";
    const paths = workflow === "profile" ? ["/dashboard", "/dashboard/profile", "/auth/chatgpt/callback"] : [
      "/dashboard", "/dashboard/profile", "/dashboard/estimates/new",
      `/dashboard/estimates/${absentPlanSet}/edit`, `/api/estimates/${absentPlanSet}`,
      `/api/estimates/${absentPlanSet}/suggestion-learning`, `/dashboard/affaires/${absentPlanSet}/plans`,
      `/dashboard/affaires/${absentPlanSet}/takeoff`,
      "/auth/chatgpt/callback", `/api/takeoff/plan-sets/${absentPlanSet}/files`,
      `/api/takeoff/plan-sets/${absentPlanSet}/files/reconcile`];
    // Submit each wave's entries together: Next coalesces pending entries
    // and serializes its Webpack compiler. Barriers create extra cold builds.
    // GETs refuse through absent IDs and missing OAuth state; OPTIONS (below) runs no handler.
    const warm = async (pathname: string, wave: number, signal: AbortSignal,
      request: { method?: "GET" | "OPTIONS"; anonymous?: boolean; expected?: number[] } = {}) => {
      const routeStarted = Date.now();
      const method = request.method ?? "GET";
      let status: number | null = null;
      try {
        const response = await fetch(new URL(pathname, origin), { method, redirect: "manual", signal,
          headers: request.anonymous ? {} : { cookie: [...cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ") } });
        status = response.status;
        const learning = pathname === `/api/estimates/${absentPlanSet}/suggestion-learning`;
        const expected = request.expected ?? (learning ? [200, 404]
          : pathname.startsWith(`/api/estimates/${absentPlanSet}`) ? [404]
          : pathname.startsWith("/api/") ? [400, 403, 404, 405]
          : pathname === "/auth/chatgpt/callback" ? [302, 303, 307]
          // Next may start streaming before the missing project calls notFound().
          : ["plans", "takeoff"].some(page => pathname === `/dashboard/affaires/${absentPlanSet}/${page}`)
            ? [200, 404] : [200]);
        if (!expected.includes(response.status)) throw new Error(`ChatGPT readiness failed for ${method} ${pathname}: ${response.status}.`);
        if (learning && response.status === 200) {
          // Disabled learning returns its empty state before checking the version.
          const body = await response.json();
          if (body?.ok !== true || body.data?.config?.enabled !== false ||
              !Array.isArray(body.data?.proposals) || body.data.proposals.length !== 0) {
            throw new Error("ChatGPT readiness expected disabled suggestion learning.");
          }
        } else {
          await response.text();
        }
      } finally {
        requests.push({ wave, method, path: pathname, status, elapsedMs: Date.now() - routeStarted });
      }
    };
    const settle = async (wave: Array<Promise<void>>) => {
      for (const result of await Promise.allSettled(wave)) {
        if (result.status === "rejected") throw result.reason;
      }
    };
    const first = AbortSignal.timeout(90_000);
    await settle(paths.map(pathname => warm(pathname, 1, first)));
    if (workflow === "takeoff") {
      // Entries the tests of chatgpt-local-takeoff.e2e.ts compiled in their own bodies (the
      // compile-path spans of this server's Next trace, the same 23 in two runs). There, a first
      // use waited for its compile, and for any compile already running, inside one 30 s action:
      // in CI, V3C08's first item write took 17 to 22 s in green runs and timed out at 30 s.
      // A second wave with its own bound: the first one alone takes 38 to 55 s in CI.
      const second = AbortSignal.timeout(90_000);
      const pages = [`/dashboard/affaires/${absentPlanSet}`, `/dashboard/estimates/${absentPlanSet}/takeoff/new`,
        `/dashboard/estimates/${absentPlanSet}/takeoff/${absentPlanSet}`];
      const routes = ["/api/feature-flags", "/api/estimates", "/api/estimates/templates",
        ...["draft-versions", "outliers", "gating", "lock", "items", "batch"].map(route => `/api/estimates/${absentPlanSet}/${route}`),
        `/api/affaires/${absentPlanSet}/dpgf-source`, "/api/takeoff/plan-sets", "/api/takeoff/activity-center",
        "/api/takeoff/jobs", `/api/takeoff/jobs/${absentPlanSet}`,
        ...["retry", "resubmit", "reconcile"].map(command => `/api/takeoff/jobs/${absentPlanSet}/${command}`),
        // TI-682 lot D: the launch notice (« Vérifier et lancer ») and the review banner read the pages already in
        // the estimate. V3C08 opens the first just before its first item write: both compiles in one action timed out.
        "/api/takeoff/page-contributions", `/api/takeoff/jobs/${absentPlanSet}/page-contributions`,
        "/api/internal/takeoff/process-job", "/api/google-drive/connection"];
      await settle([
        // A session would be redirected to the dashboard before the login page compiles.
        warm("/login", 2, second, { anonymous: true, expected: [200] }),
        // Next may start streaming before the missing project, version or job calls notFound().
        ...pages.map(pathname => warm(pathname, 2, second, { expected: [200, 404] })),
        // Next answers OPTIONS from the compiled module's exports (204, Allow), without a handler.
        ...routes.map(pathname => warm(pathname, 2, second, { method: "OPTIONS", expected: [204] })),
      ]);
    }
  } finally {
    try {
      const artifacts = path.resolve(".e2e/army/critical/artifacts");
      await mkdir(artifacts, { recursive: true });
      // Only constant refusal paths, response statuses and timings; no cookies or bodies.
      await writeFile(path.join(artifacts, `chatgpt-readiness-${app.port}.json`),
        JSON.stringify({ workflow, elapsedMs: Date.now() - started, requests }));
    } finally {
      await client.auth.signOut({ scope: "local" });
    }
  }
}
