import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { createServerClient } from "@supabase/ssr";
import { register } from "tsx/cjs/api";

// Test-only entrypoint of the owned takeoff journeys (lot 3, one analysis per plan): a member's explicit command, as the
// server runs it from the affaire's options — `launch` a request of the plans it names (launchTakeoffRelaunch), or
// `stop` the rest of a running request (stopTakeoffLaunchRequest) —, signed in as that member, on this host. What the
// command hands to after() is not run here: the journey's own worker serves the Mac's queue with a controlled provider.
const [verb, projectId, ...rest] = process.argv.slice(2);
assert(["launch", "stop"].includes(verb ?? ""));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
assert(uuid.test(projectId ?? ""));
assert.equal(process.env.E2E_ARMY_TAKEOFF_WORKER, "1");
assert.equal(process.env.E2E_ARMY_BLOCK_WORKERS, "1");
const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const app = new URL(process.env.E2E_ARMY_BASE_URL ?? "");
assert(["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname));
assert.equal(backend.protocol, "http:");
assert.equal(backend.hostname, process.env.E2E_ALLOWED_SUPABASE_HOST);
assert(!["45585", "33485"].includes(backend.port));
await import("./coverage-network-guard.mjs");
process.env.PORT = app.port;

const cookies = new Map();
const cookieStore = { getAll: () => [...cookies.values()] };
const client = createServerClient(backend.origin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  cookies: { ...cookieStore, setAll: (values) => values.forEach((value) => cookies.set(value.name, value)) },
});
const auth = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL, password: process.env.E2E_LOGIN_PASSWORD });
assert.equal(auth.error, null);
const project = await client.from("estimate_projects").select("tenant_id,user_id,name").eq("id", projectId).single();
assert.equal(project.error, null);
assert(/^ARMY-/.test(project.data.name) && project.data.user_id === auth.data.user.id);

const require = createRequire(import.meta.url);
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external.js");
const { workUnitAsyncStorage } = require("next/dist/server/app-render/work-unit-async-storage.external.js");
const runtime = register({ namespace: "army-owned-takeoff-command" });
const { saveChatGptStore } = runtime.require("../../src/lib/ai/chatgpt-local-store.ts", import.meta.url);
const { getAuthenticatedContext } = runtime.require("../../src/lib/auth/tenant-context.ts", import.meta.url);
const { launchTakeoffRelaunch, stopTakeoffLaunchRequest } = runtime.require("../../src/lib/takeoff/launch-request-server.ts", import.meta.url);
const owner = { tenantId: project.data.tenant_id, userId: project.data.user_id };
await saveChatGptStore(owner, { selectedId: "army", profiles: [{
  id: "army", clientId: "army", issuer: "army", subject: "army", email: process.env.E2E_LOGIN_EMAIL,
  model: "army", accessToken: "local-fixture-only", expiresAt: Date.now() + 3600_000, scopes: ["chatgpt.tokens.use.direct"],
  // The connection the journeys' confirmations pin (OWNED_WORKER_AUTHORIZATION, e2e/army/takeoff/worker-support.ts).
  authorizationId: "army-connexion",
}] });

// The command's after() tasks: counted, never run here (a real request runs them once its response is sent).
let deferred = 0;
const afterContext = { after: () => { deferred += 1; } };
const run = (task) => workAsyncStorage.run({ route: "/army-owned-command", afterContext }, () =>
  workUnitAsyncStorage.run({ type: "request", phase: "render", cookies: cookieStore, headers: new Headers({ host: app.host }) }, task));
try {
  let result;
  if (verb === "launch") {
    const [planSetId, intentKey, revision, plans, predecessor] = rest;
    assert(uuid.test(planSetId ?? "") && uuid.test(intentKey ?? ""));
    const planFileIds = plans && plans !== "-" ? plans.split(",") : null;
    assert(!planFileIds || planFileIds.every((id) => uuid.test(id)));
    result = await run(async () => launchTakeoffRelaunch({ context: await getAuthenticatedContext(), projectId, planSetId, intentKey,
      preparationRevision: Number(revision ?? "1"), planFileIds, predecessorJobId: predecessor && predecessor !== "-" ? predecessor : null,
      host: app.host }));
  } else {
    const [requestId] = rest;
    assert(uuid.test(requestId ?? ""));
    result = await run(async () => stopTakeoffLaunchRequest({ context: await getAuthenticatedContext(), projectId, requestId }));
  }
  console.log("ARMY_COMMAND " + JSON.stringify({ result, deferred }));
} catch (error) {
  console.log("ARMY_COMMAND " + JSON.stringify({ rejected: String(error?.message ?? error), status: error?.status ?? null, deferred }));
} finally {
  runtime.unregister();
}
