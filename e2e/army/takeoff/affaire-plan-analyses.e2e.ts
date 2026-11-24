import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot, type TakeoffPreparationSource } from "@/lib/takeoff/preparation";
import { buildPlanFileStoragePath, sanitizePlanPdfFilename } from "@/lib/takeoff/plan-file-display-name";
import { getPreparationPlanSourceVersion } from "@/lib/takeoff/preparation-sources";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";

import { armyTest, recordEvidence } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { querySql } from "../local/calculation-gate-support";
import { ownedWorkerHostId, ownedWorkerSelection, signUpWorkerOwner } from "./worker-support";

// Lot 3, « Centre d'activité et revue anticipée »: plan A is reviewed while plan B is read and plan C waits, without a
// manual reload, from one light read of the affaire's launch requests. The request and its analyses are written as the
// dispatcher of lot 3 writes them (manifest of format 2, one job per plan) and lot 2's grouped request as its admission
// writes it (format 1): fixtures on the owned stack, with the triggers off, since the dispatcher is not on main yet. What
// this proves is what a member sees and what the page reads. Fictional PDFs; no AI call, no e-mail, no worker.

const NAMES = { a: "P-201_RDC.pdf", b: "P-202_R+1.pdf", c: "P-203_R+2.pdf" } as const;
type Plan = keyof typeof NAMES;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function ownedLocalClient() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const workerKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname)
    || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST || !workerKey) {
    throw new Error("An owned local worker stack is required.");
  }
  return createClient(backend.origin, workerKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function buildPlanPdf(label: string, pages: number) {
  const doc = await PDFDocument.create();
  doc.setTitle("ARMY plan fictif");
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= pages; page += 1) {
    const sheet = doc.addPage([1190.55, 841.89]);
    sheet.drawLine({ start: { x: 200, y: 500 }, end: { x: 600, y: 500 }, thickness: 1 });
    sheet.drawText(`${label} · feuille ${page}`, { x: 980, y: 160, size: 9, font });
  }
  return doc.save({ useObjectStreams: false });
}

armyTest("TKPA01 plan A is reviewed while plan B is read and C waits, without a reload: one light poll, no read per plan, readers without actions", {
  session: "army", trace: "off", tags: ["critical", "takeoff-worker", "local"], timeout: 300_000,
}, async (ui) => {
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, "APA");
  const { tenantId, userId } = owner;
  const setup = ownedLocalClient();
  const projectId = randomUUID();
  const planSetId = randomUUID();
  const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID() } as Record<Plan, string>;
  const jobs = { a: randomUUID(), b: randomUUID(), c: randomUUID(), grouped: randomUUID(), olderA: randomUUID() };
  const requestId = randomUUID();
  const olderId = randomUUID();
  const earlierAttemptId = randomUUID();
  const host = await ownedWorkerHostId();

  expect((await setup.from("estimate_projects").insert({ id: projectId, tenant_id: tenantId, user_id: userId,
    name: `${ui.army.runPrefix} plans en lecture` })).error).toBeNull();
  expect((await setup.from("plan_sets").insert({ id: planSetId, tenant_id: tenantId, project_id: projectId, name: "Plans fictifs" })).error).toBeNull();
  (ui.army.ownedPlanSets ??= []).push({ projectId, planSetId, tenantId });
  (ui.army.ownedTakeoffAffaires ??= []).push(projectId);
  const pageCounts: Record<Plan, number> = { a: 7, b: 1, c: 1 };
  const sources: Record<Plan, TakeoffPreparationSource> = {} as Record<Plan, TakeoffPreparationSource>;
  for (const plan of ["a", "b", "c"] as const) {
    const bytes = await buildPlanPdf(NAMES[plan], pageCounts[plan]);
    // Stored as the application stores an upload: a sanitized name at the path its identity gives (the location reader
    // reads no other), the name the member gave in its metadata.
    const storedName = sanitizePlanPdfFilename(NAMES[plan]);
    const filePath = buildPlanFileStoragePath({ tenantId, setId: planSetId, fileId: ids[plan], fileName: storedName });
    expect((await setup.storage.from("plan-files").upload(filePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
    const row = await setup.from("plan_files").insert({ id: ids[plan], tenant_id: tenantId, plan_set_id: planSetId, file_name: storedName,
      file_path: filePath, file_type: "application/pdf", file_size_bytes: bytes.length, page_count: pageCounts[plan],
      metadata: { original_file_name: NAMES[plan] } })
      .select("id,plan_set_id,file_path,file_name,file_size_bytes,file_hash,page_count,updated_at").single();
    expect(row.error).toBeNull();
    sources[plan] = { document_id: ids[plan], document_name: NAMES[plan], kind: "plan", revision: "A",
      source_version: getPreparationPlanSourceVersion(row.data!), content_hash: sha256(bytes), pages: plan === "a" ? [2, 7] : [1],
      active: true, confirmed: true, plan_set_id: planSetId, file_path: filePath, page_count: pageCounts[plan], logical_document_id: null,
      source_updated_at: row.data!.updated_at, mime_type: "application/pdf", page_triage: null };
  }
  const confirmedAt = new Date().toISOString();
  const snapshotOf = (plans: Plan[]) => {
    const preparation = createEmptyTakeoffPreparation({ estimateVersionId: null });
    preparation.objective = "measure_length";
    preparation.objective_confirmed = true;
    preparation.scope = { ...preparation.scope, lots: ["Plomberie"], networks: ["EF"], confirmed: true };
    preparation.sources = plans.map((plan) => sources[plan]);
    preparation.conventions = { unit: "m", measurement_basis: "dimensioned", calibration: null, purchase: null, confirmed: true };
    preparation.destination = { kind: "analysis_only", estimate_version_id: null, reviewer: null, confirmed: true };
    preparation.processing = { level: "C", provider: "chatgpt" };
    return createTakeoffPreparationSnapshot({ preparation, revision: 1, confirmedAt, confirmedBy: userId });
  };
  const selection = await ownedWorkerSelection();
  const entry = (plan: Plan) => ({ entry_key: ids[plan], name: NAMES[plan], logical_id: ids[plan], intake_document_id: null,
    plan_file_id: ids[plan], generation: null, content_sha256: sources[plan].content_hash, pages: sources[plan].pages,
    page_count: pageCounts[plan] });
  const common = { intent: "initial", order: { kind: "free_extraction", version: 1, list: null }, references: [],
    preparation: { revision: 1, rule_version: 1 }, budget: { tokens: 400_000, cost_cents: 2_500 },
    coverage: { plans_retained: 3, plans_omitted: [], references_omitted: [] } };
  // Format 2, as buildTakeoffPlanLaunchManifest seals it: one unit per plan, in the order of their names.
  const perPlan = { ...common, format_version: 2, dispatch: { order: "display_name", version: 1 }, plans: (["a", "b", "c"] as const).map(entry),
    units: (["a", "b", "c"] as const).map((plan, index) => ({ key: `plan:${ids[plan]}`, ordinal: index + 1, plans: [ids[plan]],
      pages: sources[plan].pages, page_count: pageCounts[plan], budget: { tokens: 133_334, cost_cents: 834 } })) };
  const earlierAttempt = { ...perPlan, plans: [entry("a")], units: [perPlan.units[0]] };
  // Format 1, lot 2's admission: one grouped unit holding the three plans.
  const grouped = { ...common, format_version: 1, plans: (["a", "b", "c"] as const).map(entry),
    units: [{ key: "grouped", plans: (["a", "b", "c"] as const).map((plan) => ids[plan]) }] };

  const at = (minutesAgo: number) => `clock_timestamp() - interval '${minutesAgo} minutes'`;
  const job = (id: string, unitKey: string, request: string, plans: Plan[], state: "completed" | "processing" | "pending", started: number) => `
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, created_by, level, status, execution_provider, execution_host_id,
  processing_strategy, source_file_name, launch_request_id, launch_unit_key, preparation_snapshot, created_at, started_at, completed_at,
  analysis_outcome, analysis_finished_at, analysis_completion_event_id, updated_at)
values ('${id}', '${tenantId}', '${projectId}', '${planSetId}', '${userId}', 'C', '${state}', 'chatgpt_local', '${host}', 'sync',
  '${plans.length === 1 ? NAMES[plans[0]] : "Plans fictifs.pdf"}', '${request}', '${unitKey}', ${literal(snapshotOf(plans))}, ${at(started + 1)},
  ${state === "pending" ? "null" : at(started)}, ${state === "completed" ? at(started - 1) : "null"},
  ${state === "completed" ? "'success'" : "null"}, ${state === "completed" ? at(started - 1) : "null"},
  ${state === "completed" ? "gen_random_uuid()" : "null"}, ${state === "completed" ? at(started - 1) : at(started)});`;
  const items = (jobId: string, plan: Plan, pages: number[]) => {
    const resultId = randomUUID();
    return `
insert into public.takeoff_results (id, tenant_id, job_id, extracted_json, provider_meta, tables, warnings)
values ('${resultId}', '${tenantId}', '${jobId}', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb);
${pages.map((page, index) => `insert into public.takeoff_items (id, tenant_id, job_id, result_id, designation, quantity, unit, confidence,
  evidence, source_file_name, source_page, metadata)
values ('${randomUUID()}', '${tenantId}', '${jobId}', '${resultId}', 'ARMY vanne ${plan.toUpperCase()}${index + 1}', ${index + 2}, 'u', 0.93,
  'Vanne repérée page ${page}', '${NAMES[plan]}', ${page},
  jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', '${ids[plan]}')));`).join("\n")}`;
  };
  const request = (id: string, input: { origin: "automatic" | "manual"; manifest: unknown; plans: Plan[]; created: number; closed: boolean }) => `
insert into public.takeoff_launch_requests (id, tenant_id, project_id, origin, intent, intent_key, command_digest, state, confirmed_by, payer_id,
  mandate_kind, execution_host_id, mandate_selection, mandated_at, mandate_revision, manifest, manifest_digest, preparation_snapshot,
  units_expected, units_succeeded, token_budget, cost_budget_cents, outcome, completion_event_id, created_at, updated_at, evaluated_at,
  admitted_at, closed_at)
values ('${id}', '${tenantId}', '${projectId}', '${input.origin}', '${input.origin === "automatic" ? "initial" : "reread_plans"}',
  '${input.origin === "automatic" ? id : randomUUID()}', ${input.origin === "automatic" ? "null" : `'${"d".repeat(64)}'`},
  '${input.closed ? "closed" : "admitted"}', '${userId}', '${userId}', '${input.origin === "automatic" ? "confirmation" : "command"}', '${host}',
  ${literal(selection)}, ${at(input.created)}, 1, ${literal(input.manifest)}, '${sha256(Buffer.from(JSON.stringify(input.manifest)))}',
  ${literal(snapshotOf(input.plans))}, ${(input.manifest as { units: unknown[] }).units.length}, ${input.closed ? 1 : 0}, 400000, 2500,
  ${input.closed ? "'success'" : "null"}, ${input.closed ? "gen_random_uuid()" : "null"}, ${at(input.created)}, ${at(input.created)},
  ${at(input.created)}, ${at(input.created)}, ${input.closed ? at(input.created - 5) : "null"});`;
  await querySql(`begin;
set local session_replication_role = replica;
${request(olderId, { origin: "manual", manifest: grouped, plans: ["a", "b", "c"], created: 600, closed: true })}
${job(jobs.grouped, "grouped", olderId, ["a", "b", "c"], "completed", 599)}
${items(jobs.grouped, "a", [2])}
${request(earlierAttemptId, { origin: "manual", manifest: earlierAttempt, plans: ["a"], created: 500, closed: true })}
${job(jobs.olderA, `plan:${ids.a}`, earlierAttemptId, ["a"], "completed", 499)}
${request(requestId, { origin: "automatic", manifest: perPlan, plans: ["a", "b", "c"], created: 10, closed: false })}
${job(jobs.a, `plan:${ids.a}`, requestId, ["a"], "completed", 9)}
${items(jobs.a, "a", [2, 7])}
${job(jobs.b, `plan:${ids.b}`, requestId, ["b"], "processing", 1)}
${job(jobs.c, `plan:${ids.c}`, requestId, ["c"], "pending", 10)}
commit;`);
  const auditCount = async () => Number((await querySql(`select count(*) from public.audit_logs where tenant_id = '${tenantId}';`))[0]);
  const auditsBefore = await auditCount();

  // Every read of the page's own API, by kind: the light read, the list of analyses, and a job's detail (read per plan).
  const reads: Array<{ at: number; kind: "light" | "list" | "detail" | "other" }> = [];
  await ui.browser.route(/\/api\/takeoff\//, async (route) => {
    const url = new URL(route.request.url);
    if (route.request.method === "GET") {
      reads.push({ at: Date.now(), kind: url.pathname === "/api/takeoff/activity-center/requests" && url.searchParams.get("view") === "current"
        ? "light" : url.pathname === "/api/takeoff/activity-center" ? "list"
          : /^\/api\/takeoff\/jobs\/[0-9a-f-]{36}$/.test(url.pathname) ? "detail" : "other" });
    }
    return route.fallback();
  });
  const count = (kind: (typeof reads)[number]["kind"]) => reads.filter((read) => read.kind === kind).length;
  const coverage = ui.screen.getByTestId("takeoff-request-coverage");
  const unitOf = (plan: Plan) => ui.browser.locator("[data-testid='takeoff-request-current'] [data-testid='takeoff-request-unit']")
    .filter({ hasText: NAMES[plan] });

  // 1. A is ready while B is read and C waits: the step and the plan both open A's review, nothing else is offered.
  await ui.app.open(`/dashboard/affaires/${projectId}/takeoff`);
  await waitForHydration(ui.browser);
  await expect(coverage).toHaveText("1 plan lu sur 3 · 1 en lecture · 1 en attente");
  await expect(unitOf("a")).toContainText("Prêt à revoir");
  await expect(unitOf("a")).toContainText("pages 2, 7");
  await expect(unitOf("b")).toContainText("En lecture");
  await expect(unitOf("c")).toContainText("En attente");
  // The member who launched the analysis may stop a plan not read yet (the counterexample of the director's view, step 6).
  await expect(unitOf("b").getByRole("button", "Annuler", { exact: true })).toBeVisible();
  await expect(unitOf("c").getByRole("button", "Annuler", { exact: true })).toBeVisible();
  const tracking = ui.screen.getByRole("table", "Analyses de plans", { exact: true });
  const latestA = tracking.getByTestId(`takeoff-tracking-job-${jobs.a}`);
  await expect(latestA).toContainText(`${NAMES.a} · pages 2, 7`);
  await expect(latestA).toContainText("2 lignes de métré extraites");
  await expect(tracking.getByTestId(`takeoff-tracking-job-${jobs.b}`)).toContainText("En lecture");
  await expect(tracking.getByTestId(`takeoff-tracking-job-${jobs.c}`)).toContainText("En attente");
  await expect(tracking.getByTestId(`takeoff-tracking-job-${jobs.grouped}`)).toContainText(NAMES.b);
  await expect(tracking.getByTestId(`takeoff-tracking-job-${jobs.olderA}`)).toHaveCount(0);
  await latestA.getByText("1 tentative précédente", { exact: true }).click();
  const oldAttempt = latestA.getByRole("link", / · Lu$/);
  await expect(oldAttempt).toHaveAttribute("href", `/dashboard/affaires/${projectId}/takeoff?job=${jobs.olderA}`);
  await latestA.getByText("1 tentative précédente", { exact: true }).click();
  await ui.browser.setViewport({ width: 390, height: 844 });
  await expect(latestA).toContainText(`${NAMES.a} · pages 2, 7`);
  expect(await ui.browser.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await ui.browser.setViewport({ width: 1280, height: 800 });
  const reviewA = takeoffReviewHref({ projectId, jobId: jobs.a });
  await expect(ui.screen.getByRole("link", `Revoir ${NAMES.a}`).first()).toHaveAttribute("href", reviewA);
  await expect(ui.screen.getByRole("heading", "Premiers plans prêts à revoir", { exact: true })).toBeVisible();
  // lot 2's grouped analysis stays one analysis of three plans in the history.
  await expect(ui.screen.getByTestId("takeoff-request-history")).toContainText("Analyse groupée de 3 plans · lue");
  await ui.browser.evaluate(() => { document.querySelector("[data-testid='takeoff-request-activity']")?.scrollIntoView({ block: "start" }); return true; });
  const screenshotRunning = await ui.app.screenshot("takeoff-request-a-ready-b-read");

  // 2. One poll: the light read is read again every 5 s while B is read; over more than 20 s (the list's former cadence)
  // the list of analyses is not read again, and nothing reads a job's detail.
  const lightBefore = count("light");
  const listBefore = count("list");
  const pollStart = Date.now();
  await expect.poll(() => count("light"), { timeout: 40_000 }).toBeGreaterThanOrEqual(lightBefore + 5);
  expect(Date.now() - pollStart).toBeGreaterThan(20_000);
  expect(count("list")).toBe(listBefore);
  expect(count("detail")).toBe(0);

  // 3. While the member types a level for C, B ends: it shows at the next poll; the typing and the focus stay.
  await ui.screen.getByRole("button", `Bâtiment et niveau de ${NAMES.c}`, { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Localisation du plan");
  await expect(ui.screen.getByTestId("plan-location-summary-level")).toBeVisible({ timeout: 45_000 });
  const level = dialog.getByLabel("Niveau", { exact: true });
  await level.fill("L0");
  await querySql(`begin;
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'completed', completed_at = clock_timestamp(), analysis_outcome = 'success',
  analysis_finished_at = clock_timestamp(), analysis_completion_event_id = gen_random_uuid(), updated_at = clock_timestamp()
  where id = '${jobs.b}';
${items(jobs.b, "b", [1])}
commit;`);
  const coverageText = () => ui.browser.evaluate(() => document.querySelector("[data-testid='takeoff-request-coverage']")?.textContent ?? "");
  await expect.poll(coverageText, { timeout: 15_000 }).toBe("2 plans lus sur 3 · 1 en attente");
  await expect(level).toHaveValue("L0");
  expect(await ui.browser.evaluate(() => {
    const focused = document.activeElement;
    return focused instanceof HTMLInputElement ? focused.value : null;
  })).toBe("L0");
  // The transition read the list of analyses again, once; still no job detail.
  await expect.poll(() => count("list"), { timeout: 10_000 }).toBeGreaterThan(listBefore);
  expect(count("detail")).toBe(0);
  await dialog.getByRole("button", "Fermer", { exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(ui.screen.getByRole("link", `Revoir ${NAMES.b}`, { exact: true })).toBeVisible();

  // 4. A's reviews open without a version and name the plans of the request (the review reads A's own detail).
  const detailsOnTheActivity = count("detail");
  await ui.screen.getByRole("link", `Revoir ${NAMES.a}`, { exact: true }).first().click();
  await expect(ui.browser).toHaveURL(new RegExp(`${reviewA}$`));
  const strip = ui.screen.getByRole("navigation", "Plans de cette analyse", { exact: true });
  await expect(strip).toContainText("Plan 1 sur 3 de cette analyse");
  await expect(strip.getByRole("link", `Plan suivant : ${NAMES.b}`, { exact: true }))
    .toHaveAttribute("href", takeoffReviewHref({ projectId, jobId: jobs.b }));
  await expect(ui.screen.getByTestId("takeoff-request-plans-missing")).toContainText(`${NAMES.c} (en attente)`);
  const screenshotReview = await ui.app.screenshot("takeoff-review-plans-of-request");
  await expect(ui.screen.getByRole("heading", "Revue des exceptions & preuves", { exact: true })).toBeVisible({ timeout: 60_000 });
  await ui.app.open(takeoffReviewHref({ projectId, jobId: jobs.a, targeted: true }));
  await expect(ui.screen.getByRole("heading", "Revue ciblée", { exact: true })).toBeVisible({ timeout: 60_000 });

  // 5. The end-of-analysis link names a request: the page opens it, then leads back to the latest.
  await ui.app.open(`/dashboard/affaires/${projectId}/takeoff?request=${olderId}`);
  await waitForHydration(ui.browser);
  await expect(ui.screen.getByRole("heading", "Analyse demandée", { exact: true })).toBeVisible();
  await expect(coverage).toHaveText("Analyse groupée de 3 plans · lue");
  await ui.screen.getByRole("button", "Voir la dernière analyse de l’affaire", { exact: true }).click();
  await expect(coverage).toHaveText("2 plans lus sur 3 · 1 en attente");

  // 6. A director of the tenant sees the same states and opens the reviews, and is offered no action, while C still
  // waits (the owner could stop it, step 1).
  const reader = await signUpWorkerOwner(ui, "APR");
  await querySql(`update public.tenant_memberships set is_default = false where user_id = '${reader.userId}';
    insert into public.tenant_memberships (tenant_id,user_id,role,is_default) values ('${tenantId}','${reader.userId}','director',true);`);
  await ui.app.open(`/dashboard/affaires/${projectId}/takeoff`);
  await waitForHydration(ui.browser);
  await expect(coverage).toHaveText("2 plans lus sur 3 · 1 en attente");
  await expect(unitOf("c")).toContainText("En attente");
  await expect(ui.screen.getByRole("link", `Revoir ${NAMES.a}`, { exact: true }).first()).toBeVisible();
  await ui.browser.evaluate(() => { document.querySelector("[data-testid='takeoff-request-activity']")?.scrollIntoView({ block: "start" }); return true; });
  const screenshotReader = await ui.app.screenshot("takeoff-request-director");
  for (const label of ["Annuler", "Soumettre à nouveau", "Prendre en charge avec mon forfait", "Reprendre avec mon forfait"]) {
    await expect(ui.screen.getByTestId("takeoff-request-activity").getByRole("button", label, { exact: true })).toHaveCount(0);
  }

  // 7. Once everything is final, the poll stops: its freshness line goes, and nothing is read again.
  await expect(ui.screen.getByTestId("takeoff-request-freshness")).toBeVisible();
  await querySql(`begin;
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'completed', started_at = clock_timestamp(), completed_at = clock_timestamp(),
  analysis_outcome = 'success', analysis_finished_at = clock_timestamp(), analysis_completion_event_id = gen_random_uuid(),
  updated_at = clock_timestamp() where id = '${jobs.c}';
update public.takeoff_launch_requests set state = 'closed', outcome = 'success', units_succeeded = 3, closed_at = clock_timestamp(),
  completion_event_id = gen_random_uuid(), updated_at = clock_timestamp() where id = '${requestId}';
commit;`);
  await expect(coverage).toHaveText("3 plans lus sur 3", { timeout: 40_000 });
  await expect(ui.screen.getByTestId("takeoff-request-freshness")).toHaveCount(0);
  const settled = count("light");
  await new Promise((resolve) => setTimeout(resolve, 11_000));
  expect(count("light")).toBe(settled);
  await expect(ui.screen.getByRole("heading", "Vérifier le métré proposé", { exact: true })).toBeVisible();
  expect(detailsOnTheActivity).toBe(0);
  // Reading never wrote: no audit row since the fixture.
  expect(await auditCount()).toBe(auditsBefore);

  await recordEvidence(ui.army, "TKPA01-plan-analyses", { projectId, requestId, olderId, jobs, reads: {
    light: count("light"), list: count("list"), detail: count("detail") }, screenshots: [screenshotRunning, screenshotReview, screenshotReader],
  boundary: "Owned stack; the request and its analyses written as fixtures (format 2 and format 1) with triggers off; no AI call, no e-mail, no worker." });
});
