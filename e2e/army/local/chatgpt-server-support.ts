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
  const distDir = path.resolve(`.e2e/army/next-${id}`);
  const tsconfig = path.resolve(`.e2e/army/tsconfig-${id}.json`);
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

/** Compile the real protected pages and the callback's missing-state rejection before UI assertions. */
export async function warmChatGptServer(origin: string, email: string) {
  const app = new URL(origin);
  if (app.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(app.hostname)) throw new Error("Local ChatGPT server required.");
  const cookies = new Map<string, string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: values => { for (const { name, value } of values) cookies.set(name, value); } },
  });
  try {
    const login = await client.auth.signInWithPassword({ email, password: process.env.E2E_LOGIN_PASSWORD! });
    if (login.error) throw new Error("ChatGPT readiness login failed.");
    const signal = AbortSignal.timeout(90_000);
    const absentPlanSet = "00000000-0000-4000-8000-000000000001";
    const paths = ["/dashboard", "/dashboard/profile", "/dashboard/estimates/new",
      `/dashboard/estimates/${absentPlanSet}/edit`, `/api/estimates/${absentPlanSet}`,
      `/api/estimates/${absentPlanSet}/suggestion-learning`, `/dashboard/affaires/${absentPlanSet}/plans`,
      `/dashboard/affaires/${absentPlanSet}/takeoff`,
      "/auth/chatgpt/callback", `/api/takeoff/plan-sets/${absentPlanSet}/files`,
      `/api/takeoff/plan-sets/${absentPlanSet}/files/reconcile`];
    // Cold editor/plan compilation must finish before the timed business journey.
    // Compile sequentially so parallel realms do not compile every entry at once.
    // GETs only: absent IDs and missing OAuth state preserve the real refusals.
    for (const pathname of paths) {
      const response = await fetch(new URL(pathname, origin), { redirect: "manual", signal,
        headers: { cookie: [...cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ") } });
      const learning = pathname === `/api/estimates/${absentPlanSet}/suggestion-learning`;
      const expected = learning ? [200, 404]
        : pathname.startsWith(`/api/estimates/${absentPlanSet}`) ? [404]
        : pathname.startsWith("/api/") ? [400, 403, 404, 405]
        : pathname === "/auth/chatgpt/callback" ? [302, 303, 307]
        // Next may start streaming before the missing project calls notFound().
        : ["plans", "takeoff"].some(page => pathname === `/dashboard/affaires/${absentPlanSet}/${page}`)
          ? [200, 404] : [200];
      if (!expected.includes(response.status)) throw new Error(`ChatGPT readiness failed for ${pathname}: ${response.status}.`);
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
    }
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}
