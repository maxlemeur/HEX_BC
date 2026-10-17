import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  apiRequest, armyTest, createLineViaApi, ownEstimate, readEstimate, recordEvidence,
  type ArmyItem, type ArmyState, type OwnedEstimate,
} from "../critical/fixtures";
import {
  DEFAULT_LABOR_ROLE_NAMES, createRoleLessOwnerProject, holdSharedCalculationGate,
  laborRolesOf, ownedEstimateContext, versionCountOf,
} from "./calculation-gate-support";

// Observable failures, defined before the fix (16/10/2026 campaign, workers=3):
// 1. POST /api/estimates answers 400 BAD_REQUEST (details.code 40001) while a
//    line creation, batch or settings save holds the tenant calculation gate,
//    because creation rewrites the existing default labor roles and their
//    BEFORE trigger try-locks that gate exclusively.
// 2. Conversely, that exclusive try-lock makes a concurrent line creation or
//    settings save of a colleague fail with 409 for no business reason.
// 3. A genuine residual conflict (default roles really missing) is reported as
//    a non-retryable 400 instead of a retryable 409, or leaves partial rows.
// 4. Removing the rewrite must still create missing default roles exactly once.
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string; details?: unknown } };
type Created = { project: { id: string }; version: { id: string } };
type Response = { status: number; body: Envelope<Created> };
const options = { session: "army", tags: ["critical", "local", "calculation-gate"], timeout: 240_000 } as const;
const versionPayload = (title: string) => ({
  title, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, tax_rate_bp: 2000,
  rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1, currency: "EUR",
});
const summary = (response: { status: number; body: Envelope<unknown> }) =>
  ({ status: response.status, ok: response.body.ok, code: response.body.error?.code ?? null, details: response.body.error?.details ?? null });

function assertLocalBackend() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) {
    throw new Error("Calculation gate fixtures require the explicitly allowlisted owned local Supabase.");
  }
}

async function createEstimate(browser: Browser, army: ArmyState, title: string, projectId?: string) {
  const response: Response = await apiRequest(browser, "POST", "/api/estimates", projectId
    ? { project_id: projectId, version: versionPayload(title) }
    : { project: { name: army.projectName }, version: versionPayload(title) });
  if (response.status === 201 && response.body.ok) {
    ownEstimate(army, { projectId: response.body.data.project.id, versionId: response.body.data.version.id });
  }
  return response;
}

async function createOwnedEstimate(browser: Browser, army: ArmyState, title: string): Promise<OwnedEstimate> {
  const response = await createEstimate(browser, army, title);
  expect([response.status, response.body.ok]).toEqual([201, true]);
  return { projectId: response.body.data.project.id, versionId: response.body.data.version.id };
}

async function saveValidity(browser: Browser, versionId: string, days: number) {
  const before = await readEstimate(browser, versionId);
  return apiRequest<Envelope<unknown>>(browser, "PATCH", `/api/estimates/${versionId}`, {
    validite_jours: days, expected_content_revision: before.version.content_revision,
  }, { "If-Match": before.version.updated_at });
}

async function addLine(browser: Browser, versionId: string, parentId: string | null, title: string) {
  return apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${versionId}/items`, {
    item_type: "line", parent_id: parentId, title, line_nature: "supply_only",
    quantity: 1, unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1,
  });
}

async function prepareWriters(browser: Browser, army: ArmyState, label: string) {
  // The uncontended creations compile the route and guarantee the owner's roles.
  const lineTarget = await createOwnedEstimate(browser, army, `${army.runPrefix} ${label} line target`);
  const settingsTarget = await createOwnedEstimate(browser, army, `${army.runPrefix} ${label} settings target`);
  const seed = await createLineViaApi(browser, lineTarget.versionId, `${army.runPrefix} ${label} seed line`);
  const lock = await apiRequest(browser, "POST", `/api/estimates/${settingsTarget.versionId}/lock`);
  expect(lock.status).toBe(201);
  const owner = await ownedEstimateContext(lineTarget.projectId);
  expect(owner.role).toBe("admin");
  return { lineTarget, settingsTarget, sectionId: seed.parent_id, owner };
}

armyTest("GATE01 an estimate is created while a line and a settings save hold the tenant calculation gate", options, async ({ app, browser, army }) => {
  assertLocalBackend();
  await app.open("/dashboard/affaires");
  const { lineTarget, settingsTarget, sectionId, owner } = await prepareWriters(browser, army, "gate01");
  const rolesBefore = await laborRolesOf(owner.tenantId, owner.userId);
  expect(rolesBefore.map(role => role.name).sort()).toEqual([...DEFAULT_LABOR_ROLE_NAMES].sort());

  const gate = await holdSharedCalculationGate(owner.tenantId, "gate01");
  let outcome: { created: Response; line: { status: number; body: Envelope<{ item: ArmyItem }> }; settings: { status: number; body: Envelope<unknown> }; holdersAfter: number };
  try {
    const [created, line, settings] = await Promise.all([
      createEstimate(browser, army, `${army.runPrefix} gate01 created under the gate`),
      addLine(browser, lineTarget.versionId, sectionId, `${army.runPrefix} gate01 concurrent line`),
      saveValidity(browser, settingsTarget.versionId, 45),
    ]);
    outcome = { created, line, settings, holdersAfter: await gate.holders() };
  } finally {
    await gate.release();
  }
  await recordEvidence(army, "calculation-gate-01", {
    tenantId: owner.tenantId, gate: gate.tag, gateHeldDuringRequests: outcome.holdersAfter,
    creation: summary(outcome.created), line: summary(outcome.line), settings: summary(outcome.settings),
    expected: { creation: 201, line: 201, settings: 200, gateHeldDuringRequests: 1 },
  });
  // The three requests completed while the shared gate was still granted.
  expect(outcome.holdersAfter).toBe(1);
  expect(summary(outcome.line)).toMatchObject({ status: 201, ok: true });
  expect(summary(outcome.settings)).toMatchObject({ status: 200, ok: true });
  expect(summary(outcome.created)).toMatchObject({ status: 201, ok: true });

  const created = await readEstimate(browser, outcome.created.body.data.version.id);
  expect(created.version.title).toBe(`${army.runPrefix} gate01 created under the gate`);
  expect((await readEstimate(browser, settingsTarget.versionId)).version.validite_jours).toBe(45);
  expect((await readEstimate(browser, lineTarget.versionId)).items.filter(item => item.item_type === "line")).toHaveLength(2);
  // Existing defaults are neither rewritten nor duplicated.
  expect(await laborRolesOf(owner.tenantId, owner.userId)).toEqual(rolesBefore);
});

armyTest("GATE02 concurrent line saves, settings saves and estimate creations in one tenant all succeed", options, async ({ app, browser, army }) => {
  assertLocalBackend();
  await app.open("/dashboard/affaires");
  const { lineTarget, settingsTarget, sectionId, owner } = await prepareWriters(browser, army, "gate02");
  const rolesBefore = await laborRolesOf(owner.tenantId, owner.userId);
  const rounds = 8;
  const results: Array<{ kind: string; round: number; status: number; ok: boolean; code: string | null; ms: number }> = [];
  const timed = async <T extends { status: number; body: Envelope<unknown> }>(kind: string, round: number, request: () => Promise<T>) => {
    const started = Date.now();
    const response = await request();
    results.push({ kind, round, status: response.status, ok: response.body.ok, code: response.body.error?.code ?? null, ms: Date.now() - started });
    return response;
  };
  const created: string[] = [];
  await Promise.all([
    (async () => {
      for (let round = 1; round <= rounds; round += 1) {
        await timed("line", round, () => addLine(browser, lineTarget.versionId, sectionId, `${army.runPrefix} gate02 line ${round}`));
      }
    })(),
    (async () => {
      for (let round = 1; round <= rounds; round += 1) {
        await timed("settings", round, () => saveValidity(browser, settingsTarget.versionId, 30 + round));
      }
    })(),
    ...[0, 1].map(lane => (async () => {
      for (let round = 1; round <= rounds; round += 1) {
        const response = await timed(`creation-${lane}`, round, () => createEstimate(browser, army, `${army.runPrefix} gate02 creation ${lane}-${round}`));
        if (response.status === 201) created.push(response.body.data.version.id);
      }
    })()),
  ]);
  await recordEvidence(army, "calculation-gate-02", {
    tenantId: owner.tenantId, rounds, lanes: { line: 1, settings: 1, creation: 2 },
    failures: results.filter(result => !result.ok), results,
  });
  expect(results.filter(result => !result.ok)).toEqual([]);
  expect(results).toHaveLength(rounds * 4);
  expect(created).toHaveLength(rounds * 2);
  expect((await readEstimate(browser, settingsTarget.versionId)).version.validite_jours).toBe(30 + rounds);
  expect((await readEstimate(browser, lineTarget.versionId)).items.filter(item => item.item_type === "line")).toHaveLength(rounds + 1);
  expect(await laborRolesOf(owner.tenantId, owner.userId)).toEqual(rolesBefore);
});

armyTest("GATE03 missing default labor roles under a held gate return a retryable 409, then are created once", options, async ({ app, browser, army }) => {
  assertLocalBackend();
  await app.open("/dashboard/affaires");
  const seed = await createOwnedEstimate(browser, army, `${army.runPrefix} gate03 seed`);
  const owner = await ownedEstimateContext(seed.projectId);
  expect(owner.role).toBe("admin");
  const second = await createRoleLessOwnerProject(army, owner);
  await recordEvidence(army, "calculation-gate-03-fixture", { tenantId: owner.tenantId, actorUserId: owner.userId, secondOwner: second });
  expect(await laborRolesOf(owner.tenantId, second.userId)).toEqual([]);

  const gate = await holdSharedCalculationGate(owner.tenantId, "gate03");
  let blocked: { response: Response; holdersAfter: number; roles: unknown[]; versions: number };
  try {
    const response = await createEstimate(browser, army, `${army.runPrefix} gate03 blocked`, second.projectId);
    blocked = {
      response, holdersAfter: await gate.holders(),
      roles: await laborRolesOf(owner.tenantId, second.userId), versions: await versionCountOf(second.projectId),
    };
  } finally {
    await gate.release();
  }
  const first = await createEstimate(browser, army, `${army.runPrefix} gate03 after release`, second.projectId);
  const rolesAfterFirst = await laborRolesOf(owner.tenantId, second.userId);
  const again = await createEstimate(browser, army, `${army.runPrefix} gate03 roles present`, second.projectId);
  const rolesAfterAgain = await laborRolesOf(owner.tenantId, second.userId);
  await recordEvidence(army, "calculation-gate-03", {
    tenantId: owner.tenantId, secondOwner: second, gate: gate.tag,
    blocked: { ...summary(blocked.response), gateHeldDuringRequest: blocked.holdersAfter, rolesWritten: blocked.roles.length, versionsWritten: blocked.versions },
    afterRelease: summary(first), rolesAfterRelease: rolesAfterFirst, rolesPresent: summary(again), rolesAfterSecondCreation: rolesAfterAgain,
    versions: await versionCountOf(second.projectId),
    expected: { blocked: { status: 409, code: "CONTEXT_CHANGED" }, afterRelease: 201, rolesPresent: 201, roles: DEFAULT_LABOR_ROLE_NAMES.length, versions: 2 },
  });
  // A genuine conflict is retryable and leaves neither roles nor a version.
  expect(blocked.holdersAfter).toBe(1);
  expect(summary(blocked.response)).toMatchObject({ status: 409, ok: false, code: "CONTEXT_CHANGED" });
  expect([blocked.roles, blocked.versions]).toEqual([[], 0]);
  // The retry after release creates the version and each default role once.
  expect(summary(first)).toMatchObject({ status: 201, ok: true });
  expect(first.body.data.project.id).toBe(second.projectId);
  expect(rolesAfterFirst.map(role => role.name).sort()).toEqual([...DEFAULT_LABOR_ROLE_NAMES].sort());
  expect(summary(again)).toMatchObject({ status: 201, ok: true });
  expect(rolesAfterAgain).toEqual(rolesAfterFirst);
  expect(await versionCountOf(second.projectId)).toBe(2);
});
