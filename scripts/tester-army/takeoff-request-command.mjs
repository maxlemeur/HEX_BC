import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { createServerClient } from "@supabase/ssr";
import { register } from "tsx/cjs/api";

// Test-only entrypoint of the owned takeoff journeys (lot 3, one analysis per plan): a member's explicit command, as the
// server runs it from the affaire's options — `launch` a request of the plans it names (launchTakeoffRelaunch), or
// `stop` the rest of a running request (stopTakeoffLaunchRequest) — or from the table of items — `remeasure` a selection
// of items: its preview, then its confirmation (lot 4 PR 4b, previewItemRemeasure and runItemRemeasure) —, signed in as
// that member, on this host (the application under test has no local ChatGPT runtime to pay with). What the command
// hands to after() is not run here: the journey's own worker serves the Mac's queue with a controlled provider.
const [verb, projectId, ...rest] = process.argv.slice(2);
assert(["launch", "stop", "remeasure", "measure-item"].includes(verb ?? ""));
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
const { previewItemRemeasure, runItemRemeasure } = runtime.require("../../src/lib/takeoff/item-review-commands-server.ts", import.meta.url);
const { readAffaireItemTable } = runtime.require("../../src/lib/takeoff/item-table-server.ts", import.meta.url);
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
  } else if (verb === "measure-item") {
    const [item, intentKey, planKey, contentSha256, originalPage] = rest;
    assert([item, intentKey, planKey].every((id) => uuid.test(id ?? "")));
    assert(/^[0-9a-f]{64}$/.test(contentSha256) && /^[1-9][0-9]*$/.test(originalPage));
    // Only the catalogue read is simulated. Every other request still goes through the owned-network guard.
    const guardedFetch = globalThis.fetch;
    globalThis.fetch = (url, options) => String(url) === "https://api.openai.com/v1/models"
      ? Promise.resolve(Response.json({ models: [{ slug: "army", display_name: "Army", visibility: "list" },
        { slug: "army-detail", display_name: "Army détail", visibility: "list", supported_reasoning_levels: ["high"] }] }))
      : guardedFetch(url, options);
    const scope = { kind: "plan", planKey };
    result = await run(async () => {
      const table = await readAffaireItemTable(projectId, { scope, filter: {}, offset: 0, limit: 100, focusItemId: item });
      const line = table.page.lines.find((entry) => entry.itemId === item);
      assert(line && table.list);
      const seen = { list_revision_id: table.list.revisionId, targets: [line.targets] };
      const detail = { fileId: planKey, generation: null, contentSha256, page: Number(originalPage) };
      const preview = await previewItemRemeasure(projectId, { scope, detail, itemIds: [item], seen });
      const command = { command_version: 1, intent_key: intentKey, scope, detail, host_proof: preview.detail?.hostProof, item_ids: [item], plan_keys: [planKey],
        setting: { model: "army-detail", reasoning_effort: "high" }, preview_digest: preview.previewDigest, seen };
      return runItemRemeasure(projectId, command);
    });
  } else if (verb === "remeasure") {
    // The items of the affaire's table selected, and the confirmation's key: the preview the dialog shows, then its
    // explicit confirmation with that preview's digest (the member's own subscription, the profile's setting). With the
    // plans and the digest of a confirmation sent before, the same body is sent again, as the dialog resends a lost answer.
    // An effort after them (« - - » for a fresh preview) is the setting the confirmation names instead of the profile's.
    const [items, intentKey, sentPlanKeys, sentDigest, effort] = rest;
    const planKeys = sentPlanKeys === "-" ? undefined : sentPlanKeys;
    const digest = sentDigest === "-" ? undefined : sentDigest;
    const itemIds = (items ?? "").split(",");
    assert(itemIds.length > 0 && itemIds.every((id) => uuid.test(id)) && uuid.test(intentKey ?? ""));
    assert((planKeys === undefined) === (digest === undefined) && (digest === undefined || /^[0-9a-f]{64}$/.test(digest)));
    assert(effort === undefined || ["none", "low", "medium", "high", "xhigh", "max"].includes(effort));
    const setting = effort ? { reasoning_effort: effort } : null;
    const scope = { kind: "affaire" };
    result = await run(async () => {
      // What the table shows the member: the list revision and each selected line's readings (its target).
      const table = await readAffaireItemTable(projectId, { scope, filter: {}, offset: 0, limit: 100, focusItemId: null });
      const seen = { list_revision_id: table.list?.revisionId ?? null,
        targets: table.page.lines.filter((line) => itemIds.includes(line.itemId)).map((line) => line.targets) };
      if (planKeys !== undefined) {
        return runItemRemeasure(projectId, { command_version: 1, intent_key: intentKey, scope, item_ids: itemIds,
          plan_keys: planKeys.split(","), setting, preview_digest: digest, seen });
      }
      const preview = await previewItemRemeasure(projectId, { scope, itemIds, seen });
      const command = { command_version: 1, intent_key: intentKey, scope, item_ids: itemIds,
        plan_keys: preview.plans.map(({ key }) => key), setting, preview_digest: preview.previewDigest, seen };
      const admitted = await runItemRemeasure(projectId, command);
      return { ...admitted, sent: { planKeys: command.plan_keys, digest: command.preview_digest },
        preview: { plans: preview.plans, items: preview.items, reading: preview.reading, subscription: preview.subscription.state } };
    });
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
