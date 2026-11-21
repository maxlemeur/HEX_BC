import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { createServerClient } from "@supabase/ssr";
import { register } from "tsx/cjs/api";

const [projectId, planSetId, operationId, prefix, revisionArgument] = process.argv.slice(2);
assert([projectId, planSetId, operationId].every(value => /^[0-9a-f-]{36}$/.test(value ?? "")));
assert(/^ARMY-[A-Za-z0-9-]+$/.test(prefix ?? ""));
// The preparation revision confirmed for this launch (each launch of an affaire confirms its own); 1 by default.
const preparationRevision = Number(revisionArgument ?? "1");
assert(Number.isSafeInteger(preparationRevision) && preparationRevision >= 1);
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
  cookies: { ...cookieStore, setAll: (values) => values.forEach(value => cookies.set(value.name, value)) },
});
const auth = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL, password: process.env.E2E_LOGIN_PASSWORD });
assert.equal(auth.error, null);
const project = await client.from("estimate_projects").select("tenant_id,user_id,name").eq("id", projectId).single();
assert.equal(project.error, null);
assert(project.data.name.startsWith(prefix) && project.data.user_id === auth.data.user.id);

const require = createRequire(import.meta.url);
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external.js");
const { workUnitAsyncStorage } = require("next/dist/server/app-render/work-unit-async-storage.external.js");
const runtime = register({ namespace: "army-owned-takeoff-admission" });
const { saveChatGptStore } = runtime.require("../../src/lib/ai/chatgpt-local-store.ts", import.meta.url);
const { createAffaireTakeoffJob } = runtime.require("../../src/lib/takeoff/job-creation-server.ts", import.meta.url);
const owner = { tenantId: project.data.tenant_id, userId: project.data.user_id };
await saveChatGptStore(owner, { selectedId: "army", profiles: [{
  id: "army", clientId: "army", issuer: "army", subject: "army", email: process.env.E2E_LOGIN_EMAIL,
  model: "army", accessToken: "local-fixture-only", expiresAt: Date.now() + 3600_000, scopes: ["chatgpt.tokens.use.direct"],
}] });
const input = { projectId, planSetId, operationId, preparationRevision };
try {
  const receipt = await workAsyncStorage.run({ route: "/army-owned-admission" }, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies: cookieStore, headers: new Headers({ host: app.host }) },
      () => createAffaireTakeoffJob(input)));
  console.log("ARMY_ADMISSION " + JSON.stringify({ receipt }));
} catch (error) {
  console.log("ARMY_ADMISSION " + JSON.stringify({ rejected: String(error), status: error.status }));
}
