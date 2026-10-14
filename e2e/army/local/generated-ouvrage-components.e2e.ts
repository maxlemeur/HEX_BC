import { expect } from "e2e";
import { armyTest, createEstimateViaWizard, ownEstimate, readEstimate, recordEvidence } from "../critical/fixtures";
import { actualComponentAction, amounts, applyComponents, componentArticle, componentDecision, componentExports, componentSection,
  openComponents, prepareComponents, saveComponents, type PreparedComponents, type Ui } from "./generated-ouvrage-components-support";
import type { Json } from "./generated-ouvrage-recovery-support";

// Before implementation: docs/testing/generated-ouvrage-components-e2e.md.
const selection = process.env.E2E_GENERATED_COMPONENTS_SELECTION;
if (!["entry", "full"].includes(selection ?? "")) throw new Error("Explicit entry/full component selection required; no default.");
const options = { session: "army", trace: "off" as const, tags: ["source-coverage", "generated-components"], timeout: 420_000 };
const reviewed = (reply: Awaited<ReturnType<typeof saveComponents>>) => { expect(reply.status).toBe(200); expect(reply.records).toHaveLength(1); expect(reply.records[0].status).toBe("reviewed"); };

async function reopen(ui: Ui, p: PreparedComponents) {
  const origin = await ui.browser.evaluate(() => performance.timeOrigin);
  await ui.browser.reload({ timeout: 15_000 }); expect(await ui.browser.evaluate(() => performance.timeOrigin) > origin).toBe(true);
  await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible(); await openComponents(ui, p);
}
async function localSubdetail(ui: Ui, p: PreparedComponents) {
  // Scope public SDK evaluation to this sub-detail, without account/session fields.
  return JSON.parse(await ui.browser.evaluate((candidateId) => {
    const section = document.querySelector(`[data-testid="candidate-card-${candidateId}"] section`);
    return JSON.stringify({ text: section?.textContent ?? "", articles: [...(section?.querySelectorAll("article") ?? [])].map((article) => ({
      text: article.textContent ?? "", fields: [...article.querySelectorAll("input:not([type=password]),textarea,select")].map((node) => ({
        label: node.closest("div")?.querySelector("label")?.textContent ?? "", value: (node as HTMLInputElement).value,
      })), buttons: [...article.querySelectorAll("button")].map((button) => ({ name: button.textContent ?? "", disabled: button.disabled })),
    })) });
  }, p.s.candidateId)) as Json;
}
async function linkedFieldError(ui: Ui, fieldId: string | null) {
  if (!fieldId) throw new Error("Expected the real numeric field id.");
  return JSON.parse(await ui.browser.evaluate((id) => {
    const field = document.getElementById(id);
    const ids = [field?.getAttribute("aria-errormessage"), field?.getAttribute("aria-describedby")].filter(Boolean).join(" ").trim().split(/\s+/).filter(Boolean);
    const texts = ids.map((errorId) => document.getElementById(errorId)?.textContent ?? "").filter((text) => text.trim());
    return JSON.stringify({ matchedReferences: texts.length, errorText: texts.join(" ") });
  }, fieldId)) as { matchedReferences: number; errorText: string };
}
async function pageErrors(ui: Ui) {
  return JSON.parse(await ui.browser.evaluate(() => JSON.stringify([...document.querySelectorAll("h1,h2")].map((node) => node.textContent ?? "")
    .filter((text) => /application error|client.side exception|erreur inattendue/i.test(text))))) as string[];
}
async function editParentQuantity(ui: Ui, p: PreparedComponents, value: string) {
  const card = ui.screen.getByTestId(`candidate-card-${p.s.candidateId}`);
  await card.getByRole("button", "Modifier", { exact: true }).click();
  await card.getByTestId("edit-quantity").fill(value); await card.getByRole("button", "Valider la ligne", { exact: true }).click();
  await expect(componentSection(ui, p.s)).toBeVisible(); await expect(card).toContainText(`Quantité : ${value}`);
}
function assertLibraryProvenance(lines: Json[], assemblyId: unknown, library: Json[]) {
  expect(lines).toHaveLength(library.length); expect(new Set(lines.map((line) => line.id)).size).toBe(lines.length);
  const seen = new Set<unknown>();
  for (const line of lines) {
    expect(line.source_provider).toBe("assembly_library");
    const origin = (line.source_metadata as Json)?.library_origin as Json | undefined;
    expect(origin).toBeDefined(); const item = library.find((row) => row.id === origin?.assembly_item_id); expect(item).toBeDefined();
    expect(item!.assembly_id).toBe(assemblyId); expect(seen.has(item!.id)).toBe(false); seen.add(item!.id);
    expect(line.source_metadata).toEqual({ kind: "assembly_library", library_origin: { assembly_id: assemblyId, assembly_item_id: item!.id, source_metadata: item!.source_metadata } });
    expect([line.title, line.description, line.quantity, line.unit_price_ht_cents, line.h_mo, line.k_fo, line.k_mo, line.labor_role_id])
      .toEqual([item!.title, item!.unit, item!.default_quantity, item!.cost_type === "labor" ? 0 : item!.unit_cost_ht_cents, item!.h_mo, item!.k_fo, item!.k_mo, item!.labor_role_id]);
  }
}
async function inspectLibraryProvenanceUi(ui: Ui, p: PreparedComponents, versionId: string) {
  const before = await readEstimate(ui.browser, versionId), ordinaryBefore = await p.versionRows(versionId), observations = [];
  for (const line of before.items.filter((item) => item.item_type === "line")) {
    const row = ui.browser.locator(`[data-estimate-item-id="${line.id}"]`);
    await row.getByTestId("estimate-line-more-trigger").click();
    const menu = ui.browser.locator(".estimate-line-more__menu"); await expect(menu).toHaveCount(1); await expect(menu).toBeVisible();
    const truth = ui.browser.locator(".estimate-line-more__menu .estimate-line-more__state .estimate-line-truth__badge");
    await expect(truth).toHaveCount(1); await expect(truth).toBeVisible();
    const truthLabel = JSON.parse(await ui.browser.evaluate(() => {
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
    const badge = menu.getByRole("button", "Afficher la provenance de la bibliothèque", { exact: true });
    await expect(badge).toBeVisible(); await expect(badge).toContainText(/bibliothèque/i); await badge.click();
    const tooltip = ui.screen.getByRole("tooltip").filter({ hasText: "Origine : bibliothèque d'ouvrages" });
    await expect(tooltip).toBeVisible(); await expect(tooltip).toContainText("La provenance d'origine est conservée. Vérifiez la quantité et les exigences du devis actuel.");
    const link = tooltip.getByRole("link", "Ouvrir la bibliothèque d'ouvrages", { exact: true }); await expect(link).toHaveAttribute("href", "/dashboard/estimates/assemblies");
    const popoverText = await tooltip.textContent() ?? "";
    observations.push({ lineId: line.id, truthText: truthLabel.text, truthLabel, truthTitle, badgeText: await badge.textContent(), popoverText, libraryHref: await link.getAttribute("href") });
    await recordEvidence(ui.army, `${p.s.label}-reuse-provenance-ui-${line.id}`, observations[observations.length - 1]);
    expect(popoverText).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i); expect(popoverText).not.toMatch(/Origine\s*:\s*IA|snapshot|application IA/i);
    await ui.browser.keyboard.press("Escape"); await expect(tooltip).toHaveCount(0); await row.getByTestId("estimate-line-more-trigger").click(); await expect(menu).toHaveCount(0);
  }
  const after = await readEstimate(ui.browser, versionId), ordinaryAfter = await p.versionRows(versionId);
  await recordEvidence(ui.army, `${p.s.label}-reuse-provenance-ui-readonly`, { before, after, ordinaryBefore, ordinaryAfter, observations });
  expect(after).toEqual(before); expect(ordinaryAfter).toEqual(ordinaryBefore);
}
function assertComposition(state: Awaited<ReturnType<PreparedComponents["capture"]>>, p: PreparedComponents, expected: number[], cost: number) {
  const indices = p.s.label === "GC02" ? [1, 2] : [0, 1], retained = indices.map((i) => ({ ...p.s.components[i], unitCostHtCents: p.s.label === "GC02" && i === 1 ? 0 : p.s.components[i].unitCostHtCents }));
  expect(amounts(state.estimate.version)).toEqual(expected);
  expect(state.objects.components).toHaveLength(4);
  expect(state.objects.components.filter((r) => r.status === "rejected").map((r) => r.id).sort()).toEqual(p.s.components.filter((_, i) => !indices.includes(i)).map((c) => c.componentId).sort());
  for (const table of ["applications", "snapshots", "assemblies"]) expect(state.objects[table]).toHaveLength(1);
  expect(state.objects.libraryComponents).toHaveLength(2);
  const lines = state.estimate.items.filter((r) => r.item_type === "line"); expect(lines).toHaveLength(1);
  expect([lines[0].quantity, lines[0].unit_price_ht_cents, lines[0].pu_ht_cents, lines[0].h_mo, lines[0].line_total_ht_cents, lines[0].line_tax_cents, lines[0].line_total_ttc_cents]).toEqual([1, cost, cost, 1, ...expected]);
  const snapshot = state.objects.snapshots[0], components = snapshot.components as Json[], summary = snapshot.summary as Json;
  expect(components.map((c) => c.componentId)).toEqual(retained.map((c) => c.componentId));
  expect(components.map((c) => c.status)).not.toContain("rejected");
  expect([summary.componentCount, summary.dsCents, summary.indicativeTargetPriceCents]).toEqual([2, cost, cost]);
  expect(state.objects.libraryComponents.map((c) => c.title)).toEqual(retained.map((c) => c.designation));
  for (const [index, c] of retained.entries()) {
    const snapshotComponent = components[index], library = state.objects.libraryComponents[index];
    expect([snapshotComponent.costType, snapshotComponent.quantity, snapshotComponent.unit, snapshotComponent.unitCostHtCents, snapshotComponent.dsCents]).toEqual([c.costType, c.quantity, c.unit, c.unitCostHtCents, c.quantity * c.unitCostHtCents]);
    expect((snapshotComponent.sources as Json[]).map((s) => s.sourceFragmentId)).toEqual([c.fragmentId]);
    expect([library.cost_type, library.unit_cost_ht_cents, (library.source_metadata as Json).component_id]).toEqual([c.costType, c.unitCostHtCents, c.componentId]);
    expect(((library.source_metadata as Json).sources as Json[]).map((s) => s.sourceFragmentId)).toEqual([c.fragmentId]);
  }
  const labor = state.objects.libraryComponents.find((c) => c.cost_type === "labor")!;
  expect([labor.unit_cost_ht_cents, labor.h_mo, labor.labor_role_id]).toEqual([p.s.label === "GC02" ? 0 : 4000, 1, p.fixture.owner.laborRoleId]);
  expect(lines[0].source_metadata).toEqual(expect.objectContaining({ kind: "generated_ouvrage", draft_id: p.s.draftId, candidate_id: p.s.candidateId,
    application_id: state.objects.applications[0].id, snapshot_id: snapshot.id, assembly_id: state.objects.assemblies[0].id }));
  expect((lines[0].source_metadata as Json).subdetail_summary).toEqual(expect.objectContaining({ componentCount: 2, dsCents: cost }));
}
async function reuse(ui: Ui, p: PreparedComponents, versionId: string, projectId: string, expected: number[]) {
  const indices = p.s.label === "GC02" ? [1, 2] : [0, 1], retained = indices.map((i) => p.s.components[i]);
  ownEstimate(ui.army, { versionId, projectId });
  await ui.app.open(`/dashboard/estimates/${versionId}/edit`); await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  const before = await readEstimate(ui.browser, versionId); await recordEvidence(ui.army, `${p.s.label}-reuse-initial`, before); expect(amounts(before.version)).toEqual([0, 0, 0]);
  const objects = await p.objects(); expect(objects.assemblies).toHaveLength(1); expect(objects.snapshots).toHaveLength(1);
  const assembly = objects.assemblies[0]; expect(typeof assembly.name).toBe("string"); expect(objects.snapshots[0].assembly_id).toBe(assembly.id);
  const libraryName = assembly.name as string; expect(libraryName.trim().length > 0).toBe(true);
  const opener = ui.screen.getByTestId("estimate-editor-assemblies-button");
  if (!await opener.isVisible()) { const tab = ui.screen.getByRole("tab", "Insérer", { exact: true }); if (await tab.isVisible()) await tab.click(); await ui.screen.getByRole("button", "Insérer", { exact: true }).click(); }
  await opener.click(); const dialog = ui.screen.getByRole("dialog", "Ajouter un ouvrage", { exact: true }); await expect(dialog).toBeVisible();
  await dialog.getByLabel("Rechercher", { exact: true }).fill(libraryName);
  await dialog.getByRole("button", libraryName, { exact: false }).click();
  await expect(dialog.getByRole("region", "Composants de l’ouvrage", { exact: true }).getByRole("row")).toHaveCount(3);
  const expectedCta = `Ajouter « ${libraryName} »`, cta = dialog.getByRole("button", expectedCta, { exact: false });
  await expect(cta).toBeEnabled();
  const preview = await dialog.textContent() ?? ""; await recordEvidence(ui.army, `${p.s.label}-reuse-library-preview`, {
    preview, assemblyId: assembly.id, libraryName, snapshotAssemblyId: objects.snapshots[0].assembly_id, expectedCta, actualCta: await cta.textContent(),
  });
  for (const c of p.s.components.filter((_, i) => !indices.includes(i))) expect(preview.includes(c.designation)).toBe(false);
  const insertUrl = new URL(`/api/estimates/assemblies/${assembly.id}/insert`, ui.app.baseUrl!); insertUrl.searchParams.set("versionId", versionId);
  const [response] = await Promise.all([ui.browser.waitForResponse(insertUrl.href, { timeout: 60_000 }), cta.click()]);
  const insertResponse = await response.json<{ ok: boolean; data: { items: Json[] } }>();
  const immediate = await readEstimate(ui.browser, versionId);
  await recordEvidence(ui.army, `${p.s.label}-reuse-provenance-insert`, { assemblyId: assembly.id, libraryItems: objects.libraryComponents, status: response.status, insertResponse, immediate });
  expect(response.status).toBe(200); expect(insertResponse.ok).toBe(true);
  assertLibraryProvenance(insertResponse.data.items.filter((row) => row.item_type === "line"), assembly.id, objects.libraryComponents);
  assertLibraryProvenance(immediate.items.filter((row) => row.item_type === "line"), assembly.id, objects.libraryComponents);
  expect(amounts(immediate.version)).toEqual(expected);
  await expect(dialog).toHaveCount(0);
  const autosave = ui.screen.getByTestId("estimate-page-toolbar-autosave-status");
  await expect(autosave).toHaveText(/^(À jour|Sauvegardé)$/);
  const ready = await readEstimate(ui.browser, versionId);
  await recordEvidence(ui.army, `${p.s.label}-reuse-ready`, { assemblyId: assembly.id, statusText: await autosave.textContent(), ready });
  expect(ready).toEqual(immediate);
  await ui.browser.reload({ timeout: 15_000 }); await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  const after = await readEstimate(ui.browser, versionId); await recordEvidence(ui.army, `${p.s.label}-reuse-final`, { before, after, expected });
  const ordinaryRows = await p.versionRows(versionId);
  await recordEvidence(ui.army, `${p.s.label}-reuse-provenance-reload`, { assemblyId: assembly.id, libraryItems: objects.libraryComponents, after, ordinaryRows });
  assertLibraryProvenance(after.items.filter((row) => row.item_type === "line"), assembly.id, objects.libraryComponents);
  assertLibraryProvenance(ordinaryRows.filter((row) => row.item_type === "line"), assembly.id, objects.libraryComponents);
  expect(ordinaryRows.filter((row) => row.item_type === "line").map((row) => row.id).sort()).toEqual(after.items.filter((row) => row.item_type === "line").map((row) => row.id).sort());
  expect(amounts(after.version)).toEqual(expected); const lines = after.items.filter((r) => r.item_type === "line"); expect(lines).toHaveLength(2);
  expect(lines.map((r) => r.title)).toEqual(retained.map((c) => c.designation));
  expect(lines.reduce((hours, r) => hours + Number(r.h_mo ?? 0), 0)).toBe(1);
  for (const c of p.s.components.filter((_, i) => !indices.includes(i))) expect(lines.some((r) => r.title === c.designation)).toBe(false);
  await inspectLibraryProvenanceUi(ui, p, versionId);
  await componentExports(ui, p, expected, { versionId, label: "exports-reuse", retainedIndices: indices });
}

armyTest("GC01 excluded components survive restoration reload application exports and library reuse", options, async (ui) => {
  const p = await prepareComponents(ui, "GC01");
  try {
    await openComponents(ui, p); await expect(componentSection(ui, p.s)).toContainText(/DS\s*240[,.]00/);
    // On the current product this exact visible action is absent. Observation is
    // saved inside componentDecision BEFORE the expectation, never a seeded rejection.
    await componentDecision(ui, p, 2, "Écarter"); await componentDecision(ui, p, 3, "Écarter");
    await expect(componentSection(ui, p.s)).toContainText(/DS\s*80[,.]00/); reviewed(await saveComponents(ui, p));
    await reopen(ui, p); const excluded = await p.capture("excluded-reload");
    expect(excluded.objects.components.filter((r) => r.status === "rejected").map((r) => [r.id, (r.metadata as Json).rejected_from_status]).sort()).toEqual(p.s.components.slice(2).map((c) => [c.componentId, "suggested"]).sort());
    const card = ui.screen.getByTestId(`candidate-card-${p.s.candidateId}`), checkbox = card.getByRole("checkbox", `Sélectionner ${p.s.designation}`, { exact: true });
    if (!await checkbox.isChecked()) await checkbox.check();
    await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeEnabled();
    const reviewRequest = { versionId: p.s.versionId, draftId: p.s.draftId, candidateId: p.s.candidateId };
    const reviewBefore = await actualComponentAction(ui, p, "fetchGeneratedOuvrageSubdetailDraft", reviewRequest);
    const mergeBefore = await p.capture("incompatible-merge-before"), postsBefore = p.calls.filter((c) => c.name === "updateGeneratedOuvrageSubdetailDraft").length;
    const laborArticle = componentArticle(ui, p.s, 1), laborToggle = laborArticle.getByRole("button", p.s.components[1].designation, { exact: false });
    if (await laborToggle.getAttribute("aria-expanded") !== "true") await laborToggle.click();
    await laborArticle.getByRole("button", "Fusionner", { exact: true }).click();
    const mergeAfter = await p.capture("incompatible-merge-after"), reviewAfter = await actualComponentAction(ui, p, "fetchGeneratedOuvrageSubdetailDraft", reviewRequest);
    await recordEvidence(ui.army, "GC01-incompatible-merge-observed", { mergeBefore, mergeAfter, reviewBefore, reviewAfter, postsBefore,
      postsAfter: p.calls.filter((c) => c.name === "updateGeneratedOuvrageSubdetailDraft").length,
      insertionEnabled: await ui.screen.getByTestId("generated-ouvrage-insert-button").isEnabled(), summary: await componentSection(ui, p.s).textContent() });
    expect(mergeAfter.estimate).toEqual(mergeBefore.estimate); expect(mergeAfter.objects).toEqual(mergeBefore.objects);
    expect(reviewBefore.records).toHaveLength(1); expect(reviewAfter.records).toHaveLength(1);
    expect(reviewBefore.records[0].status).toBe("reviewed"); expect(reviewBefore.records[0].reviewToken).toMatch(/^[0-9a-f]{64}$/);
    expect(reviewAfter.records[0].reviewToken).toBe(reviewBefore.records[0].reviewToken); expect(reviewAfter.records[0].status).toBe("reviewed");
    expect(p.calls.filter((c) => c.name === "updateGeneratedOuvrageSubdetailDraft").length).toBe(postsBefore);
    await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeEnabled();
    await expect(componentSection(ui, p.s)).toContainText(/DS\s*80[,.]00/);
    const materialArticle = componentArticle(ui, p.s, 0), materialToggle = materialArticle.getByRole("button", p.s.components[0].designation, { exact: false });
    if (await materialToggle.getAttribute("aria-expanded") !== "true") await materialToggle.click();
    const quantity = materialArticle.getByLabel("Quantité", { exact: true });
    const precisionBefore = await p.capture("normalized-quantity-before"), precisionReviewBefore = await actualComponentAction(ui, p, "fetchGeneratedOuvrageSubdetailDraft", reviewRequest);
    const precisionPostsBefore = p.calls.filter((c) => c.name === "updateGeneratedOuvrageSubdetailDraft").length;
    for (const step of [
      { input: "1.0004", tag: "same", componentDs: /DS\s*40[,.]00/, totalDs: /DS\s*80[,.]00/, badge: "Suggéré" },
      { input: "1.0005", tag: "half-up", componentDs: /DS\s*40[,.]04/, totalDs: /DS\s*80[,.]04/, badge: "Saisi manuellement" },
      { input: "1", tag: "restored", componentDs: /DS\s*40[,.]00/, totalDs: /DS\s*80[,.]00/, badge: "Suggéré" },
    ]) {
      await quantity.fill(step.input); await ui.browser.keyboard.press("Tab");
      const after = await p.capture(`normalized-quantity-${step.tag}`), review = await actualComponentAction(ui, p, "fetchGeneratedOuvrageSubdetailDraft", reviewRequest);
      await recordEvidence(ui.army, `GC01-normalized-quantity-${step.tag}-observed`, { submitted: step.input, observedInput: await quantity.inputValue(),
        costInput: await materialArticle.getByLabel("Coût unitaire HT (€)", { exact: true }).inputValue(), componentText: await materialArticle.textContent() ?? "",
        summaryText: await componentSection(ui, p.s).textContent() ?? "", before: precisionBefore, after, reviewBefore: precisionReviewBefore, reviewAfter: review,
        postsBefore: precisionPostsBefore, postsAfter: p.calls.filter((c) => c.name === "updateGeneratedOuvrageSubdetailDraft").length,
        insertionEnabled: await ui.screen.getByTestId("generated-ouvrage-insert-button").isEnabled() });
      expect(after.estimate).toEqual(precisionBefore.estimate); expect(after.objects).toEqual(precisionBefore.objects);
      expect(review.records).toHaveLength(1); expect(review.records[0].reviewToken).toBe(precisionReviewBefore.records[0].reviewToken);
      expect(p.calls.filter((c) => c.name === "updateGeneratedOuvrageSubdetailDraft").length).toBe(precisionPostsBefore);
      await expect(materialArticle).toContainText(step.componentDs); await expect(componentSection(ui, p.s)).toContainText(step.totalDs);
      await expect(materialArticle.getByText(step.badge, { exact: true })).toBeVisible();
      if (step.tag === "same") {
        await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeEnabled();
        const inputBefore = await quantity.inputValue(), toastTitle = "Quantité ou rendement invalide (maximum 999999999.999).";
        const invalidToast = ui.screen.getByRole("alert").filter({ hasText: toastTitle });
        const invalidSave = componentSection(ui, p.s).getByRole("button", /^(?:(Valider|Revalider) le sous-détail|Sous-détail déjà validé)$/);
        await expect(invalidSave).toBeDisabled();
        await recordEvidence(ui.army, "GC01-invalid-quantity-baseline", { insertionEnabled: await ui.screen.getByTestId("generated-ouvrage-insert-button").isEnabled(),
          saveDisabled: await invalidSave.isDisabled(), saveLabel: await invalidSave.textContent(), reviewToken: review.records[0].reviewToken });
        await quantity.fill("1000000000"); await ui.browser.keyboard.press("Tab");
        const invalidAfter = await p.capture("invalid-quantity-after"), invalidReview = await actualComponentAction(ui, p, "fetchGeneratedOuvrageSubdetailDraft", reviewRequest);
        const inputAfter = await quantity.count() === 1 ? await quantity.inputValue() : null;
        const quantityError = await linkedFieldError(ui, await quantity.getAttribute("id"));
        const errorHeadings = JSON.parse(await ui.browser.evaluate(() => JSON.stringify([...document.querySelectorAll("h1,h2")]
          .map((n) => n.textContent ?? "").filter((text) => /application error|client.side exception|erreur inattendue/i.test(text))))) as string[];
        await recordEvidence(ui.army, "GC01-invalid-quantity-observed", { submitted: "1000000000", inputBefore, inputAfter,
          quantityError, toastTexts: await invalidToast.allTextContents(), ariaInvalid: await quantity.getAttribute("aria-invalid"), saveDisabled: await invalidSave.isDisabled(), errorHeadings,
          componentText: await materialArticle.count() === 1 ? await materialArticle.textContent() : "",
          summaryText: await componentSection(ui, p.s).count() === 1 ? await componentSection(ui, p.s).textContent() : "",
          insertionEnabled: await ui.screen.getByTestId("generated-ouvrage-insert-button").count() === 1 ? await ui.screen.getByTestId("generated-ouvrage-insert-button").isEnabled() : false, before: after, after: invalidAfter,
          reviewBefore: review, reviewAfter: invalidReview, postsBefore: precisionPostsBefore,
          postsAfter: p.calls.filter((c) => c.name === "updateGeneratedOuvrageSubdetailDraft").length });
        await expect(quantity).toHaveAttribute("aria-invalid", "true"); await expect(invalidSave).toBeDisabled(); expect(errorHeadings).toHaveLength(0);
        expect(quantityError.matchedReferences > 0).toBe(true); expect(quantityError.errorText).toMatch(/invalide|maximum|limite|dépass|stockage|hors|corrig/i);
        expect(inputAfter).toBe("1000000000"); expect(invalidAfter.estimate).toEqual(after.estimate); expect(invalidAfter.objects).toEqual(after.objects); expect(invalidAfter.calls).toEqual(after.calls);
        expect(invalidReview.records).toHaveLength(1); expect(invalidReview.records[0].reviewToken).toBe(review.records[0].reviewToken);
        expect(p.calls.filter((c) => c.name === "updateGeneratedOuvrageSubdetailDraft").length).toBe(precisionPostsBefore);
        await expect(materialArticle).toContainText(/DS\s*40[,.]00/); await expect(componentSection(ui, p.s)).toContainText(/DS\s*80[,.]00/);
        await expect(materialArticle.getByText("Suggéré", { exact: true })).toBeVisible(); await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeDisabled();
        // Correct the raw draft explicitly before the subsequent half-up witness.
        await quantity.fill(inputBefore); await ui.browser.keyboard.press("Tab");
        await expect(quantity).not.toHaveAttribute("aria-invalid", "true"); await expect(invalidSave).toBeEnabled();
        // A valid correction does not replace explicit human revalidation.
        await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeDisabled();
        await expect(materialArticle).toContainText(/DS\s*40[,.]00/); await expect(componentSection(ui, p.s)).toContainText(/DS\s*80[,.]00/);
        const corrected = await p.capture("invalid-quantity-corrected");
        await recordEvidence(ui.army, "GC01-invalid-quantity-corrected", { correctedInput: await quantity.inputValue(), state: corrected,
          saveDisabled: await invalidSave.isDisabled(), insertionEnabled: await ui.screen.getByTestId("generated-ouvrage-insert-button").isEnabled() });
        expect(corrected.estimate).toEqual(after.estimate); expect(corrected.objects).toEqual(after.objects); expect(corrected.calls).toEqual(after.calls);
      }
    }
    // Separate pre-code yield boundary: 1.0004 h/u on parent quantity10 must
    // normalize to1 before multiplication (10h), not10.004h. No such fixture
    // is prepared here; this journey does not claim to execute that boundary.
    const overflowToast = "Quantité ou rendement invalide (maximum 999999999.999).";
    const overflowToastAlert = ui.screen.getByRole("alert").filter({ hasText: overflowToast });
    const overflowPosts = p.calls.filter((call) => call.name === "updateGeneratedOuvrageSubdetailDraft").length;
    // Each temporary material is valid, while their sum exceeds numeric(12,3).
    // No review/application of this temporary composition is requested.
    await materialArticle.getByLabel("Coût unitaire HT (€)", { exact: true }).fill("0"); await ui.browser.keyboard.press("Tab");
    await materialArticle.getByLabel("Quantité", { exact: true }).fill("600000000"); await ui.browser.keyboard.press("Tab");
    await expect(materialArticle.getByRole("button", "Supprimer", { exact: true })).toBeDisabled();
    await materialArticle.getByRole("button", "Dupliquer", { exact: true }).click();
    await expect(componentSection(ui, p.s).getByRole("article")).toHaveCount(5);
    const copy = componentArticle(ui, p.s, 1); await expect(copy.getByRole("button", "Supprimer", { exact: true })).toBeEnabled();
    const mergeLocalBefore = await localSubdetail(ui, p), mergeOverflowBefore = await p.capture("overflow-merge-before");
    const mergeOverflowReviewBefore = await actualComponentAction(ui, p, "fetchGeneratedOuvrageSubdetailDraft", reviewRequest);
    // Repeated errors use the same text. Require the previous announcement to
    // have disappeared before triggering this operation; never choose first/last.
    await expect(overflowToastAlert).toHaveCount(0);
    await copy.getByRole("button", "Fusionner", { exact: true }).click();
    const mergeLocalAfter = await localSubdetail(ui, p), mergeOverflowAfter = await p.capture("overflow-merge-after");
    const mergeOverflowReviewAfter = await actualComponentAction(ui, p, "fetchGeneratedOuvrageSubdetailDraft", reviewRequest);
    await recordEvidence(ui.army, "GC01-overflow-merge-observed", { operandQuantity: 600000000, operandCost: 0, newLocalCopyExpectedId: null,
      localBefore: mergeLocalBefore, localAfter: mergeLocalAfter, before: mergeOverflowBefore, after: mergeOverflowAfter,
      reviewBefore: mergeOverflowReviewBefore, reviewAfter: mergeOverflowReviewAfter, postsBefore: overflowPosts,
      postsAfter: p.calls.filter((call) => call.name === "updateGeneratedOuvrageSubdetailDraft").length,
      toastTexts: await overflowToastAlert.allTextContents(), errorHeadings: await pageErrors(ui) });
    expect(mergeLocalAfter).toEqual(mergeLocalBefore); expect(mergeOverflowAfter.estimate).toEqual(mergeOverflowBefore.estimate); expect(mergeOverflowAfter.objects).toEqual(mergeOverflowBefore.objects);
    expect(mergeOverflowReviewAfter.records[0].reviewToken).toBe(mergeOverflowReviewBefore.records[0].reviewToken);
    await expect(overflowToastAlert).toBeVisible(); expect(await pageErrors(ui)).toHaveLength(0);
    expect(p.calls.filter((call) => call.name === "updateGeneratedOuvrageSubdetailDraft").length).toBe(overflowPosts);
    // Only the unsaved copy can be removed; never delete a persisted proposal.
    await copy.getByRole("button", "Supprimer", { exact: true }).click(); await expect(componentSection(ui, p.s).getByRole("article")).toHaveCount(4);
    const originalMaterial = componentArticle(ui, p.s, 0), originalToggle = originalMaterial.getByRole("button", p.s.components[0].designation, { exact: false });
    if (await originalToggle.getAttribute("aria-expanded") !== "true") await originalToggle.click();
    await originalMaterial.getByLabel("Quantité", { exact: true }).fill("1"); await originalMaterial.getByLabel("Coût unitaire HT (€)", { exact: true }).fill("40"); await ui.browser.keyboard.press("Tab");
    await expect(originalMaterial.getByText("Suggéré", { exact: true })).toBeVisible();
    // Fix the parent first. Its edit mode can remount the form; preservation of
    // an already entered local yield is explicitly outside this journey.
    await editParentQuantity(ui, p, "2");
    const yieldArticle = componentArticle(ui, p.s, 1), yieldToggle = yieldArticle.getByRole("button", p.s.components[1].designation, { exact: false });
    if (await yieldToggle.getAttribute("aria-expanded") !== "true") await yieldToggle.click();
    await yieldArticle.getByLabel("Unité", { exact: true }).fill("u"); await ui.browser.keyboard.press("Tab");
    await yieldArticle.getByLabel("Unité rendement", { exact: true }).fill("h/u"); await ui.browser.keyboard.press("Tab");
    const yieldInput = yieldArticle.getByLabel("Rendement", { exact: true }), yieldBeforeInput = await yieldInput.inputValue();
    const yieldLocalBefore = await localSubdetail(ui, p), yieldBefore = await p.capture("overflow-yield-before"), yieldReviewBefore = await actualComponentAction(ui, p, "fetchGeneratedOuvrageSubdetailDraft", reviewRequest);
    const yieldSave = componentSection(ui, p.s).getByRole("button", /^(Valider|Revalider) le sous-détail$/);
    await expect(yieldSave).toBeEnabled(); await expect(yieldArticle.getByText("Saisi manuellement", { exact: true })).toBeVisible();
    await yieldInput.fill("600000000"); await ui.browser.keyboard.press("Tab");
    const yieldLocalAfter = await localSubdetail(ui, p), yieldAfter = await p.capture("overflow-yield-after"), yieldReviewAfter = await actualComponentAction(ui, p, "fetchGeneratedOuvrageSubdetailDraft", reviewRequest);
    const yieldError = await linkedFieldError(ui, await yieldInput.getAttribute("id"));
    await recordEvidence(ui.army, "GC01-overflow-derived-hours-observed", { parentQuantity: 2, submittedYield: "600000000", unit: "u", yieldUnit: "h/u",
      parentText: await ui.screen.getByTestId(`candidate-card-${p.s.candidateId}`).textContent() ?? "",
      yieldBeforeInput, yieldAfterInput: await yieldInput.inputValue(), yieldError, insertionEnabled: await ui.screen.getByTestId("generated-ouvrage-insert-button").isEnabled(), ariaInvalid: await yieldInput.getAttribute("aria-invalid"), saveDisabled: await yieldSave.isDisabled(), localBefore: yieldLocalBefore, localAfter: yieldLocalAfter, before: yieldBefore, after: yieldAfter,
      reviewBefore: yieldReviewBefore, reviewAfter: yieldReviewAfter, postsBefore: overflowPosts,
      postsAfter: p.calls.filter((call) => call.name === "updateGeneratedOuvrageSubdetailDraft").length,
      toastTexts: await overflowToastAlert.allTextContents(), errorHeadings: await pageErrors(ui) });
    expect(await yieldInput.inputValue()).toBe("600000000");
    // The target raw value/error legitimately differs; all other local fields stay exact.
    expect((yieldLocalAfter.articles as Json[]).map((article) => (article.fields as Json[]).filter((field) => field.label !== "Rendement")))
      .toEqual((yieldLocalBefore.articles as Json[]).map((article) => (article.fields as Json[]).filter((field) => field.label !== "Rendement")));
    await expect(yieldInput).toHaveAttribute("aria-invalid", "true"); await expect(yieldSave).toBeDisabled();
    expect(yieldError.matchedReferences > 0).toBe(true); expect(yieldError.errorText).toMatch(/invalide|maximum|limite|dépass|stockage|hors|corrig/i);
    await expect(yieldArticle.getByText("Saisi manuellement", { exact: true })).toBeVisible(); await expect(yieldArticle).toContainText(p.s.components[1].designation);
    await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeDisabled();
    await expect(componentSection(ui, p.s)).toContainText(/DS\s*80[,.]00/); await expect(componentSection(ui, p.s)).toContainText(/MO\s*1\s*h/);
    expect(yieldAfter.estimate).toEqual(yieldBefore.estimate); expect(yieldAfter.objects).toEqual(yieldBefore.objects); expect(yieldAfter.calls).toEqual(yieldBefore.calls); expect(yieldReviewAfter.records[0].reviewToken).toBe(yieldReviewBefore.records[0].reviewToken);
    expect(await pageErrors(ui)).toHaveLength(0);
    expect(p.calls.filter((call) => call.name === "updateGeneratedOuvrageSubdetailDraft").length).toBe(overflowPosts);
    await yieldInput.clear(); await yieldArticle.getByLabel("Unité rendement", { exact: true }).clear(); await yieldArticle.getByLabel("Unité", { exact: true }).fill("h"); await ui.browser.keyboard.press("Tab");
    await editParentQuantity(ui, p, "1"); await expect(componentSection(ui, p.s).getByRole("article")).toHaveCount(4);
    await expect(componentSection(ui, p.s)).toContainText(/DS\s*80[,.]00/);
    const cleared = await p.capture("temporary-overflow-composition-cleared-without-save");
    await recordEvidence(ui.army, "GC01-overflow-ui-cleanup-observed", { local: await localSubdetail(ui, p), state: cleared,
      parentText: await ui.screen.getByTestId(`candidate-card-${p.s.candidateId}`).textContent() ?? "",
      postsBefore: overflowPosts, postsAfter: p.calls.filter((call) => call.name === "updateGeneratedOuvrageSubdetailDraft").length });
    const totalLabor = componentArticle(ui, p.s, 1), totalLaborToggle = totalLabor.getByRole("button", p.s.components[1].designation, { exact: false });
    if (await totalLaborToggle.getAttribute("aria-expanded") !== "true") await totalLaborToggle.click();
    await expect(totalLabor.getByLabel("Unité", { exact: true })).toHaveValue("h");
    await totalLabor.getByLabel("Coût unitaire HT (€)", { exact: true }).fill("0"); await totalLabor.getByLabel("Quantité", { exact: true }).fill("600000000"); await ui.browser.keyboard.press("Tab");
    const totalBefore = await p.capture("overflow-total-hours-before"); await totalLabor.getByRole("button", "Dupliquer", { exact: true }).click();
    const totalAfter = await p.capture("overflow-total-hours-after"), totalLocal = await localSubdetail(ui, p);
    const totalAlert = "Les heures calculées dépassent la limite de stockage. Corrigez la quantité ou le rendement avant validation.";
    const totalSave = componentSection(ui, p.s).getByRole("button", /^(Valider|Revalider) le sous-détail$/);
    await recordEvidence(ui.army, "GC01-overflow-total-hours-observed", { individualHours: 600000000, individualCost: 0, combinedHours: 1200000000,
      local: totalLocal, before: totalBefore, after: totalAfter, saveDisabled: await totalSave.isDisabled(), errorHeadings: await pageErrors(ui),
      postsBefore: overflowPosts, postsAfter: p.calls.filter((call) => call.name === "updateGeneratedOuvrageSubdetailDraft").length });
    await expect(componentSection(ui, p.s)).toContainText("MO à corriger"); await expect(componentSection(ui, p.s).getByRole("alert").filter({ hasText: totalAlert })).toBeVisible();
    await expect(totalSave).toBeDisabled(); expect(await pageErrors(ui)).toHaveLength(0); expect(totalAfter.objects).toEqual(totalBefore.objects); expect(totalAfter.estimate).toEqual(totalBefore.estimate);
    expect(p.calls.filter((call) => call.name === "updateGeneratedOuvrageSubdetailDraft").length).toBe(overflowPosts);
    const totalCopy = componentArticle(ui, p.s, 2); await expect(totalCopy.getByRole("button", "Supprimer", { exact: true })).toBeEnabled(); await totalCopy.getByRole("button", "Supprimer", { exact: true }).click();
    await expect(componentSection(ui, p.s).getByRole("article")).toHaveCount(4); await totalLabor.getByLabel("Quantité", { exact: true }).fill("1"); await totalLabor.getByLabel("Coût unitaire HT (€)", { exact: true }).fill("40"); await ui.browser.keyboard.press("Tab");
    await expect(totalLabor.getByText("Suggéré", { exact: true })).toBeVisible(); await expect(componentSection(ui, p.s)).toContainText(/MO\s*1\s*h/);
    await recordEvidence(ui.army, "GC01-overflow-total-hours-cleared", { local: await localSubdetail(ui, p), state: await p.capture("overflow-total-hours-cleanup"),
      postsBefore: overflowPosts, postsAfter: p.calls.filter((call) => call.name === "updateGeneratedOuvrageSubdetailDraft").length });
    await componentDecision(ui, p, 2, "Rétablir"); await expect(componentSection(ui, p.s)).toContainText(/DS\s*160[,.]00/);
    const restoredArticle = componentArticle(ui, p.s, 2), facts = restoredArticle.getByLabel("Faits", { exact: true });
    const factsBefore = await facts.inputValue(); await facts.fill(`${factsBefore}\n`); await ui.browser.keyboard.press("Tab");
    await expect(restoredArticle.getByText("Suggéré", { exact: true })).toBeVisible();
    const cost = restoredArticle.getByLabel("Coût unitaire HT (€)", { exact: true });
    await cost.fill("80,01"); await ui.browser.keyboard.press("Tab"); await expect(restoredArticle.getByText("Saisi manuellement", { exact: true })).toBeVisible();
    await cost.fill("80"); await ui.browser.keyboard.press("Tab");
    await recordEvidence(ui.army, "GC01-restored-equivalent-content-before-save", { designation: p.s.components[2].designation, text: await restoredArticle.textContent() ?? "",
      factsBefore, factsAfter: await facts.inputValue(), costAfter: await cost.inputValue(), summary: await componentSection(ui, p.s).textContent(), state: await p.objects() });
    await expect(restoredArticle.getByText("Suggéré", { exact: true })).toBeVisible();
    await expect(componentSection(ui, p.s)).toContainText(/DS\s*160[,.]00/); reviewed(await saveComponents(ui, p));
    await reopen(ui, p); const restored = await p.capture("restored-reload");
    expect(restored.objects.components.find((r) => r.id === p.s.components[2].componentId)?.status).toBe("suggested");
    expect(restored.objects.components.find((r) => r.id === p.s.components[2].componentId)?.unit_cost_ht_cents).toBe(8000);
    expect(restored.objects.components.find((r) => r.id === p.s.components[2].componentId)?.facts).toEqual([p.s.components[2].designation]);
    expect(restored.objects.components.find((r) => r.id === p.s.components[3].componentId)?.status).toBe("rejected");
    await componentDecision(ui, p, 2, "Écarter"); reviewed(await saveComponents(ui, p));
    await reopen(ui, p); await p.capture("review-before-apply");
    const reply = await applyComponents(ui, p); expect(reply.status).toBe(200); expect(reply.records).toHaveLength(1); expect(reply.records[0].ok).toBe(true);
    const applied = await p.capture("first-read-after-apply"); assertComposition(applied, p, [8000, 1600, 9600], 8000);
    await ui.browser.reload({ timeout: 15_000 }); await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    assertComposition(await p.capture("applied-reload"), p, [8000, 1600, 9600], 8000);
    await componentExports(ui, p, [8000, 1600, 9600]);
    await reuse(ui, p, p.fixture.reuse.versionId, p.fixture.reuse.projectId, [8000, 1600, 9600]);
  } finally { await p.close(); }
});

if (selection === "full") {
  armyTest("GC02 retained zero-cost labor preserves one hour identity provenance and library reuse", options, async (ui) => {
    const p = await prepareComponents(ui, "GC02");
    try {
      await openComponents(ui, p); await componentDecision(ui, p, 0, "Écarter"); await componentDecision(ui, p, 3, "Écarter");
      const article = componentArticle(ui, p.s, 1); await article.getByRole("button", p.s.components[1].designation, { exact: false }).click();
      await article.getByLabel("Coût unitaire HT (€)", { exact: true }).fill("0"); await ui.browser.keyboard.press("Tab");
      reviewed(await saveComponents(ui, p)); await reopen(ui, p);
      const before = await p.capture("zero-labor-review"); expect(before.objects.components.find((r) => r.id === p.s.components[1].componentId)?.unit_cost_ht_cents).toBe(0);
      const reply = await applyComponents(ui, p); expect(reply.records[0].ok).toBe(true);
      assertComposition(await p.capture("zero-labor-applied"), p, [8000, 1600, 9600], 8000);
      const fresh = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-GC02-REUSE`, title: "GC02 reuse zero labor" }, ui.army);
      await reuse(ui, p, fresh.versionId, fresh.projectId, [8000, 1600, 9600]);
    } finally { await p.close(); }
  });
  armyTest("GC03 all excluded components refuse human validation and application", options, async (ui) => {
    const p = await prepareComponents(ui, "GC03");
    try {
      await openComponents(ui, p); for (let i = 0; i < 4; i++) await componentDecision(ui, p, i, "Écarter");
      await expect(componentSection(ui, p.s).getByRole("button", "Enregistrer les décisions", { exact: true })).toBeEnabled();
      const reply = await saveComponents(ui, p); expect(reply.records[0].status).toBe("pending_review");
      await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeDisabled();
      await reopen(ui, p);
      const state = await p.capture("all-excluded-refused"); await recordEvidence(ui.army, "GC03-validation-refused", { reply, observed: await componentSection(ui, p.s).textContent(), state });
      expect(amounts(state.estimate.version)).toEqual([0, 0, 0]); expect(state.objects.drafts[0].status).toBe("pending");
      expect(state.objects.subdetails[0].status).toBe("pending_review"); expect(state.objects.components).toHaveLength(4);
      expect(state.objects.components.every((r) => r.status === "rejected")).toBe(true);
      expect(state.objects.components.map((r) => r.id).sort()).toEqual(p.s.components.map((c) => c.componentId).sort());
      for (const [index, c] of p.s.components.entries()) {
        const component = state.objects.components.find((r) => r.id === c.componentId)!;
        expect(component).toEqual(expect.objectContaining({ status: "rejected", designation: c.designation, cost_type: c.costType, quantity: c.quantity, unit: c.unit,
          unit_cost_ht_cents: c.unitCostHtCents, loss_coeff_bp: 0, yield_value: null, yield_unit: null, source_fragment_id: c.fragmentId, component_order: index,
          facts: [c.designation], hypotheses: [], inferences: [], confidence: 1 }));
        expect((component.metadata as Json).rejected_from_status).toBe("suggested");
        const sources = state.objects.componentSources.filter((r) => r.component_id === c.componentId); expect(sources).toHaveLength(1);
        expect(sources[0]).toEqual(expect.objectContaining({ source_fragment_id: c.fragmentId, source_rank: 0, evidence_kind: "fact", note: c.designation }));
      }
      for (const key of ["applications", "snapshots", "assemblies", "libraryComponents"]) expect(state.objects[key]).toHaveLength(0);
    } finally { await p.close(); }
  });
  armyTest("GC04 an older application intention refuses a changed component selection", options, async (ui) => {
    const p = await prepareComponents(ui, "GC04");
    try {
      await openComponents(ui, p); const original = await saveComponents(ui, p); reviewed(original);
      const card = ui.screen.getByTestId(`candidate-card-${p.s.candidateId}`), checkbox = card.getByRole("checkbox", `Sélectionner ${p.s.designation}`, { exact: true }); if (!await checkbox.isChecked()) await checkbox.check();
      p.blockNextApplication(); await ui.screen.getByTestId("generated-ouvrage-insert-button").click();
      await expect.poll(() => p.calls.filter((r) => r.name === "insertGeneratedOuvrages").length).toBe(1);
      const intention = p.calls.find((r) => r.name === "insertGeneratedOuvrages")!.request;
      const components = structuredClone(original.request.components) as Json[]; components[2].status = "rejected"; components[3].status = "rejected";
      const changed = await actualComponentAction(ui, p, "updateGeneratedOuvrageSubdetailDraft", { ...original.request, components, expectedReviewToken: original.records[0].reviewToken, markReviewed: true });
      await recordEvidence(ui.army, "GC04-real-changed-review", { original, intention, changed, firstApplicationAbortedBeforeServer: true, independentSessionsClaim: false });
      expect(changed.records[0].status).toBe("reviewed"); expect(changed.records[0].reviewToken).not.toBe(original.records[0].reviewToken);
      const before = await p.capture("stale-before-replay"), refused = await actualComponentAction(ui, p, "insertGeneratedOuvrages", intention), after = await p.capture("stale-after-replay");
      await recordEvidence(ui.army, "GC04-stale-refusal", { before, refused, after, intention });
      expect(refused.records).toHaveLength(1); expect(refused.records[0].ok).toBe(false); expect((refused.records[0].error as Json).code).toBe("GENERATED_OUVRAGE_REVIEW_CHANGED");
      expect(after.estimate).toEqual(before.estimate); for (const key of ["applications", "snapshots", "assemblies", "libraryComponents"]) expect(after.objects[key]).toHaveLength(0);
    } finally { await p.close(); }
  });
}
