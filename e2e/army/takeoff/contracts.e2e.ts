import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect } from "e2e";
import * as XLSX from "xlsx";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence, resolveDownload,
} from "../critical/fixtures";
import {
  TAKEOFF_SEND, TAKEOFF_SEND_CONFIRM, applyOwnedTakeoff, localTakeoffFixture, localTakeoffWorkerClient, openTakeoffSend,
} from "./fixtures";
import { nativeTest } from "./native-ui";
import { querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { seedPublishedItemTable } from "./item-table-support";
import { launchWorkerCsv, signUpWorkerOwner } from "./worker-support";

type Envelope<T> = { ok: boolean; data: T; error?: { code: string; details?: {
  blocked_items?: Array<{ item_id: string; designation: string }>; medium_items?: Array<{ designation: string }>; threshold?: number;
  guard?: string; missing_item_ids?: string[]; invalid_items?: Array<{ item_id: string; error: string }>;
} } };
type LineTruth = { qtyStatus?: { code?: string; label?: string; detail?: string } } | null | undefined;
type Item = { id: string; designation: string; confidence: number; is_excluded: boolean; is_verified: boolean; updated_at: string;
  source_page: number; source_file_name: string; exclusion_reason: string | null };
const options = { session: "army", tags: ["critical", "takeoff", "local"], timeout: 180_000 };


const definitions = [
  { designation: "Cloison BA13 ep.72", quantity: 42, unit: "m2", confidence: 0.23 },
  { designation: "Faux-plafond 60x60", quantity: 15, unit: "m2", confidence: 0.41 },
  { designation: "Enduit platre int.", quantity: 80, unit: "m2", confidence: 0.65 },
  { designation: "Peinture acrylique", quantity: 120, unit: "m2", confidence: 0.92 },
  { designation: "Excluded low conf", quantity: 5, unit: "u", confidence: 0.1, is_excluded: true },
];

nativeTest("TKF05 a stored historical level-A job remains present and can be canceled", options, async ({ ui }) => {
  const { ids, jobId } = await launchWorkerCsv(ui, "TKF05");
  expect(jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  await expect.poll(async () => {
    const list = await apiRequest<Envelope<{ jobs: { id: string }[] }>>(ui.browser, "GET", `/api/takeoff/jobs?estimate_version_id=${ids.versionId}&limit=20&offset=0`);
    expect(list.status).toBe(200);
    return list.body.data.jobs.some(job => job.id === jobId);
  }).toBe(true);
  const canceled = await apiRequest<Envelope<{ job: { id: string; status: string } }>>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/cancel`);
  expect(canceled.status).toBe(200);
  expect(canceled.body.data.job).toMatchObject({ id: jobId, status: "canceled" });
  await recordEvidence(ui.army, "takeoff-level-a-upload", { ids, jobId, canceled: canceled.body.data.job });
});

// TI-681 replaces mandatory low-confidence acknowledgements with non-blocking recommendations.
armyTest("TKF01 low-confidence measures apply without individual verification and retain their evidence", options, async ({ app, screen, browser, army }) => {
  const ids = await createEstimateViaWizard({ app, screen, browser }, { projectName: army.projectName, title: "ARMY targeted recommendations" }, army);
  const line = await createLineViaApi(browser, ids.versionId, `${army.runPrefix} target`);
  const fixture = await localTakeoffFixture(army, ids);
  const seed = await fixture.seed("C", definitions);
  const applied = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, { strategy: "append", target_section_id: line.parent_id });
  expect(applied.status).toBe(200);
  const after = await readEstimate(browser, ids.versionId);
  for (const item of definitions.filter(item => !item.is_excluded)) {
    expect(after.items.find(row => row.title === item.designation)?.quantity).toBe(item.quantity);
  }
  expect(after.items.some(item => item.title === "Excluded low conf")).toBe(false);
  const detail = await apiRequest<Envelope<{ items: { data: Item[] } }>>(browser, "GET", `/api/takeoff/jobs/${seed.jobId}`);
  expect(detail.status).toBe(200);
  expect(detail.body.data.items.data.filter(item => !item.is_excluded).every(item => !item.is_verified && item.source_page === 1)).toBe(true);
  await recordEvidence(army, "TKF01-nonblocking-apply", { ids, jobId: seed.jobId, result: applied });
});

for (const scenario of ["level-a", "admin-override", "excluded"] as const) {
  armyTest(`TKF02 ${scenario} applies only admitted measures and retains exact quantities`, options, async ({ app, screen, browser, army }) => {
    const ids = await createEstimateViaWizard({ app, screen, browser }, { projectName: army.projectName, title: `ARMY ${scenario}` }, army);
    const target = await createLineViaApi(browser, ids.versionId, `${army.runPrefix} target`);
    const fixture = await localTakeoffFixture(army, ids);
    const items = scenario === "excluded" ? definitions.map(item => ({ ...item, is_excluded: item.confidence < 0.8 })) : definitions;
    const seed = await fixture.seed(scenario === "level-a" ? "A" : "C", items);
    if (scenario === "admin-override") {
      // TI-681: confidence alone is optional; keep the override/audit test on a real provenance protection: the two
      // first lines lose their localized proof.
      const worker = await localTakeoffWorkerClient(army, ids.versionId);
      for (const item of seed.items.slice(0, 2)) {
        const missing = await worker.client.from("takeoff_items").update({ evidence: null }).eq("id", item.id);
        expect(missing.error).toBeNull();
      }
    }
    const request = { strategy: "append", target_section_id: target.parent_id };
    // TI-686 D10: each forced line carries a coded reason and the index of its justification, stored once.
    const justification = "ARMY explicit administrator validation for fixture";
    const forcedItem = (index: number, reason_code = "additional_evidence") => ({ item_id: seed.items[index].id, reason_code,
      justification_index: 0 });
    if (scenario === "admin-override") {
      const invalid = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, { ...request, override: true });
      await recordEvidence(army, "takeoff-missing-justification", { ids, seed, response: invalid });
      expect(invalid.status).toBe(422);
      expect(invalid.body).toMatchObject({ ok: false });
      const partial = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, { ...request, override: true,
        forced_justifications: [justification], forced_items: [forcedItem(0)] });
      await recordEvidence(army, "takeoff-override-missing-line", { ids, seed, response: partial });
      expect(partial.status).toBe(422);
      expect((partial.body as Envelope<unknown>).error).toMatchObject({ code: "VALIDATION_ERROR",
        details: { guard: "override_reasons", missing_item_ids: [seed.items[1].id] } });
      const falsePositive = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, { ...request, override: true,
        forced_justifications: [justification], forced_items: [
          { ...forcedItem(0, "rule_false_positive"), false_positive_rules: ["dn_network"] }, forcedItem(1)] });
      await recordEvidence(army, "takeoff-override-false-positive-without-rule", { ids, seed, response: falsePositive });
      expect(falsePositive.status).toBe(422);
      expect((falsePositive.body as Envelope<unknown>).error).toMatchObject({ code: "VALIDATION_ERROR",
        details: { guard: "override_reasons", missing_item_ids: [], invalid_items: [{ item_id: seed.items[0].id }] } });
    }
    const body = {
      ...request, ...(scenario === "admin-override" ? { override: true, forced_justifications: [justification],
        forced_items: [forcedItem(0), forcedItem(1)] } : {}),
    };
    const before = await readEstimate(browser, ids.versionId);
    const foreign = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, body, true);
    await recordEvidence(army, "takeoff-foreign-page-refused", { ids, seed, response: foreign });
    expect(foreign.status).toBe(409);
    expect(foreign.body).toMatchObject({ ok: false });
    expect((await readEstimate(browser, ids.versionId)).items).toEqual(before.items);
    const response = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, body);
    await recordEvidence(army, `takeoff-${scenario}`, { ids, seed, response });
    expect(response.status).toBe(200);
    const after = await readEstimate(browser, ids.versionId);
    for (const item of items.filter(item => !item.is_excluded)) expect(after.items.find(row => row.title === item.designation)?.quantity).toBe(item.quantity);
    for (const item of items.filter(item => item.is_excluded)) expect(after.items.some(row => row.title === item.designation)).toBe(false);
    if (scenario === "admin-override") {
      // TI-686 D10 (H8, H9): the lines forced past their missing localized proof enter the internal estimate as
      // provisions, with their coded reason; the admitted lines stay measured, low confidence included (TI-681: it no
      // longer blocks, so nothing forces it). The printed estimate shows ordinary priced lines, never the provision or
      // the override.
      const truth = (title: string) => (after.items.find(row => row.title === title)?.line_truth as LineTruth)?.qtyStatus;
      expect(seed.items.slice(0, 2).map(item => item.designation)).toEqual(["Cloison BA13 ep.72", "Faux-plafond 60x60"]);
      expect(Object.fromEntries(items.filter(item => !item.is_excluded).map(item => [item.designation, truth(item.designation)?.code])))
        .toEqual({ "Cloison BA13 ep.72": "internal_provision", "Faux-plafond 60x60": "internal_provision",
          "Enduit platre int.": "measured", "Peinture acrylique": "measured" });
      expect(truth("Cloison BA13 ep.72")?.detail).toContain("(motif : Preuve complémentaire)");
      await browser.goto(`/dashboard/estimates/${ids.versionId}/print?price_mode=unit_and_total&detail_level=lines`, { waitUntil: "domcontentloaded" });
      await expect(screen.getByRole("heading", "Devis", { exact: true })).toBeVisible();
      const printed = await browser.evaluate(() => Array.from(document.querySelectorAll(".estimate-document"))
        .filter(element => element.getClientRects().length > 0).map(element => element.textContent ?? "").join(" "));
      await recordEvidence(army, "takeoff-admin-override-print", { versionId: ids.versionId, printed });
      expect(printed).toContain("Cloison BA13 ep.72");
      expect(printed).toContain("Faux-plafond 60x60");
      expect(printed).not.toMatch(/Provision interne|Hypothèse|forç|dérogation/);
    }
  });
}

armyTest("TKF06 final wizard confirmation applies through the owning page session and persists exact quantities", options, async ui => {
  const { app, browser, army } = ui;
  await browser.emulateMedia({ reducedMotion: "reduce" });
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title: "ARMY UI apply session" }, army);
  const target = await createLineViaApi(browser, ids.versionId, `${army.runPrefix} existing target`);
  expect(target.parent_id).toMatch(/^[0-9a-f-]{36}$/i);
  const fixture = await localTakeoffFixture(army, ids);
  const measures = [
    { designation: `${army.runPrefix} UI admitted A`, quantity: 12.5, unit: "m2", confidence: 0.9 },
    { designation: `${army.runPrefix} UI admitted B`, quantity: 3, unit: "u", confidence: 0.9 },
    { designation: `${army.runPrefix} UI excluded`, quantity: 7, unit: "u", confidence: 0.9, is_excluded: true },
  ];
  const seed = await fixture.seed("A", measures);
  const before = await readEstimate(browser, ids.versionId);
  await app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${seed.jobId}/review?versionId=${ids.versionId}`);
  // One screen: the impact preview is computed without a click, the excluded line is not among the lines sent, and the
  // request carries the version's strategy (no DPGF line: append) and no overrides.
  const sent: unknown[] = [];
  await browser.route(new RegExp(`/api/takeoff/jobs/${seed.jobId}/apply$`), async (route) => {
    sent.push(JSON.parse(route.request.postData ?? "{}"));
    await route.fallback();
  });
  const dialog = await openTakeoffSend(ui, target.parent_id!, measures[0].designation);
  const lines = dialog.getByRole("list", "Lignes envoyées", { exact: true });
  await expect(lines).toContainText(measures[1].designation);
  await expect(lines).not.toContainText(measures[2].designation);
  await expect(dialog.getByRole("region", "Aperçu d’impact", { exact: true })).toContainText("Rien n’est écrit dans le devis avant votre confirmation.");
  const finalApply = browser.waitForResponse(`**/api/takeoff/jobs/${seed.jobId}/apply`);
  await dialog.getByRole("button", TAKEOFF_SEND_CONFIRM, { exact: true }).click();
  const response = await finalApply;
  const result = await response.json<Envelope<{ job: { id: string; status: string }; summary: { created_count: number; updated_count: number } }>>();
  await recordEvidence(army, "takeoff-ui-apply-response", { ids, seed, status: response.status, ok: result.ok,
    job: { id: result.data?.job?.id ?? null, status: result.data?.job?.status ?? null }, summary: result.data?.summary ?? null,
    errorCode: result.error?.code ?? null });
  expect(response.status).toBe(200);
  expect(result.ok).toBe(true);
  expect(result.data.job).toMatchObject({ id: seed.jobId, status: "applied" });
  expect(result.data.summary).toMatchObject({ created_count: 2, updated_count: 0 });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ strategy: "append", target_section_id: target.parent_id });
  expect(sent[0]).not.toHaveProperty("overrides");
  await expect(dialog).not.toBeVisible();
  await browser.reload();
  const after = await readEstimate(browser, ids.versionId);
  for (const item of measures.filter(item => !item.is_excluded)) {
    expect(after.items.find(row => row.title === item.designation)).toMatchObject({ quantity: item.quantity, parent_id: target.parent_id });
  }
  expect(after.items.some(row => row.title === measures[2].designation)).toBe(false);
  for (const item of before.items) expect(after.items.find(row => row.id === item.id)).toMatchObject({ title: item.title, quantity: item.quantity, unit_price_ht_cents: item.unit_price_ht_cents });
  await recordEvidence(army, "takeoff-ui-apply-persisted", { ids, seed, expected: measures, items: after.items.map(({ id, title, quantity, parent_id }) => ({ id, title, quantity, parent_id })) });
});

// TI-686 D10: the first journey through the guard panel. Two lines without their localized proof (level C) are forced
// from the wizard: one coded reason and one justification written once, copied to the selection, then the whole override
// sent; both enter the internal estimate as provisions with their reason, the admitted line stays measured. That an
// engineer cannot force it is checked on the same job in this journey’s disposable tenant.
armyTest("TKF07 an administrator forces each blocked line from the apply wizard with a coded reason", options, async ui => {
  const { app, screen, browser, army } = ui;
  await browser.emulateMedia({ reducedMotion: "reduce" });
  const owner = await signUpWorkerOwner(ui, "TKFORCE");
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title: "ARMY UI forced apply" }, army);
  const target = await createLineViaApi(browser, ids.versionId, `${army.runPrefix} forced target`);
  const fixture = await localTakeoffFixture(army, ids, owner.email, owner.password);
  const measures = [
    { designation: `${army.runPrefix} UI forced A`, quantity: 12.5, unit: "m2", confidence: 0.9 },
    { designation: `${army.runPrefix} UI forced B`, quantity: 3, unit: "u", confidence: 0.9 },
    { designation: `${army.runPrefix} UI admitted`, quantity: 7, unit: "u", confidence: 0.9 },
  ];
  const seed = await fixture.seed("C", measures);
  const worker = await localTakeoffWorkerClient(army, ids.versionId, owner.email, owner.password);
  for (const item of seed.items.slice(0, 2)) {
    const missing = await worker.client.from("takeoff_items").update({ evidence: null }).eq("id", item.id);
    expect(missing.error).toBeNull();
  }
  const review = `/dashboard/affaires/${ids.projectId}/takeoff/${seed.jobId}/review?versionId=${ids.versionId}`;
  const before = await readEstimate(browser, ids.versionId);
  const justification = "ARMY relevé chantier joint au dossier fictif";
  const forcedItems = seed.items.slice(0, 2).map(item => ({
    item_id: item.id, reason_code: "additional_evidence", justification_index: 0,
  }));
  const changeRole = async (role: "admin" | "engineer") => {
    const changed = await worker.client.from("tenant_memberships").update({ role })
      .eq("tenant_id", owner.tenantId).eq("user_id", owner.userId).select("role").single();
    expect(changed.data?.role).toBe(role);
  };
  await changeRole("engineer");
  for (const mode of ["production", "validation"]) {
    await app.open(`${review}&reviewMode=${mode}`);
    await expect(screen.getByText(/Le contrôle de 2 ligne\(s\) reste incomplet/).first()).toBeVisible();
    await expect(screen.getByRole("button", TAKEOFF_SEND, { exact: true })).toBeDisabled();
  }
  const refused = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, {
    strategy: "append", target_section_id: target.parent_id, override: true,
    forced_items: forcedItems, forced_justifications: [justification],
  });
  expect(refused.status).toBe(403);
  expect(refused.body).toMatchObject({ error: { message: "Seul un administrateur peut forcer l'application des lignes bloquées." } });
  await changeRole("admin");
  for (const mode of ["production", "validation"]) {
    await app.open(`${review}&reviewMode=${mode}`);
    await expect(screen.getByText(/2 lignes restent à trancher.*revue ciblée.*justifier.*une par une.*envoi/i).first()).toBeVisible();
    await expect(screen.getByText(/Prêt à envoyer|Prêt pour l'envoi|Tous les items sont conformes|L'application n'est pas bloquée/)).toHaveCount(0);
    await expect(screen.getByRole("button", TAKEOFF_SEND, { exact: true })).toBeEnabled();
  }
  const dialog = await openTakeoffSend(ui, target.parent_id!, measures[0].designation);
  await expect(dialog).toContainText("Lignes à trancher");
  for (const item of measures.slice(0, 2)) {
    await expect(dialog.getByRole("checkbox", item.designation, { exact: true })).toBeChecked();
    await expect(dialog.getByLabel(`Motif : ${item.designation}`, { exact: true })).toHaveValue("");
  }
  await expect(dialog.getByRole("button", TAKEOFF_SEND_CONFIRM, { exact: true })).toBeDisabled();
  const force = dialog.getByRole("button", "Forcer l'application (2 lignes)", { exact: true });
  await expect(force).toBeDisabled();
  await dialog.getByLabel("Motif de la sélection", { exact: true }).selectOption({ value: "additional_evidence" });
  await dialog.getByLabel("Justification de la sélection", { exact: true }).fill(justification);
  await dialog.getByRole("button", "Appliquer à la sélection", { exact: true }).click();
  await expect(force).toBeEnabled();
  expect((await readEstimate(browser, ids.versionId)).items).toEqual(before.items);
  const forcedApply = browser.waitForResponse(`**/api/takeoff/jobs/${seed.jobId}/apply`);
  await force.click();
  const response = await forcedApply;
  const result = await response.json<Envelope<{ job: { id: string; status: string }; summary: { created_count: number } }>>();
  await recordEvidence(army, "takeoff-ui-forced-apply-response", { ids, seed, status: response.status, ok: result.ok,
    job: result.data?.job ?? null, summary: result.data?.summary ?? null, errorCode: result.error?.code ?? null });
  expect(response.status).toBe(200);
  expect(result.data.job).toMatchObject({ id: seed.jobId, status: "applied" });
  await expect(dialog).not.toBeVisible();
  const after = await readEstimate(browser, ids.versionId);
  const audit = await worker.client.from("takeoff_apply_override_consumptions")
    .select("user_id, audit_logs!inner(after_data)").eq("tenant_id", owner.tenantId)
    .eq("job_id", seed.jobId).eq("estimate_version_id", ids.versionId).single();
  expect(audit.error).toBeNull();
  expect(audit.data).toMatchObject({ user_id: owner.userId, audit_logs: { after_data: { metadata: {
    forced_items: expect.arrayContaining(forcedItems), forced_justifications: [justification],
  } } } });
  const truth = (title: string) => (after.items.find(row => row.title === title)?.line_truth as LineTruth)?.qtyStatus;
  for (const item of measures) expect(after.items.find(row => row.title === item.designation)?.quantity).toBe(item.quantity);
  expect(measures.map(item => truth(item.designation)?.code)).toEqual(["internal_provision", "internal_provision", "measured"]);
  expect(measures.slice(0, 2).map(item => truth(item.designation)?.label)).toEqual(["Provision interne", "Provision interne"]);
  for (const item of measures.slice(0, 2)) expect(truth(item.designation)?.detail).toContain("(motif : Preuve complémentaire)");
  await recordEvidence(army, "takeoff-ui-forced-apply-persisted", { ids, seed, lines: measures.map(item => ({
    designation: item.designation, quantity: after.items.find(row => row.title === item.designation)?.quantity ?? null,
    qtyStatus: truth(item.designation) ?? null })) });
  // TI-682 lot C (H12 lifted for the CSV): the CSV the editor downloads names both forced lines « Provision interne »; the
  // admitted line and the line created by hand stay empty. The editor writes it for a v1/v2 (this campaign's engine 2) and
  // the server for a v3. The client and supplier workbooks never carry it (TKF02, takeoff-provision-exports.test.ts).
  await app.open(`/dashboard/estimates/${ids.versionId}/edit`);
  await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
  const exportMenu = screen.getByRole("button", "Exporter", { exact: true });
  await expect(exportMenu).toBeEnabled({ timeout: 30_000 });
  await exportMenu.tap();
  const csvItem = screen.getByRole("button", "Fichier CSV (.csv)", { exact: true });
  await expect(csvItem).toBeEnabled({ timeout: 30_000 });
  const csvFile = await browser.waitForDownload(() => csvItem.tap(), { timeout: 60_000 });
  const csvPath = await resolveDownload(csvFile);
  const csvBytes = await readFile(csvPath);
  const book = XLSX.read(csvBytes, { type: "buffer", raw: true, FS: ";" });
  const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: "" });
  const header = (rows[0] ?? []).map(cell => String(cell));
  const provisionOf = (title: string) =>
    rows.find(row => row[header.indexOf("Désignation")] === title)?.[header.indexOf("Provision métré")] ?? null;
  const titles = [...measures.map(item => item.designation), `${army.runPrefix} forced target`];
  const csv = { filename: csvFile.suggestedFilename, column: header.at(-1) ?? null, lines: titles.map(title => [title, provisionOf(title)]) };
  await recordEvidence(army, "takeoff-ui-forced-apply-csv", { ids, engine: after.version.calc_engine_version, path: csvPath,
    bytes: csvBytes.length, csv });
  expect(csv).toEqual({ filename: expect.stringMatching(/\.csv$/), column: "Provision métré",
    lines: [[titles[0], "Provision interne"], [titles[1], "Provision interne"], [titles[2], ""], [titles[3], ""]] });
});

armyTest("TKF03 foundations, provenance edit and pagination limits remain observable", options, async ({ app, screen, browser, army }) => {
  const ids = await createEstimateViaWizard({ app, screen, browser }, { projectName: army.projectName, title: "ARMY provenance" }, army);
  const fixture = await localTakeoffFixture(army, ids);
  const health = await apiRequest<Envelope<{ enabled: boolean; tenant_id: string }>>(browser, "GET", "/api/takeoff/health");
  expect([health.status, health.body.data.enabled, health.body.data.tenant_id]).toEqual([200, true, fixture.tenantId]);
  const seed = await fixture.seed("B", [{ designation: "Mur porteur", quantity: 32, unit: "m2", confidence: 0.86, source_page: 3 }], "ARMY-provenance.pdf");
  const detail = await apiRequest<Envelope<{ items: { data: Item[] } }>>(browser, "GET", `/api/takeoff/jobs/${seed.jobId}`);
  expect(detail.status).toBe(200);
  const item = detail.body.data.items.data[0];
  expect([item.source_page, item.source_file_name]).toEqual([3, "ARMY-provenance.pdf"]);
  const patch = await apiRequest<Envelope<{ succeeded: number; failed: number }>>(browser, "PATCH", `/api/takeoff/jobs/${seed.jobId}/items`, {
    items: [{ item_id: item.id, updated_at: item.updated_at, fields: { is_excluded: true, exclusion_reason: "ARMY explicit provenance exclusion" } }],
  });
  expect([patch.status, patch.body.data.succeeded, patch.body.data.failed]).toEqual([200, 1, 0]);
  const after = await apiRequest<Envelope<{ items: { data: Item[] } }>>(browser, "GET", `/api/takeoff/jobs/${seed.jobId}`);
  expect(after.body.data.items.data[0]).toMatchObject({ source_page: 3, source_file_name: "ARMY-provenance.pdf", is_excluded: true, exclusion_reason: "ARMY explicit provenance exclusion" });
  const limit = await apiRequest<Envelope<unknown>>(browser, "GET", `/api/takeoff/jobs?estimate_version_id=${ids.versionId}&limit=20&offset=10001`);
  expect([400, 422]).toContain(limit.status);
  expect(["VALIDATION_ERROR", "BAD_REQUEST"]).toContain(limit.body.error?.code);
  await recordEvidence(army, "takeoff-provenance", { ids, seed, after, limit });
});

armyTest("TKF04 revision comparison exposes actual additions removals and changed quantities", options, async ({ app, screen, browser, army }) => {
  const ids = await createEstimateViaWizard({ app, screen, browser }, { projectName: army.projectName, title: "ARMY revision delta" }, army);
  const fixture = await localTakeoffFixture(army, ids);
  const base = await fixture.seed("C", [
    { designation: "Mur BA13", quantity: 10, unit: "m2", confidence: 0.9 },
    { designation: "Porte bois", quantity: 2, unit: "u", confidence: 0.88, source_page: 2 },
  ]);
  const other = await fixture.seed("C", [
    { designation: "Mur BA13", quantity: 12, unit: "m2", confidence: 0.93 },
    { designation: "Fenetre PVC", quantity: 1, unit: "u", confidence: 0.81, source_page: 3 },
  ]);
  const response = await apiRequest<Envelope<{ base_job_id: string; other_job_id: string; summary: { added: number; removed: number; changed: number } }>>(browser, "GET", `/api/takeoff/jobs/${base.jobId}/compare?with=${other.jobId}`);
  await recordEvidence(army, "takeoff-revision-comparison", { ids, base, other, response });
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ base_job_id: base.jobId, other_job_id: other.jobId });
  expect(response.body.data.summary).toMatchObject({ added: 1, removed: 1, changed: 1 });
});

for (const scope of ["archived", "other-tenant"] as const) {
  armyTest(`A takeoff bookmark for an ${scope} affaire reveals no destination`, options, async ui => {
    const ids = await createEstimateViaWizard(ui, { projectName: ui.army.projectName, title: "ARMY accès au métré" }, ui.army);
    const fixture = await localTakeoffFixture(ui.army, ids);
    const { jobId } = await fixture.seed("A", definitions);
    const path = `/dashboard/estimates/${ids.versionId}/takeoff/${jobId}/review?reviewMode=production&view=items`;
    await ui.app.open(path);
    await expect(ui.browser).toHaveURL(`/dashboard/affaires/${ids.projectId}/takeoff/${jobId}/review?versionId=${ids.versionId}&reviewMode=production&view=items`);
    if (scope === "archived") {
      const oldVersion = `/dashboard/estimates/${ids.versionId}`;
      const affaire = `/dashboard/affaires/${ids.projectId}`;
      for (const [from, to] of [
        ["/dashboard/takeoff", "/dashboard/affaires"],
        [`${oldVersion}/plans`, `${affaire}/plans`],
        [`${oldVersion}/takeoff`, `${affaire}/takeoff?version=${ids.versionId}`],
        [`${oldVersion}/takeoff/new`, `${affaire}/takeoff?launch=1&version=${ids.versionId}`],
        [`${oldVersion}/takeoff/${jobId}`, `${affaire}/takeoff/${jobId}/review?versionId=${ids.versionId}`],
      ]) {
        await ui.app.open(from);
        await expect(ui.browser).toHaveURL(to);
      }
      const unrelated = await createEstimateViaWizard(ui, { projectName: ui.army.projectName, title: "Autre version lisible" }, ui.army);
      const mismatched = `/dashboard/estimates/${unrelated.versionId}/takeoff/${jobId}`;
      await ui.app.open(mismatched);
      await expect(ui.screen.getByRole("heading", "Page introuvable", { exact: true })).toBeVisible();
      await expect(ui.browser).toHaveURL(mismatched);
      // A full document navigation through a streamed redirect must preserve the previous page for Back.
      await ui.app.open(`${affaire}/plans`);
      const streaming = await ui.browser.evaluate(async href => {
        const response = await fetch(href, { redirect: "manual" });
        return { status: response.status, meta: (await response.text()).includes('id="__next-page-redirect"') };
      }, path);
      await ui.app.open(path);
      await expect(ui.browser).toHaveURL(`${affaire}/takeoff/${jobId}/review?versionId=${ids.versionId}&reviewMode=production&view=items`);
      await ui.browser.evaluate(() => { window.history.back(); return true; });
      await expect(ui.browser).toHaveURL(`${affaire}/plans`);
      await recordEvidence(ui.army, "bookmark-back", streaming);
      const worker = await localTakeoffWorkerClient(ui.army, ids.versionId);
      const result = await worker.client.from("estimate_projects").update({ is_archived: true })
        .eq("id", ids.projectId).eq("tenant_id", worker.tenantId).select("id").single();
      expect(result.error).toBeNull();
      await ui.app.open("/dashboard/affaires?reprendre=metre");
      await expect(ui.browser).toHaveURL("/dashboard/affaires");
    } else {
      await signUpDedicatedOwner(ui.browser, ui.app.baseUrl!, ui.army.runPrefix, { tag: "TKACCESS" });
      const own = await createEstimateViaWizard(ui, { projectName: ui.army.projectName, title: "Autre affaire ARMY" }, ui.army);
      const foreignJob = `/dashboard/estimates/${own.versionId}/takeoff/${jobId}`;
      await ui.app.open(foreignJob);
      await expect(ui.screen.getByRole("heading", "Page introuvable", { exact: true })).toBeVisible();
      await expect(ui.browser).toHaveURL(foreignJob);
    }
    for (const bookmark of [path, `/dashboard/estimates/${ids.versionId}/plans`]) {
      await ui.app.open(bookmark);
      await expect(ui.screen.getByRole("heading", "Page introuvable", { exact: true })).toBeVisible();
      await expect(ui.browser).toHaveURL(bookmark);
    }
  });
}

armyTest("A remembered affaire and bookmarks respect the active engineer's ownership", options, async ui => {
  const owner = await signUpWorkerOwner(ui, "TKOWN");
  const colleague = await createEstimateViaWizard(ui, { projectName: ui.army.projectName, title: "Métré du collègue" }, ui.army);
  const foreign = await localTakeoffFixture(ui.army, colleague, owner.email, owner.password);
  const { jobId } = await foreign.seed("A", definitions);
  const worker = await localTakeoffWorkerClient(ui.army, colleague.versionId, owner.email, owner.password);
  const flag = await worker.client.from("feature_flags").upsert({
    tenant_id: owner.tenantId, flag_key: "TAKEOFF_MODULE_ENABLED", enabled: true,
  }, { onConflict: "tenant_id,flag_key" });
  expect(flag.error).toBeNull();
  const engineer = await signUpWorkerOwner(ui, "TKENG");
  const unset = await worker.client.from("tenant_memberships").update({ is_default: false })
    .eq("user_id", engineer.userId).eq("tenant_id", engineer.tenantId);
  expect(unset.error).toBeNull();
  const membership = await worker.client.from("tenant_memberships").insert({
    tenant_id: owner.tenantId, user_id: engineer.userId, role: "engineer", is_default: true,
  });
  expect(membership.error).toBeNull();
  const own = await createEstimateViaWizard(ui, { projectName: ui.army.projectName, title: "Métré personnel" }, ui.army);
  const session = await localTakeoffFixture(ui.army, own, engineer.email, engineer.password);
  expect(session.tenantId).toBe(owner.tenantId);
  const projectRead = await session.client.from("estimate_projects").select("id").eq("id", colleague.projectId);
  const versionRead = await session.client.from("estimate_versions").select("id").eq("id", colleague.versionId);
  expect(projectRead.error).toBeNull();
  expect(versionRead.error).toBeNull();
  expect(projectRead.data).toEqual([]);
  expect(versionRead.data).toEqual([]);
  await recordEvidence(ui.army, "engineer-colleague-rls", {
    projectRows: projectRead.data?.length, versionRows: versionRead.data?.length,
  });
  for (const path of [
    `/dashboard/estimates/${colleague.versionId}/plans`,
    `/dashboard/estimates/${own.versionId}/takeoff/${jobId}/review`,
  ]) {
    await ui.app.open(path);
    await expect(ui.screen.getByRole("heading", "Page introuvable", { exact: true })).toBeVisible();
    await expect(ui.browser).toHaveURL(path);
  }

  await ui.app.open(`/dashboard/affaires/${own.projectId}/plans`);
  await ui.browser.setViewport({ width: 390, height: 844 });
  await ui.screen.getByRole("button", { name: "Ouvrir le menu principal", exact: true }).click();
  const metres = ui.screen.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Métrés", exact: true });
  await expect(metres).toHaveAttribute("aria-current", "page");
  await metres.click();
  await expect(ui.browser).toHaveURL(`/dashboard/affaires/${own.projectId}/takeoff`);
  await ui.screen.getByRole("button", { name: "Ouvrir le menu principal", exact: true }).click();
  await expect(metres).toHaveAttribute("aria-current", "page");
  await ui.screen.getByRole("navigation", { name: "Menu principal" })
    .getByRole("link", { name: "Affaires", exact: true }).click();
  await expect(ui.browser).toHaveURL("/dashboard/affaires");
  await ui.browser.keyboard.press("ControlOrMeta+k");
  const palette = ui.screen.getByRole("dialog", { name: /Recherche rapide/i });
  await palette.getByRole("option", { name: /^Métrés\b/i }).click();
  await expect(ui.browser).toHaveURL(`/dashboard/affaires/${own.projectId}/takeoff`);
  // The remembered affaire changes hands while this engineer is on another screen.
  await ui.app.open("/dashboard/affaires");
  const transfer = await worker.client.from("estimate_projects").update({ user_id: owner.userId }).eq("id", own.projectId);
  expect(transfer.error).toBeNull();
  await ui.app.open("/dashboard/affaires?reprendre=metre");
  await expect(ui.browser).toHaveURL("/dashboard/affaires");
});

/**
 * An analysis of the first format in the affaire of a list (lot 4, « Analyse antérieure »): as an old worker wrote it,
 * without a request, with its result's warnings and table and two rows (one set aside with its reason, one the Assisted
 * review marked verified). Written as the database's owner, its triggers off for these rows only. Fictional values.
 */
async function seedEarlierAnalysis(projectId: string) {
  const ids = { job: randomUUID(), result: randomUUID(), rows: [randomUUID(), randomUUID()] };
  const result = { warnings: [{ code: "LOW_CONFIDENCE", message: "Cartouche peu lisible (fictif).", severity: "warning" }],
    tables: [{ page: 3, title: "Nomenclature fictive", headers: ["Repère", "Qté"], rows: [{ row_index: 0, cells: ["L1", "3"] }] }] };
  const output = await querySql(`begin;
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, source_file_name, source_file_type,
  source_file_size_bytes, schema_version, started_at, completed_at, created_at)
select '${ids.job}'::uuid, p.tenant_id, p.id, s.id, 'C'::public.takeoff_job_level, 'completed'::public.takeoff_job_status,
  'plan-ancien.pdf', 'application/pdf', 512, 'v1',
  now() - interval '2 days', now() - interval '2 days', now() - interval '2 days'
from public.estimate_projects p join public.plan_sets s on s.project_id = p.id where p.id = '${projectId}' limit 1;
insert into public.takeoff_results (id, tenant_id, job_id, extracted_json, warnings, tables, provider_meta)
select '${ids.result}'::uuid, tenant_id, id, '{}'::jsonb, '${JSON.stringify(result.warnings)}'::jsonb, '${JSON.stringify(result.tables)}'::jsonb,
  '{"provider":"gemini"}'::jsonb from public.takeoff_jobs where id = '${ids.job}';
insert into public.takeoff_items (id, tenant_id, job_id, result_id, designation, quantity, unit, source_file_name, source_page,
  is_excluded, exclusion_reason, is_verified, verified_at, created_at)
select '${ids.rows[0]}'::uuid, tenant_id, id, '${ids.result}'::uuid, 'Lavabo ancien format', 3, 'u', 'plan-ancien.pdf', 2, false, null, true, now(),
  now() - interval '2 days' from public.takeoff_jobs where id = '${ids.job}'
union all
select '${ids.rows[1]}'::uuid, tenant_id, id, '${ids.result}'::uuid, 'Vanne en double', 1, 'u', 'plan-ancien.pdf', 2, true,
  'Doublon de la vanne du R+1 (fictif)', false, null, now() - interval '2 days' + interval '1 second'
from public.takeoff_jobs where id = '${ids.job}';
commit;
select 'EARLIER_SEEDED';`);
  if (!output.includes("EARLIER_SEEDED")) throw new Error("The earlier analysis seed did not commit.");
  return ids.job;
}

// Lot 4, the entries: every old link to the review of an analysis read against the affaire's list lands on the table
// of items, filtered on what it names, with the explanation and without anything of the old address; its targeted
// review (the correction screen the table's line detail opens) stays; an earlier analysis of the same affaire is shown
// read only as kept, its review one click away; a member of another tenant gets « Page introuvable » at the same address.
nativeTest("TKLINK01 les liens d’une analyse lue contre la liste mènent aux postes ; une analyse antérieure se consulte telle quelle",
  { ...options, timeout: 240_000 }, async ({ ui }) => {
    const { app, screen, army } = ui;
    const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "TKLINK" });
    const seeded = await seedPublishedItemTable(owner, { name: `${army.runPrefix}-TKLINK`, labels: ["Lavabo", "Vanne DN32"],
      answers: ["measured", "uncertain"] });
    const earlierJob = await seedEarlierAnalysis(seeded.projectId);
    const [plan] = JSON.parse((await querySql(`select coalesce(jsonb_agg(distinct plan_logical_id), '[]')
      from public.takeoff_item_answers where job_id = '${seeded.jobId}';`)).at(-1) || "[]") as string[];
    expect(plan).toMatch(/^[0-9a-f-]{36}$/);
    const takeoff = `/dashboard/affaires/${seeded.projectId}/takeoff`;
    const review = `${takeoff}/${seeded.jobId}/review`;
    const table = screen.getByRole("table", "Postes du métré", { exact: true });
    // The explanation (role « note », named by its sentence).
    const explanation = ui.locator('[role="note"][aria-labelledby="metre-lien-explication"]');
    const landed: Record<string, string> = {};

    // 1. The review, in any mode: the table filtered on the plan the analysis read, and why.
    for (const from of [review, `${review}?reviewMode=assisted`, `${review}?reviewMode=production`, `${review}?reviewMode=validation&view=items`]) {
      await app.open(from);
      await expect(ui.browser).toHaveURL(`${takeoff}?postePlan=${plan}&lien=analyse&lienAnalyse=${seeded.jobId}`);
      await expect(table).toBeVisible();
      await expect(screen.getByRole("combobox", "Plan", { exact: true })).toHaveValue(plan);
      await expect(explanation).toContainText("Ce lien ouvrait la revue de l’analyse « plan-1.pdf »");
      await expect(explanation).toContainText("lue contre la liste des postes");
      await expect(explanation).toContainText("filtré sur son plan");
      landed[from] = await ui.browser.url();
    }
    // 2. Its DPGF exceptions (the radar's and the approvals queue's old address): that plan's items to check.
    const exceptions = `${review}?reviewMode=validation&view=dpgf&dpgfView=exceptions_only`;
    await app.open(exceptions);
    await expect(ui.browser).toHaveURL(`${takeoff}?postePlan=${plan}&posteDecision=pending&lien=ecarts&lienAnalyse=${seeded.jobId}`);
    await expect(screen.getByRole("combobox", "Décision", { exact: true })).toHaveValue("pending");
    await expect(explanation).toContainText("filtré sur son plan et sur les postes à vérifier");
    // 3. A line no item was sent from (no estimate version yet): never an invented item, the plan and why.
    await app.open(`${review}?line=${randomUUID()}`);
    await expect(ui.browser).toHaveURL(`${takeoff}?postePlan=${plan}&lien=ligne&lienAnalyse=${seeded.jobId}`);
    await expect(explanation).toContainText("n’est rattachée à aucun poste : le tableau des postes est filtré sur le plan de cette analyse.");
    // « Masquer » leaves the table as it is.
    await screen.getByRole("link", "Masquer", { exact: true }).click();
    await expect(ui.browser).toHaveURL(`${takeoff}?postePlan=${plan}`);
    await expect(explanation).toHaveCount(0);
    await expect(table).toBeVisible();
    // 4. Its targeted review stays where it is: the correction screen of lot 4.
    const targeted = `${review}/targeted`;
    await app.open(targeted);
    await expect(ui.browser).toHaveURL(targeted);
    await expect(screen.getByRole("heading", "Page introuvable", { exact: true })).toHaveCount(0);

    // 5. The earlier analysis beside the table: read only as kept, « liste demandée non enregistrée », coverage unknown,
    // no item invented and no row said verified; its review, where its send is, one click away and opened as today.
    await app.open(`${takeoff}?posteLimit=25`);
    const earlierPanel = screen.getByRole("list", "Analyses antérieures de l’affaire", { exact: true });
    await expect(earlierPanel).toContainText("plan-ancien.pdf");
    await expect(earlierPanel).not.toContainText("plan-1.pdf");
    await screen.getByRole("link", "Voir l’analyse antérieure plan-ancien.pdf", { exact: true }).click();
    await expect(ui.browser).toHaveURL(`${takeoff}?posteLimit=25&anterieure=${earlierJob}`);
    const earlier = ui.locator('[data-testid="analyse-anterieure"]');
    await expect(earlier).toContainText("Liste demandée non enregistrée");
    await expect(earlier).toContainText("Couverture inconnue");
    const rows = screen.getByRole("table", /Contributions observées/);
    await expect(rows).toContainText("Lavabo ancien format");
    await expect(rows).toContainText("Doublon de la vanne du R+1 (fictif)");
    await expect(earlier).toContainText("Nomenclature fictive · page 3");
    await expect(earlier).toContainText("Cartouche peu lisible (fictif).");
    await expect(earlier).toContainText("gemini");
    for (const absent of ["Non trouvé", "Vérifié", "Mesuré", "Vanne DN32"]) await expect(earlier).not.toContainText(absent);
    const shot = await app.screenshot("tklink-analyse-anterieure");
    await screen.getByRole("link", "Ouvrir sa revue", { exact: true }).click();
    await expect(ui.browser).toHaveURL(`${takeoff}/${earlierJob}/review`);
    await expect(screen.getByRole("heading", "Revue des exceptions & preuves", { exact: true })).toBeVisible({ timeout: 30_000 });
    // The way back from the earlier analysis keeps the table's address; a list job named as earlier is the table's.
    await app.open(`${takeoff}?posteLimit=25&anterieure=${earlierJob}`);
    await screen.getByRole("link", "Revenir aux postes", { exact: true }).click();
    await expect(ui.browser).toHaveURL(`${takeoff}?posteLimit=25`);
    await app.open(`${takeoff}?anterieure=${seeded.jobId}`);
    await expect(ui.browser).toHaveURL(`${takeoff}?postePlan=${plan}&lien=analyse&lienAnalyse=${seeded.jobId}`);

    // 6. A member of another tenant: the same addresses reveal nothing (the takeoff's own « not found »), and lead nowhere.
    const stranger = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "TKLINKX" });
    // Its takeoff module on, so that what refuses is the access to the job, not the module.
    await querySql(`insert into public.feature_flags (tenant_id, flag_key, enabled) values ('${stranger.tenantId}', 'TAKEOFF_MODULE_ENABLED', true)
on conflict (tenant_id, flag_key) do update set enabled = true;`);
    for (const path of [review, exceptions, `${takeoff}?anterieure=${earlierJob}`]) {
      await app.open(path);
      await expect(screen.getByText("Extractions introuvables ou accès non autorise.", { exact: true })).toBeVisible();
      await expect(ui.browser).toHaveURL(path);
      await expect(table).toHaveCount(0);
    }
    await recordEvidence(army, "tklink01-landings", { projectId: seeded.projectId, listJob: seeded.jobId, earlierJob, plan, landed, shot });
  });
