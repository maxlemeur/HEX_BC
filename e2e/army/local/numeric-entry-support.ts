import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { expect, type Locator } from "e2e";
import { ownEstimate, readEstimate, recordEvidence } from "../critical/fixtures";
import { amounts, applyComponents, componentArticle, componentDecision, componentSection, openComponents, saveComponents,
  type PreparedComponents, type Ui } from "./generated-ouvrage-components-support";
import type { Json } from "./generated-ouvrage-recovery-support";
import { sdkResultsRoot } from "./sdk-results";

// Failure contract precedes this harness: docs/testing/generated-ouvrage-numeric-entry.md.
export type NumericOracle = {
  retainedIndices: number[];
  components: Array<{ index: number; costType: string; quantity: number; unit: string; unitCostHtCents: number;
    lossCoeffBp: number; yieldValue: number | null; yieldUnit: string | null; derivedHours: number; dsCents: number }>;
  parent: { quantity: number; dsCents: number; effectiveUnitPriceHtCents: number; totalHours: number };
  totals: number[];
};
export type NumericContext = { ui: Ui; p: PreparedComponents; caseId: string; oracle: NumericOracle; observedSequence?: number };
type State = Awaited<ReturnType<PreparedComponents["capture"]>>;

export async function numericWitness(c: NumericContext, phase: string, expected: Json, actual: Json) {
  const observedSequence = (c.observedSequence ?? 0) + 1; c.observedSequence = observedSequence;
  return recordEvidence(c.ui.army, `${c.caseId}-${phase}`, {
    schemaVersion: "army-numeric-entry-witness-1", observedAt: new Date().toISOString(), observedSequence, caseId: c.caseId, phase,
    fixture: { label: c.p.s.label, projectId: c.p.s.projectId, versionId: c.p.s.versionId, draftId: c.p.s.draftId,
      candidateId: c.p.s.candidateId, componentIds: c.p.s.components.map((component) => component.componentId) }, expected, actual,
  });
}
export const numericSave = (c: NumericContext) => componentSection(c.ui, c.p.s).getByRole("button", /^(?:(Valider|Revalider) le sous-détail|Enregistrer les décisions)$/);
export const numericCounts = (c: NumericContext) => ({
  update: c.p.calls.filter((call) => call.name === "updateGeneratedOuvrageSubdetailDraft").length,
  insert: c.p.calls.filter((call) => call.name === "insertGeneratedOuvrages").length,
});
export async function numericField(c: NumericContext, index: number, label: string | RegExp) {
  const article = componentArticle(c.ui, c.p.s, index), toggle = article.getByRole("button", c.p.s.components[index].designation, { exact: false });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  const field = article.getByLabel(label, { exact: typeof label === "string" });
  await expect(field).toBeVisible(); return field;
}
export async function numericInput(c: NumericContext, field: Locator, fieldIndex: number) {
  const id = await field.getAttribute("id"); if (!id) throw new Error("Numeric input needs its real labelled DOM id.");
  const dom = JSON.parse(await c.ui.browser.evaluate((fieldId) => {
    const node = document.getElementById(fieldId) as HTMLInputElement | null;
    const labels = [...(node?.labels ?? [])].map((label) => label.textContent ?? "");
    const errorIds = `${node?.getAttribute("aria-errormessage") ?? ""} ${node?.getAttribute("aria-describedby") ?? ""}`.trim().split(/\s+/).filter(Boolean);
    return JSON.stringify({ label: [node?.getAttribute("aria-label"), ...labels].filter(Boolean).join(" "),
      focused: document.activeElement === node, ariaInvalid: node?.getAttribute("aria-invalid") ?? null,
      linkedErrorText: errorIds.map((errorId) => document.getElementById(errorId)?.textContent ?? "").filter(Boolean).join(" ") });
  }, id)) as { label: string; focused: boolean; ariaInvalid: string | null; linkedErrorText: string };
  return { ...dom, ariaInvalid: dom.ariaInvalid === "true", ariaInvalidAttribute: dom.ariaInvalid, errorText: dom.linkedErrorText,
    fieldIndex, input: await field.inputValue(), saveEnabled: await numericSave(c).isEnabled(),
    insertEnabled: await c.ui.screen.getByTestId("generated-ouvrage-insert-button").isEnabled(),
    sectionText: await componentSection(c.ui, c.p.s).textContent() ?? "" };
}
export async function numericBaseline(c: NumericContext, field: Locator, fieldIndex: number) {
  const state = await c.p.capture(`numeric-${c.caseId}-baseline`);
  await numericWitness(c, "baseline", c.oracle, { state, ...await numericInput(c, field, fieldIndex) });
  expect(amounts(state.estimate.version)).toEqual([0, 0, 0]); expect(state.objects.components).toHaveLength(4);
  expect(state.objects.components.map((row) => row.id).sort()).toEqual(c.p.s.components.map((component) => component.componentId).sort());
  expect(state.objects.components.every((row) => row.status === "suggested")).toBe(true);
  for (const table of ["applications", "snapshots", "assemblies", "libraryComponents"]) expect(state.objects[table]).toHaveLength(0);
}
export async function typeNumeric(c: NumericContext, field: Locator, fieldIndex: number, tag: string, prefix: string, tail?: string) {
  await field.focus(); await field.press("Control+A"); await field.press("Backspace");
  await numericWitness(c, `typed-${tag}-clear`, { input: "", fieldIndex },
    { ...await numericInput(c, field, fieldIndex), method: "pressSequentially", submitted: "" });
  await field.pressSequentially(prefix);
  const firstPhase = tail === undefined ? "completed" : "prefix";
  const first = await numericInput(c, field, fieldIndex);
  await numericWitness(c, `typed-${tag}-${firstPhase}`, { input: prefix, focused: true, fieldIndex },
    { ...first, method: "pressSequentially", submitted: prefix });
  await expect(field).toHaveValue(prefix); expect(first.focused).toBe(true);
  if (tail !== undefined) {
    await field.pressSequentially(tail);
    const complete = await numericInput(c, field, fieldIndex);
    await numericWitness(c, `typed-${tag}-completed`, { input: prefix + tail, focused: true, fieldIndex },
      { ...complete, method: "pressSequentially", submitted: prefix + tail });
    await expect(field).toHaveValue(prefix + tail); expect(complete.focused).toBe(true);
  }
  await field.press("Tab");
  const blur = await numericInput(c, field, fieldIndex);
  await numericWitness(c, `typed-${tag}-blur`, { submitted: prefix + (tail ?? ""), fieldIndex },
    { ...blur, method: "pressSequentially", submitted: prefix + (tail ?? "") });
  return blur;
}
export async function retainNumeric(c: NumericContext) {
  for (let index = 0; index < 4; index++) if (!c.oracle.retainedIndices.includes(index)) await componentDecision(c.ui, c.p, index, "Écarter");
}
export async function numericParent(c: NumericContext, value: string) {
  const card = c.ui.screen.getByTestId(`candidate-card-${c.p.s.candidateId}`);
  await card.getByRole("button", "Modifier", { exact: true }).click();
  await card.getByTestId("edit-quantity").fill(value); await card.getByRole("button", "Valider la ligne", { exact: true }).click();
  await expect(componentSection(c.ui, c.p.s)).toBeVisible(); await expect(card).toContainText(`Quantité : ${value}`);
}
export function assertNumericDraft(c: NumericContext, state: State, expectedStatus: "reviewed" | "applied") {
  expect(state.objects.components).toHaveLength(4);
  expect(state.objects.components.map((row) => row.id).sort()).toEqual(c.p.s.components.map((component) => component.componentId).sort());
  expect(state.objects.subdetails[0].status).toBe(expectedStatus);
  for (const [index, seeded] of c.p.s.components.entries()) {
    const row = state.objects.components.find((component) => component.id === seeded.componentId)!;
    const selected = c.oracle.components.find((component) => component.index === index);
    expect(row).toEqual(expect.objectContaining({ designation: seeded.designation, cost_type: selected?.costType ?? seeded.costType,
      quantity: selected?.quantity ?? seeded.quantity, unit: selected?.unit ?? seeded.unit, unit_cost_ht_cents: selected?.unitCostHtCents ?? seeded.unitCostHtCents,
      loss_coeff_bp: selected?.lossCoeffBp ?? 0, yield_value: selected?.yieldValue ?? null, yield_unit: selected?.yieldUnit ?? null,
      status: selected ? "manual" : "rejected", source_fragment_id: seeded.fragmentId, facts: [seeded.designation], hypotheses: [], inferences: [] }));
    if (!selected) expect((row.metadata as Json).rejected_from_status).toBe("suggested");
    const sources = state.objects.componentSources.filter((source) => source.component_id === seeded.componentId);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toEqual(expect.objectContaining({ source_fragment_id: seeded.fragmentId, source_rank: 0, evidence_kind: "fact", note: seeded.designation }));
  }
}
export function assertNumericApplied(c: NumericContext, state: State) {
  assertNumericDraft(c, state, "applied"); expect(amounts(state.estimate.version)).toEqual(c.oracle.totals);
  for (const table of ["applications", "snapshots", "assemblies"]) expect(state.objects[table]).toHaveLength(1);
  expect(state.objects.libraryComponents).toHaveLength(c.oracle.components.length);
  const lines = state.estimate.items.filter((row) => row.item_type === "line"); expect(lines).toHaveLength(1);
  const line = lines[0];
  expect([line.quantity, line.pu_ht_cents, line.h_mo, line.line_total_ht_cents, line.line_tax_cents, line.line_total_ttc_cents])
    .toEqual([c.oracle.parent.quantity, c.oracle.parent.effectiveUnitPriceHtCents, c.oracle.parent.totalHours, ...c.oracle.totals]);
  const fo = Math.round(Number(line.quantity) * Number(line.unit_price_ht_cents) * Number(line.k_fo ?? 1));
  const mo = Math.round(Number(line.h_mo ?? 0) * 4000 * Number(line.k_mo ?? 1));
  expect([fo, mo]).toEqual([c.oracle.parent.dsCents, 0]);
  const snapshot = state.objects.snapshots[0], components = snapshot.components as Json[], summary = snapshot.summary as Json;
  expect(components.map((component) => component.componentId)).toEqual(c.oracle.retainedIndices.map((index) => c.p.s.components[index].componentId));
  expect([summary.componentCount, summary.dsCents, summary.indicativeTargetPriceCents]).toEqual([c.oracle.components.length, c.oracle.parent.dsCents, c.oracle.parent.dsCents]);
  expect(snapshot.assembly_id).toBe(state.objects.assemblies[0].id);
  for (const [position, expected] of c.oracle.components.entries()) {
    const seed = c.p.s.components[expected.index], component = components[position], library = state.objects.libraryComponents[position];
    expect([component.componentId, component.costType, component.quantity, component.unit, component.unitCostHtCents, component.lossCoeffBp,
      component.yieldValue, component.yieldUnit, component.dsCents]).toEqual([seed.componentId, expected.costType, expected.quantity, expected.unit,
      expected.unitCostHtCents, expected.lossCoeffBp, expected.yieldValue, expected.yieldUnit, expected.dsCents]);
    expect((component.sources as Json[]).map((source) => source.sourceFragmentId)).toEqual([seed.fragmentId]);
    const metadata = library.source_metadata as Json;
    expect([library.title, library.cost_type, library.default_quantity, library.unit, library.unit_cost_ht_cents, library.h_mo, metadata.component_id])
      .toEqual([seed.designation, expected.costType, expected.quantity, expected.unit, expected.unitCostHtCents, expected.derivedHours, seed.componentId]);
    expect(metadata.sources).toEqual(component.sources);
    expect(library.k_fo).toBe(expected.costType === "labor" ? 0 : 1 + expected.lossCoeffBp / 10000);
    if (expected.costType === "labor") expect([library.labor_role_id, library.k_mo]).toEqual([c.p.fixture.owner.laborRoleId, 0]);
  }
  expect(line.source_metadata).toEqual(expect.objectContaining({ kind: "generated_ouvrage", draft_id: c.p.s.draftId, candidate_id: c.p.s.candidateId,
    application_id: state.objects.applications[0].id, snapshot_id: snapshot.id, assembly_id: state.objects.assemblies[0].id }));
}
export async function persistNumeric(c: NumericContext) {
  const review = await saveComponents(c.ui, c.p), reviewed = await c.p.capture(`numeric-${c.caseId}-reviewed`);
  await numericWitness(c, "reviewed", c.oracle, { state: reviewed, reply: review });
  expect(review.status).toBe(200); expect(review.records).toHaveLength(1); expect(review.records[0].status).toBe("reviewed");
  expect(review.records[0].summary).toEqual(expect.objectContaining({ componentCount: c.oracle.components.length, dsCents: c.oracle.parent.dsCents }));
  assertNumericDraft(c, reviewed, "reviewed"); expect(amounts(reviewed.estimate.version)).toEqual([0, 0, 0]);
  const origin = await c.ui.browser.evaluate(() => performance.timeOrigin);
  await c.ui.browser.reload({ timeout: 15000 }); expect(await c.ui.browser.evaluate(() => performance.timeOrigin) > origin).toBe(true);
  await expect(c.ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible(); await openComponents(c.ui, c.p);
  const reloaded = await c.p.capture(`numeric-${c.caseId}-reloaded`);
  await numericWitness(c, "reloaded", c.oracle, { state: reloaded }); assertNumericDraft(c, reloaded, "reviewed");
  expect(reloaded.objects).toEqual(reviewed.objects); expect(amounts(reloaded.estimate.version)).toEqual([0, 0, 0]);
  const parent = c.ui.screen.getByTestId(`candidate-card-${c.p.s.candidateId}`);
  const parentText = await parent.textContent() ?? "";
  await numericWitness(c, "reloaded-parent", c.oracle, { text: parentText, reviewedCandidate: (reloaded.objects.subdetails[0].generation_metadata as Json).reviewed_candidate });
  await expect(parent).toContainText(`Quantité : ${c.oracle.parent.quantity}`);
  const application = await applyComponents(c.ui, c.p), applied = await c.p.capture(`numeric-${c.caseId}-applied`);
  await numericWitness(c, "applied", c.oracle, { state: applied, reply: application });
  expect(application.status).toBe(200); expect(application.records).toHaveLength(1); expect(application.records[0].ok).toBe(true);
  expect(application.changedRecords).toBe(0); expect(application.discarded).toBe(false); assertNumericApplied(c, applied);
  await c.ui.browser.reload({ timeout: 15000 }); await expect(c.ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  const appliedReload = await c.p.capture(`numeric-${c.caseId}-applied-reload`);
  await numericWitness(c, "applied-reload", c.oracle, { state: appliedReload }); assertNumericApplied(c, appliedReload);
  expect(appliedReload.objects).toEqual(applied.objects);
  await numericExports(c, c.p.s.versionId, "primary");
}
function assertNumericProvenance(lines: Json[], library: Json[], assemblyId: unknown) {
  expect(lines).toHaveLength(library.length); const seen = new Set<unknown>();
  for (const line of lines) {
    expect(line.source_provider).toBe("assembly_library");
    const origin = (line.source_metadata as Json)?.library_origin as Json | undefined;
    const item = library.find((row) => row.id === origin?.assembly_item_id); expect(item).toBeDefined();
    expect(item!.assembly_id).toBe(assemblyId); expect(seen.has(item!.id)).toBe(false); seen.add(item!.id);
    expect(line.source_metadata).toEqual({ kind: "assembly_library", library_origin: { assembly_id: assemblyId, assembly_item_id: item!.id, source_metadata: item!.source_metadata } });
    expect([line.title, line.description, line.quantity, line.unit_price_ht_cents, line.h_mo, line.k_fo, line.k_mo, line.labor_role_id])
      .toEqual([item!.title, item!.unit, item!.default_quantity, item!.cost_type === "labor" ? 0 : item!.unit_cost_ht_cents, item!.h_mo, item!.k_fo, item!.k_mo, item!.labor_role_id]);
  }
}
export async function reuseNumeric(c: NumericContext, versionId: string, projectId: string) {
  const { ui, p } = c; ownEstimate(ui.army, { projectId, versionId });
  await ui.app.open(`/dashboard/estimates/${versionId}/edit`); await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  expect(amounts((await readEstimate(ui.browser, versionId)).version)).toEqual([0, 0, 0]);
  const objects = await p.objects(); expect(objects.assemblies).toHaveLength(1); expect(objects.snapshots[0].assembly_id).toBe(objects.assemblies[0].id);
  const assembly = objects.assemblies[0], name = assembly.name; expect(typeof name).toBe("string");
  const opener = ui.screen.getByTestId("estimate-editor-assemblies-button");
  if (!await opener.isVisible()) { const tab = ui.screen.getByRole("tab", "Insérer", { exact: true }); if (await tab.isVisible()) await tab.click(); await ui.screen.getByRole("button", "Insérer", { exact: true }).click(); }
  await opener.click(); const dialog = ui.screen.getByRole("dialog", "Ajouter un ouvrage", { exact: true }); await expect(dialog).toBeVisible();
  await dialog.getByLabel("Rechercher", { exact: true }).fill(name as string); await dialog.getByRole("button", name as string, { exact: false }).click();
  await expect(dialog.getByRole("region", "Composants de l’ouvrage", { exact: true }).getByRole("row")).toHaveCount(c.oracle.components.length + 1);
  const cta = dialog.getByRole("button", `Ajouter « ${name} »`, { exact: false }); await expect(cta).toBeEnabled();
  const preview = await dialog.textContent() ?? "";
  await numericWitness(c, "reuse-preview", c.oracle, { assemblyId: assembly.id, libraryName: name, snapshotAssemblyId: objects.snapshots[0].assembly_id,
    preview, expectedCta: `Ajouter « ${name} »`, actualCta: await cta.textContent() });
  for (const component of p.s.components.filter((_, index) => !c.oracle.retainedIndices.includes(index))) expect(preview.includes(component.designation)).toBe(false);
  const url = new URL(`/api/estimates/assemblies/${assembly.id}/insert`, ui.app.baseUrl!); url.searchParams.set("versionId", versionId);
  const [response] = await Promise.all([ui.browser.waitForResponse(url.href, { timeout: 60000 }), cta.click()]);
  const reply = await response.json<{ ok: boolean; data: { items: Json[] } }>();
  const reused = { estimate: await readEstimate(ui.browser, versionId), objects: await p.objects(), calls: [...p.calls] }, ordinaryRows = await p.versionRows(versionId);
  await numericWitness(c, "reuse", c.oracle, { state: reused, ordinaryRows, status: response.status, reply, versionId, assemblyId: assembly.id });
  expect(response.status).toBe(200); expect(reply.ok).toBe(true);
  assertNumericProvenance(reply.data.items.filter((row) => row.item_type === "line"), objects.libraryComponents, assembly.id);
  assertNumericReuse(c, reused, ordinaryRows, assembly.id);
  await expect(dialog).toHaveCount(0);
  const autosave = ui.screen.getByTestId("estimate-page-toolbar-autosave-status");
  await expect(autosave).toHaveText(/^(À jour|Sauvegardé)$/);
  const ready = await readEstimate(ui.browser, versionId);
  await numericWitness(c, "reuse-ready", c.oracle, { versionId, statusText: await autosave.textContent(), estimate: ready });
  expect(ready).toEqual(reused.estimate);
  const origin = await ui.browser.evaluate(() => performance.timeOrigin);
  await ui.browser.reload({ timeout: 15000 }); expect(await ui.browser.evaluate(() => performance.timeOrigin) > origin).toBe(true);
  await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  const reload = { estimate: await readEstimate(ui.browser, versionId), objects: await p.objects(), calls: [...p.calls] }, reloadedRows = await p.versionRows(versionId);
  await numericWitness(c, "reuse-reload", c.oracle, { state: reload, ordinaryRows: reloadedRows, versionId, assemblyId: assembly.id });
  assertNumericReuse(c, reload, reloadedRows, assembly.id); expect(reload.objects).toEqual(reused.objects);
  await numericProvenanceUi(c, versionId); await numericExports(c, versionId, "reuse");
}
function assertNumericReuse(c: NumericContext, state: State, ordinaryRows: Json[], assemblyId: unknown) {
  expect(amounts(state.estimate.version)).toEqual(c.oracle.totals);
  const lines = state.estimate.items.filter((row) => row.item_type === "line"), rows = ordinaryRows.filter((row) => row.item_type === "line");
  assertNumericProvenance(lines, state.objects.libraryComponents, assemblyId); assertNumericProvenance(rows, state.objects.libraryComponents, assemblyId);
  expect(rows.map((row) => row.id).sort()).toEqual(lines.map((row) => row.id).sort());
  expect(lines.reduce((hours, row) => hours + Number(row.h_mo ?? 0), 0)).toBe(c.oracle.parent.totalHours);
  expect(lines.reduce((cents, row) => cents + Number(row.line_total_ht_cents), 0)).toBe(c.oracle.parent.dsCents);
  for (const component of c.p.s.components.filter((_, index) => !c.oracle.retainedIndices.includes(index))) expect(lines.some((row) => row.title === component.designation)).toBe(false);
}
async function numericProvenanceUi(c: NumericContext, versionId: string) {
  const before = await readEstimate(c.ui.browser, versionId), ordinaryBefore = await c.p.versionRows(versionId), observations = [];
  for (const line of before.items.filter((row) => row.item_type === "line")) {
    const row = c.ui.browser.locator(`[data-estimate-item-id="${line.id}"]`);
    await row.getByTestId("estimate-line-more-trigger").click();
    const menu = c.ui.browser.locator(".estimate-line-more__menu"); await expect(menu).toHaveCount(1); await expect(menu).toBeVisible();
    const truth = c.ui.browser.locator(".estimate-line-more__menu .estimate-line-more__state .estimate-line-truth__badge");
    await expect(truth).toHaveCount(1); await expect(truth).toBeVisible();
    const truthLabel = JSON.parse(await c.ui.browser.evaluate(() => {
      const labels = document.querySelectorAll(".estimate-line-more__menu .estimate-line-more__state .estimate-line-truth__badge .sr-only"), label = labels[0];
      let hiddenAncestor = false;
      for (let node: Element | null = label ?? null; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden") || node.hasAttribute("inert") || style.display === "none" || style.visibility !== "visible") hiddenAncestor = true;
      }
      return JSON.stringify({ matches: labels.length, text: label?.textContent ?? null, hiddenAncestor });
    })) as { matches: number; text: string | null; hiddenAncestor: boolean };
    expect(truthLabel.matches).toBe(1); expect(truthLabel.hiddenAncestor).toBe(false);
    expect(truthLabel.text).toBe("Bibliothèque d'ouvrages — Qté à confirmer — Confiance non mesurée");
    const truthTitle = await truth.getAttribute("title");
    expect(truthTitle).toContain("La provenance d'origine ne mesure pas la confiance dans la quantité du devis actuel."); expect(truthTitle).not.toMatch(/\d+\s*%/);
    const badge = menu.getByRole("button", "Afficher la provenance de la bibliothèque", { exact: true }); await expect(badge).toBeVisible(); await expect(badge).toContainText(/bibliothèque/i); await badge.click();
    const tooltip = c.ui.screen.getByRole("tooltip").filter({ hasText: "Origine : bibliothèque d'ouvrages" });
    await expect(tooltip).toBeVisible(); await expect(tooltip).toContainText("La provenance d'origine est conservée. Vérifiez la quantité et les exigences du devis actuel.");
    const link = tooltip.getByRole("link", "Ouvrir la bibliothèque d'ouvrages", { exact: true }); await expect(link).toHaveAttribute("href", "/dashboard/estimates/assemblies");
    observations.push({ lineId: line.id, truthText: truthLabel.text, truthLabel, truthTitle, popoverText: await tooltip.textContent(), href: await link.getAttribute("href") });
    await c.ui.browser.keyboard.press("Escape"); await expect(tooltip).toHaveCount(0); await row.getByTestId("estimate-line-more-trigger").click(); await expect(menu).toHaveCount(0);
  }
  const after = await readEstimate(c.ui.browser, versionId), ordinaryAfter = await c.p.versionRows(versionId);
  await numericWitness(c, "reuse-provenance-ui", c.oracle, { before, after, ordinaryBefore, ordinaryAfter, observations, versionId });
  expect(after).toEqual(before); expect(ordinaryAfter).toEqual(ordinaryBefore);
}
async function files(directory: string): Promise<string[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
}
async function numericExports(c: NumericContext, versionId: string, target: "primary" | "reuse") {
  const api = await readEstimate(c.ui.browser, versionId), lines = api.items.filter((row) => row.item_type === "line"), root = sdkResultsRoot();
  expect(amounts(api.version)).toEqual(c.oracle.totals);
  for (const mode of ["standard", "dpgf"] as const) {
    const old = new Set(await files(root));
    if (mode === "standard") await c.ui.screen.getByRole("button", "Exporter", { exact: true }).click(); else await c.ui.screen.getByTestId("estimate-page-toolbar-more-actions-button").click();
    const download = await c.ui.browser.waitForDownload(() => mode === "standard" ? c.ui.screen.getByRole("button", "Excel (.xlsx)", { exact: true }).click()
      : c.ui.screen.getByTestId("estimate-page-toolbar-export-dpgf-button").click(), { timeout: 60000 });
    const returned = path.normalize(download.path); if (returned.split(path.sep).includes("..")) throw new Error("Numeric export escaped artifacts.");
    const found = (await files(root)).filter((file) => !old.has(file) && (path.isAbsolute(returned) ? file === returned : file.endsWith(path.sep + returned))); expect(found).toHaveLength(1);
    const bytes = await readFile(found[0]), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheets: Record<string, Array<Array<string | number | null>>> = {};
    for (const sheet of workbook.worksheets) { sheets[sheet.name] = []; sheet.eachRow((row) => sheets[sheet.name].push(Array.from({ length: sheet.columnCount }, (_, index) =>
      typeof row.getCell(index + 1).value === "number" ? row.getCell(index + 1).value as number : row.getCell(index + 1).text || null))); }
    await numericWitness(c, `exports-${target}-${mode}`, c.oracle, { versionId, mode, path: found[0], sha256: createHash("sha256").update(bytes).digest("hex"), sheets, api });
    for (const component of c.p.s.components.filter((_, index) => !c.oracle.retainedIndices.includes(index))) expect(JSON.stringify(sheets).includes(component.designation)).toBe(false);
    if (mode === "standard") {
      for (const line of lines) {
        const rows = sheets.Devis.filter((row) => String(row[1]).trim() === line.title); expect(rows).toHaveLength(1);
        expect(rows[0].slice(2, 8)).toEqual([line.description, line.quantity, Number(line.pu_ht_cents) / 100, Number(line.line_total_ht_cents) / 100,
          Number(line.line_tax_cents) / 100, Number(line.line_total_ttc_cents) / 100]);
      }
      for (const [index, label] of ["Total HT", "Total TVA", "Total TTC"].entries()) expect(sheets.Resume.filter((row) => row[0] === label).map((row) => row[1])).toEqual([c.oracle.totals[index] / 100]);
    } else {
      for (const line of lines) {
        const rows = sheets.Données.filter((row) => row[1] === line.id); expect(rows).toHaveLength(1);
        expect([rows[0][3], rows[0][4], rows[0][5], rows[0][7], rows[0][8], rows[0][9], rows[0][10]])
          .toEqual([line.quantity, line.description, Number(line.unit_price_ht_cents) / 100, line.k_fo ?? 1, line.h_mo ?? 0, line.k_mo ?? 1, line.h_mo_majoration ?? 1]);
      }
    }
  }
}
