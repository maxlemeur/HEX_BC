import { randomUUID } from "node:crypto";
import type { Browser } from "@e2e-dev/web";
import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyItem } from "../critical/fixtures";

type SessionMode = "missing" | "different" | "current";
type Envelope<T> = { ok: boolean; data: T };

async function changeLease(browser: Browser, versionId: string, release = false) {
  return browser.evaluate(async (input) => {
    const scope = globalThis as typeof globalThis & { __miaouffrageEstimateDraftLockSessions?: Map<string, string> };
    const sessions = scope.__miaouffrageEstimateDraftLockSessions ??= new Map<string, string>();
    let session = sessions.get(input.versionId);
    if (!session && !input.release) {
      session = crypto.randomUUID(); sessions.set(input.versionId, session);
      sessionStorage.setItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`, session);
    }
    if (!session) throw new Error("The owned fixture lease identity is missing.");
    const response = await fetch(`/api/estimates/${input.versionId}/lock`, {
      method: input.release ? "DELETE" : "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": session }, body: "{}",
    });
    const payload = await response.json();
    return { status: response.status, ok: payload.ok === true,
      current: payload.data?.lock?.is_current_session === true,
      released: payload.data?.released === true };
  }, { versionId, release });
}

async function mutate(browser: Browser, input: {
  versionId: string; path: string; method: "POST" | "PATCH"; body: unknown; mode: SessionMode;
}) {
  return browser.evaluate(async (request) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const store = (globalThis as typeof globalThis & {
      __miaouffrageEstimateDraftLockSessions?: Map<string, string>;
    }).__miaouffrageEstimateDraftLockSessions;
    const current = store?.get(request.versionId);
    if (!current) throw new Error("The real page lock identity is missing.");
    if (request.mode !== "missing") {
      headers["x-estimate-draft-lock-session-id"] = request.mode === "current" ? current : crypto.randomUUID();
    }
    const response = await fetch(request.path, { method: request.method, credentials: "same-origin", headers, body: request.body });
    const payload = await response.json();
    // Lock error details contain session identities: never return or retain them.
    return { status: response.status, ok: payload.ok === true, code: payload.error?.code ?? null };
  }, { ...input, body: JSON.stringify(input.body) });
}

armyTest("LOCK01 secondary estimate writes require the owning page session", {
  session: "army", tags: ["critical", "local", "lock-boundaries"], timeout: 180_000,
}, async ({ app, browser, army }) => {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) ||
      backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) {
    throw new Error("Lock fixture preparation requires the explicitly allowlisted local Supabase.");
  }
  // Prepare this HTTP boundary fixture without mounting a competing editor heartbeat.
  await app.open("/dashboard/affaires");
  const created = await apiRequest<Envelope<{ project: { id: string }; version: { id: string } }>>(browser, "POST", "/api/estimates", {
    project: { name: army.projectName },
    version: { title: "ARMY page lock boundaries", margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0,
      tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1, currency: "EUR" },
  });
  expect([created.status, created.body.ok]).toEqual([201, true]);
  const ids = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
  ownEstimate(army, ids);
  const acquired = await changeLease(browser, ids.versionId);
  expect([acquired.status, acquired.ok, acquired.current]).toEqual([201, true, true]);
  const empty = await readEstimate(browser, ids.versionId);
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${ids.versionId}/items`, {
    item_type: "section", title: `${army.runPrefix} section`, position: 1,
  }, { "if-match": empty.version.updated_at });
  expect([section.status, section.body.ok]).toEqual([201, true]);
  const sectionState = await readEstimate(browser, ids.versionId);
  const createdLine = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${ids.versionId}/items`, {
    item_type: "line", parent_id: section.body.data.item.id, title: `${army.runPrefix} lock line`, position: 1,
    description: "u", line_nature: "supply_only", quantity: 1, unit_price_ht_cents: 1000, tax_rate_bp: 2000,
    k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1, labor_role_id: null,
  }, { "if-match": sectionState.version.updated_at });
  expect([createdLine.status, createdLine.body.ok]).toEqual([201, true]);
  const line = createdLine.body.data.item;
  const before = await readEstimate(browser, ids.versionId);
  const tenantId = String(before.version.tenant_id);
  const client = createClient(backend.href, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error || !login.data.user) throw new Error("Ordinary fixture login failed.");
  const owner = await client.from("estimate_projects").select("id, user_id, tenant_id, name").eq("id", ids.projectId).single();
  if (owner.error || owner.data?.user_id !== login.data.user.id || owner.data.tenant_id !== tenantId || owner.data.name !== army.projectName) {
    throw new Error("Fixture owner, tenant or ARMY identity is inconsistent.");
  }
  const tenant = await client.from("tenants").select("name").eq("id", tenantId).single();
  if (tenant.error || !/^ARMY\b/.test(tenant.data?.name ?? "")) throw new Error("Fixture settings require a dedicated local ARMY tenant.");
  const flag = await client.from("feature_flags").select("enabled").eq("tenant_id", tenantId).eq("flag_key", "EST_163_SUGGESTION_LEARNING").maybeSingle();
  if (flag.error) throw new Error("The local ARMY learning flag could not be read.");
  if (flag.data && flag.data.enabled !== true) throw new Error("An existing disabled learning flag is preserved; this environment is not ready.");
  let createdFlagId: string | null = null;
  try {
    if (!flag.data) {
      const flagId = randomUUID();
      const prepared = await client.from("feature_flags").insert({ id: flagId, tenant_id: tenantId, flag_key: "EST_163_SUGGESTION_LEARNING", enabled: true });
      if (prepared.error) throw new Error(`Temporary local learning flag failed: ${prepared.error.code}`);
      createdFlagId = flagId;
    }
    const structureId = randomUUID(), nodeId = randomUUID(), draftId = randomUUID(), lotId = randomUUID(), draftLineId = randomUUID(), ruleId = randomUUID();
    const common = { tenant_id: tenantId, project_id: ids.projectId, version_id: ids.versionId };
    const fixtures: Array<[string, Record<string, unknown>]> = [
      ["estimate_structure_drafts", { id: structureId, tenant_id: tenantId, project_id: ids.projectId, target_version_id: ids.versionId, created_by: login.data.user.id }],
      ["estimate_structure_draft_nodes", { id: nodeId, tenant_id: tenantId, draft_id: structureId, order_index: 0, hierarchy_level: 1, label: `${army.runPrefix} structure`, normalized_label: "army structure", confidence: 1, default_action: "create" }],
      ["estimate_version_zero_drafts", { ...common, id: draftId, created_by: login.data.user.id }],
      ["estimate_version_zero_lots", { ...common, id: lotId, draft_id: draftId, lot_key: "army-lock", lot_label: "ARMY lock", status: "generated" }],
      ["estimate_version_zero_lines", { ...common, id: draftLineId, draft_id: draftId, lot_id: lotId, proposed_title: `${army.runPrefix} V0`, proposed_quantity: 1, proposed_unit: "u" }],
      ["estimate_suggestion_rules", { id: ruleId, tenant_id: tenantId, user_id: login.data.user.id, name: `${army.runPrefix} lock rule`, match_value: army.runPrefix, match_type: "keyword", is_active: true }],
    ];
    for (const [table, row] of fixtures) {
      const result = await client.from(table).insert(row);
      if (result.error) throw new Error(`Local RLS fixture ${table} failed: ${result.error.code}`);
    }
    await recordEvidence(army, "lock-boundary-fixtures", { ...ids, itemId: line.id, structureId, nodeId, draftId, lotId, draftLineId, ruleId });

    async function readBusiness() {
      const snapshot = await readEstimate(browser, ids.versionId);
      const records: Record<string, unknown> = {};
      for (const [table, column, value] of [
        ["estimate_structure_drafts", "id", structureId],
        ["estimate_structure_draft_applications", "draft_id", structureId],
        ["estimate_version_zero_lines", "id", draftLineId],
        ["suggestion_corrections", "rule_id", ruleId],
        ["estimate_item_outlier_dismissals", "item_id", line.id],
      ]) {
        const result = await client.from(table).select("*").eq("tenant_id", tenantId).eq(column, value).order("id");
        if (result.error) throw new Error(`Ordinary ${table} observation failed: ${result.error.code}`);
        records[table] = result.data;
      }
      return { version: snapshot.version, items: snapshot.items, records };
    }

    const cases = [
      { name: "outlier", expectedStatus: 200, method: "POST" as const, path: `/api/estimates/${ids.versionId}/outliers`, body: { item_id: line.id, flag_key: "price_outlier", dismissed: true } },
      { name: "v0-review", expectedStatus: 200, method: "PATCH" as const, path: `/api/estimates/${ids.versionId}/version-zero-drafts/${draftId}/lines/${draftLineId}`, body: { review_status: "accepted" } },
      { name: "learning", expectedStatus: 200, method: "POST" as const, path: `/api/estimates/${ids.versionId}/suggestion-learning`, body: { corrections: [{ rule_id: ruleId, field_name: "description", original_value: "before", corrected_value: "after", item_title: army.runPrefix }] } },
      { name: "structure", expectedStatus: 201, method: "POST" as const, path: `/api/estimates/${ids.versionId}/structure-drafts/${structureId}/apply`, body: { mode: "merge_existing", selected_root_node_ids: [nodeId] } },
    ];
    const refusals: Array<{ caseName: string; mode: SessionMode; response: Awaited<ReturnType<typeof mutate>>; unchanged: boolean }> = [];
    for (const entry of cases) {
      const baseline = await readBusiness();
      for (const mode of ["missing", "different"] as const) {
        const renewed = await changeLease(browser, ids.versionId);
        expect([renewed.status, renewed.ok, renewed.current]).toEqual([201, true, true]);
        const response = await mutate(browser, { ...entry, versionId: ids.versionId, mode });
        const after = await readBusiness();
        await recordEvidence(army, `lock-${entry.name}-${mode}`, { response, expectedStatus: 409, unchanged: JSON.stringify(after) === JSON.stringify(baseline), before: baseline, after });
        refusals.push({ caseName: entry.name, mode, response, unchanged: JSON.stringify(after) === JSON.stringify(baseline) });
      }
    }
    await recordEvidence(army, "lock-boundary-refusals", refusals);
    for (const refusal of refusals) {
      expect(refusal.response.status, `${refusal.caseName}/${refusal.mode}`).toBe(409);
      expect(refusal.response.ok).toBe(false);
      expect(refusal.response.code).toBe("CONFLICT");
      expect(refusal.unchanged).toBe(true);
    }
    for (const entry of cases) {
      const renewed = await changeLease(browser, ids.versionId);
      expect([renewed.status, renewed.ok, renewed.current]).toEqual([201, true, true]);
      const response = await mutate(browser, { ...entry, versionId: ids.versionId, mode: "current" });
      const after = await readBusiness();
      await recordEvidence(army, `lock-${entry.name}-current`, { response, expectedStatus: entry.expectedStatus, after });
      expect(response.status).toBe(entry.expectedStatus);
      expect(response.ok).toBe(true);
      if (entry.name === "outlier") expect(after.records.estimate_item_outlier_dismissals).toMatchObject([{ item_id: line.id, flag_key: "price_outlier" }]);
      if (entry.name === "v0-review") expect(after.records.estimate_version_zero_lines).toMatchObject([{ id: draftLineId, review_status: "accepted" }]);
      if (entry.name === "learning") expect(after.records.suggestion_corrections).toMatchObject([{ rule_id: ruleId, original_value: "before", corrected_value: "after" }]);
      if (entry.name === "structure") {
        expect(after.records.estimate_structure_drafts).toMatchObject([{ id: structureId, status: "applied" }]);
        expect(after.items.filter((item) => item.title === `${army.runPrefix} structure`)).toHaveLength(1);
      }
      expect([after.version.total_ht_cents, after.version.total_tax_cents, after.version.total_ttc_cents])
        .toEqual([before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents]);
    }
    const released = await changeLease(browser, ids.versionId, true);
    expect([released.status, released.ok, released.released]).toEqual([200, true, true]);
    await app.open(`/dashboard/estimates/${ids.versionId}/edit`);
    await browser.reload();
    expect((await readEstimate(browser, ids.versionId)).items.filter((item) => item.title === `${army.runPrefix} structure`)).toHaveLength(1);
  } finally {
    if (createdFlagId) {
      const restored = await client.from("feature_flags").delete().eq("id", createdFlagId).eq("tenant_id", tenantId).eq("flag_key", "EST_163_SUGGESTION_LEARNING").select("id");
      await recordEvidence(army, "lock-boundary-flag-restored", { createdForRun: true, restored: !restored.error && restored.data?.length === 1 });
      if (restored.error || restored.data?.length !== 1) throw new Error("The temporary local learning flag could not be removed.");
    }
  }
});
