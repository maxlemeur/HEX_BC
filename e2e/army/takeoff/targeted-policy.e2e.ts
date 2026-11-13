import { expect } from "e2e";
import { apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence } from "../critical/fixtures";
import { applyOwnedTakeoff, localTakeoffFixture, localTakeoffWorkerClient } from "./fixtures";
import { createEmptyTakeoffPreparation } from "../../../src/lib/takeoff/preparation";
import { launchWorkerVectorUpload, startOwnedWorker } from "./worker-support";
import { VECTOR_PLAN } from "./vector-plan-fixture";

const options = { session: "army", tags: ["critical", "takeoff", "local"], timeout: 180_000 };

armyTest("TKQ01 targeted quantity review rounds whole priced lines once and exposes a missing floor", options, async ui => {
  const ids = await createEstimateViaWizard(ui, { projectName: ui.army.projectName, title: "ARMY TI681 quantités" }, ui.army);
  const target = await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} target`);
  const fixture = await localTakeoffFixture(ui.army, ids);
  const definitions = [
    { designation: "EF cuivre DN 22", quantity: 2.2, unit: "ml", confidence: 0.2 },
    { designation: "EF cuivre DN 22", quantity: 2.2, unit: "ml", confidence: 0.9 },
    { designation: "ECS cuivre DN 22", quantity: 2.2, unit: "ml", confidence: 0.9 },
    { designation: "ECS cuivre DN 22", quantity: 1.3, unit: "ml", confidence: 0.9 },
    { designation: "Bouclage cuivre DN 22", quantity: 12.14, unit: "ml", confidence: 0.2 },
    { designation: "Surface sol net", quantity: 12.14, unit: "m2", confidence: 0.9 },
  ];
  const seed = await fixture.seed("C", definitions, "Bâtiment A RDC Z1.pdf");
  const worker = await localTakeoffWorkerClient(ui.army, ids.versionId);
  const preparation = createEmptyTakeoffPreparation();
  preparation.scope = { ...preparation.scope, buildings: ["A"], levels: ["RDC", "R+1"], zones: ["Z1"], confirmed: true };
  const stored = await worker.client.from("takeoff_results").update({ provider_meta: { preparation_snapshot: { preparation } } }).eq("id", seed.resultId);
  expect(stored.error).toBeNull();
  const applied = await applyOwnedTakeoff(ui.browser, ids.versionId, seed.jobId, {
    strategy: "append", target_section_id: target.parent_id,
    overrides: seed.items.map(item => ({ item_id: item.id, action: "set_price", action_params: { unit_price_cents: 1000 } })),
  });
  expect(applied.status).toBe(200);
  const estimate = await readEstimate(ui.browser, ids.versionId);
  for (const [title, quantity] of [["EF cuivre DN 22", 5], ["ECS cuivre DN 22", 4], ["Bouclage cuivre DN 22", 13], ["Surface sol net", 12.14]] as const) {
    const lines = estimate.items.filter(item => item.title === title);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(quantity);
  }
  const financial = await apiRequest<{ data: { posts: Array<{ line_id: string; amount_cents: number; recommend_review: boolean }> } }>(
    ui.browser, "GET", `/api/takeoff/jobs/${seed.jobId}/review-context`);
  expect(financial.status).toBe(200);
  const ef = estimate.items.find(item => item.title === "EF cuivre DN 22")!;
  expect(ef.line_total_ht_cents).not.toBeNull();
  expect(financial.body.data.posts.find(post => post.line_id === ef.id)?.amount_cents).toBe(ef.line_total_ht_cents!);
  const deniedSelection = await fixture.client.rpc("select_takeoff_quantity_sources", {
    p_job_id: seed.jobId, p_tenant_id: fixture.tenantId, p_choices: [],
  });
  expect(deniedSelection.error?.code).toBe("42501");
  const detail = await apiRequest<{ data: { items: { data: Array<{ id: string; quantity: number; is_verified: boolean }> } } }>(ui.browser, "GET", `/api/takeoff/jobs/${seed.jobId}`);
  expect(detail.status).toBe(200);
  for (const source of seed.items) expect(detail.body.data.items.data.find(item => item.id === source.id)?.quantity).toBe(source.quantity);
  expect(detail.body.data.items.data.every(item => !item.is_verified)).toBe(true);
  const path = `/dashboard/affaires/${ids.projectId}/takeoff/${seed.jobId}/review/targeted?versionId=${ids.versionId}`;
  await ui.app.open(path);
  await ui.screen.getByText("Couverture des bâtiments, étages, zones et réseaux", { exact: true }).click();
  await expect(ui.screen.getByText("Étage · R+1", { exact: true })).toBeVisible();
  await expect(ui.screen.getByText("Non analysé", { exact: true })).toBeVisible();
  await recordEvidence(ui.army, "TKQ01-quantity-policy", { ids, jobId: seed.jobId, applied,
    screenshot: await ui.app.screenshot("ti681-coverage-rounding") });
});

armyTest("TKQ02 usable vector measurement takes priority with a visible gap and only one applied reading", options, async ui => {
  const { ids, jobId, owner, client } = await launchWorkerVectorUpload(ui);
  const network = VECTOR_PLAN.networks[0];
  const completed = await startOwnedWorker(ui, ids, jobId, "success", { vectors: true, owner,
    providerItems: [{ designation: network.designation, quantity: network.length_m + 2, unit: "ml", source_page: 1,
      confidence: 0.95, evidence: "Lecture contrôlée du réseau EF sur le plan fictif, page 1." }] }).done;
  expect(completed.outcome.status).toBe("completed");
  const retained = completed.items.filter(item => !item.is_excluded);
  expect(retained).toHaveLength(1);
  expect(retained[0]).toMatchObject({ designation: network.designation, quantity: network.length_m });
  const target = await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} target`);
  const alternatives = await client.from("takeoff_items").select("id,metadata,is_excluded,updated_at").eq("job_id", jobId);
  expect(alternatives.error).toBeNull();
  const model = alternatives.data!.find(item => !item.metadata?.vector)!;
  expect(model.is_excluded).toBe(true);
  const includedTwice = await apiRequest(ui.browser, "PATCH", `/api/takeoff/jobs/${jobId}/items`, {
    items: [{ item_id: model.id, updated_at: model.updated_at, fields: { is_excluded: false, exclusion_reason: null } }],
  });
  expect(includedTwice.status).toBe(200);
  const conflict = await applyOwnedTakeoff(ui.browser, ids.versionId, jobId, { strategy: "append", target_section_id: target.parent_id });
  expect(conflict.status).toBe(422);
  const refreshed = await client.from("takeoff_items").select("updated_at").eq("id", model.id).single();
  expect(refreshed.error).toBeNull();
  const corrected = await apiRequest(ui.browser, "PATCH", `/api/takeoff/jobs/${jobId}/items`, {
    items: [{ item_id: model.id, updated_at: refreshed.data!.updated_at,
      fields: { is_excluded: true, exclusion_reason: "Lecture alternative : conserver la mesure vectorielle." } }],
  });
  expect(corrected.status).toBe(200);
  const applied = await applyOwnedTakeoff(ui.browser, ids.versionId, jobId, { strategy: "append", target_section_id: target.parent_id,
    overrides: retained.map(item => ({ item_id: item.id, action: "set_price", action_params: { unit_price_cents: 1000 } })) });
  expect(applied.status).toBe(200);
  const estimate = await readEstimate(ui.browser, ids.versionId);
  const lines = estimate.items.filter(item => item.title === network.designation);
  expect(lines).toHaveLength(1);
  expect(lines[0].quantity).toBe(network.length_m);
  const financial = await apiRequest<{ data: { posts: Array<{ line_id: string; impact_cents: number }> } }>(
    ui.browser, "GET", `/api/takeoff/jobs/${jobId}/review-context`);
  expect(financial.status).toBe(200);
  expect(financial.body.data.posts.find(post => post.line_id === lines[0].id)?.impact_cents)
    .toBe(Math.round(2 * lines[0].line_total_ht_cents! / network.length_m));
  await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${jobId}/review/targeted?versionId=${ids.versionId}`);
  const gaps = ui.screen.getByRole("list", "Écarts entre les lectures", { exact: true });
  await expect(gaps).toContainText(`vectoriel ${network.length_m} ml`);
  await expect(gaps).toContainText(`ChatGPT ${network.length_m + 2} ml`);
  await expect(gaps).toContainText("écart 2 ml");
  await recordEvidence(ui.army, "TKQ02-source-priority", { ids, jobId, retained, applied,
    boundary: "Real extraction of an owned fictional PDF; controlled model interpretation; no human timing measurement." });
});

// TI-682 D11: the worker pairs a vector measure with the vision line of the same identity (TKQ02). A vector measure it
// could not pair stays excluded, without a group: included by hand beside the length the model read on its page, both
// readings reached the estimate. The application now refuses them by page, and takes the measure once the other
// reading is left out.
armyTest("TKQ03 a vector measure the worker did not pair is refused beside the vision reading of its page, then applied alone", options, async ui => {
  const { ids, jobId, fileName, owner, client } = await launchWorkerVectorUpload(ui);
  const network = VECTOR_PLAN.networks[0];
  // The model reads the same run without its material or diameter: nothing pairs it with the measure.
  const vision = "Réseau eau froide du plan";
  const completed = await startOwnedWorker(ui, ids, jobId, "success", { vectors: true, owner,
    providerItems: [{ designation: vision, quantity: network.length_m + 2, unit: "ml", source_page: 1,
      confidence: 0.95, evidence: "Lecture contrôlée du réseau EF sur le plan fictif, page 1." }] }).done;
  expect(completed.outcome.status).toBe("completed");
  expect(completed.items.filter(item => !item.is_excluded).map(item => item.designation)).toEqual([vision]);
  const target = await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} target`);
  const readings = await client.from("takeoff_items").select("id,designation,metadata,is_excluded,updated_at,source_file_name,source_page").eq("job_id", jobId);
  expect(readings.error).toBeNull();
  const measure = readings.data!.find(item => item.metadata?.vector && item.designation === network.designation)!;
  const model = readings.data!.find(item => !item.metadata?.vector)!;
  expect(measure).toMatchObject({ is_excluded: true, source_file_name: fileName, source_page: 1 });
  expect(measure.metadata?.quantity_source?.group ?? null).toBeNull();
  expect(model).toMatchObject({ designation: vision, is_excluded: false, source_file_name: fileName, source_page: 1 });

  // The bypass: the measure included by hand, the vision line of its page still included.
  const included = await apiRequest(ui.browser, "PATCH", `/api/takeoff/jobs/${jobId}/items`, {
    items: [{ item_id: measure.id, updated_at: measure.updated_at, fields: { is_excluded: false, exclusion_reason: null } }],
  });
  expect(included.status).toBe(200);
  const refused = await applyOwnedTakeoff(ui.browser, ids.versionId, jobId, { strategy: "append", target_section_id: target.parent_id });
  expect(refused.status).toBe(422);
  const refusal = (refused.body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }).error;
  expect(refusal?.code).toBe("TAKEOFF_APPLY_GUARD_FAILED");
  expect(refusal?.message).toContain(`de la page 1 de « ${fileName} »`);
  expect(refusal?.message).toContain("Conservez une seule lecture par page");
  expect(refusal?.details).toMatchObject({ guard: "quantity_sources", scope: "page", dimension: "length", source_page: 1, source_file_name: fileName });
  expect((await readEstimate(ui.browser, ids.versionId)).items.filter(item => item.title === network.designation || item.title === vision)).toEqual([]);
  const jobAfterRefusal = await client.from("takeoff_jobs").select("status").eq("id", jobId).single();
  expect(jobAfterRefusal.data?.status).toBe("completed");

  // One reading of the page: the vision line left out, the measure applied.
  const excluded = await apiRequest(ui.browser, "PATCH", `/api/takeoff/jobs/${jobId}/items`, {
    items: [{ item_id: model.id, updated_at: model.updated_at,
      fields: { is_excluded: true, exclusion_reason: "Lecture du plan écartée : mesure vectorielle retenue." } }],
  });
  expect(excluded.status).toBe(200);
  const applied = await applyOwnedTakeoff(ui.browser, ids.versionId, jobId, { strategy: "append", target_section_id: target.parent_id,
    overrides: [{ item_id: measure.id, action: "set_price", action_params: { unit_price_cents: 1000 } }] });
  expect(applied.status).toBe(200);
  const estimate = await readEstimate(ui.browser, ids.versionId);
  expect(estimate.items.filter(item => item.title === vision)).toEqual([]);
  const lines = estimate.items.filter(item => item.title === network.designation);
  expect(lines).toHaveLength(1);
  expect(lines[0].quantity).toBe(network.length_m);
  await recordEvidence(ui.army, "TKQ03-one-reading-per-page", { ids, jobId, measure: measure.id, model: model.id,
    refused: { status: refused.status, error: refusal }, applied: { status: applied.status, quantity: lines[0].quantity },
    boundary: "Real extraction of an owned fictional PDF; controlled model interpretation; no human timing measurement." });
});

// TI-701 (D13): the targeted review read by « Gros montants » and one network. Ways it fails: the filters live in the
// page only, so a reload or a shared link shows every line again; a count ignores the other filters or comes back
// different; a run no estimate line holds counts as a large amount; the filters cannot be reached on a phone.
armyTest("TKQ04 the targeted review filters by large amounts and one network, kept with their counts after a reload", options, async ui => {
  const ids = await createEstimateViaWizard(ui, { projectName: ui.army.projectName, title: "ARMY TI701 filtres" }, ui.army);
  // Four runs priced on the estimate (quantity × unit price: 500 €, 20 €, 320 €, 15 € of 855 €): 500 € and 320 € make
  // 95 % of the amount, the large ones. The ECS run is on no estimate line (« Non chiffré ») and has no page: blocked.
  const runs = [
    { designation: "EF cuivre DN 22", network: "EF", quantity: 10, price: 5000, page: 1 },
    { designation: "EF cuivre DN 28", network: "EF", quantity: 2, price: 1000, page: 1 },
    { designation: "EU PVC DN 100", network: "EU", quantity: 8, price: 4000, page: 1 },
    { designation: "EU PVC DN 125", network: "EU", quantity: 1, price: 1500, page: 1 },
    { designation: "ECS cuivre DN 16", network: "ECS", quantity: 3, price: null, page: null },
  ] as const;
  const [first, ...others] = runs.filter(run => run.price !== null);
  // The review context reads a line's unit in its unit code, else its description: the description serves both engines.
  const line = { line_nature: "supply_only", tax_rate_bp: 2000, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1, description: "ml" };
  const lot = await createLineViaApi(ui.browser, ids.versionId, first.designation, { ...line, quantity: first.quantity,
    unit_price_ht_cents: first.price } as never);
  for (const run of others) {
    const created = await apiRequest(ui.browser, "POST", `/api/estimates/${ids.versionId}/items`, { ...line, item_type: "line",
      parent_id: lot.parent_id, title: run.designation, quantity: run.quantity, unit_price_ht_cents: run.price });
    expect([created.status, created.status === 201 ? null : created.body]).toEqual([201, null]);
  }
  const fixture = await localTakeoffFixture(ui.army, ids);
  const seed = await fixture.seed("C", runs.map(run => ({ designation: run.designation, quantity: run.quantity, unit: "ml", confidence: 0.6,
    source_page: run.page, metadata: { rule_inputs: { version: 2, source: "designation", kind: "network", network: run.network,
      material: run.designation.includes("PVC") ? "pvc" : "cuivre", dn: null, non_observable: null, model_quantity: run.quantity } } })),
  "Plan RDC Z1.pdf");
  const idOf = (designation: string) => seed.items.find(item => item.designation === designation)!.id;

  // The review context prices each run at its estimate line and names the run no line holds.
  const context = await apiRequest<{ data: { unlinked_item_ids: string[];
    item_pricing: Array<{ item_id: string; pricing_status: string | null; unit_price_cents: number | null }> } }>(
    ui.browser, "GET", `/api/takeoff/jobs/${seed.jobId}/review-context`);
  expect(context.status).toBe(200);
  expect(context.body.data.unlinked_item_ids).toEqual([idOf("ECS cuivre DN 16")]);
  const pricing = context.body.data.item_pricing;
  expect(pricing.map(entry => entry.item_id).sort()).toEqual(runs.filter(run => run.price !== null).map(run => idOf(run.designation)).sort());
  expect(pricing.every(entry => entry.pricing_status === "priced" && Number.isSafeInteger(entry.unit_price_cents) && entry.unit_price_cents! > 0)).toBe(true);

  await ui.browser.setViewport({ width: 1440, height: 900 });
  const path = `/dashboard/affaires/${ids.projectId}/takeoff/${seed.jobId}/review/targeted?versionId=${ids.versionId}`;
  await ui.app.open(path);
  const list = ui.screen.getByRole("listbox", "Lignes à trancher", { exact: true });
  const filters = ui.screen.getByRole("group", "Filtrer les lignes", { exact: true });
  await expect(list.getByRole("option")).toHaveCount(5);
  for (const name of ["À revoir 5", "Blocages 1", "Incertaines 4", "Gros montants 2", "Hypothèses 0", "Non chiffré 1"]) {
    await expect(filters.getByRole("button", name, { exact: true })).toBeVisible();
  }

  await filters.getByRole("button", "Gros montants 2", { exact: true }).click();
  await expect(filters.getByRole("button", "Gros montants 2", { exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(filters.getByText(/^Gros montants : 2 lignes du métré, 95 % du montant chiffré .*, dont 2 à revoir\.$/)).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(2);
  await filters.getByRole("button", "Réseau ou lot", { exact: true }).click();
  await filters.getByRole("checkbox", "EF · Eau froide 1", { exact: true }).check();
  // Expected after the two filters: one line, and each count read with the other kinds' filters.
  const expected = async () => {
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(list.getByRole("option", /^EF cuivre DN 22/)).toBeVisible();
    for (const name of ["À revoir 1", "Blocages 0", "Incertaines 1", "Gros montants 1", "Non chiffré 0"]) {
      await expect(filters.getByRole("button", name, { exact: true })).toBeVisible();
    }
    await expect(filters.getByRole("button", "Gros montants 1", { exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(filters.getByRole("checkbox", "EF · Eau froide 1", { exact: true })).toBeChecked();
    await expect(filters.getByRole("checkbox", "EU · Eaux usées 1", { exact: true })).not.toBeChecked();
    await expect(filters.getByRole("checkbox", "ECS · Eau chaude sanitaire 0", { exact: true })).not.toBeChecked();
  };
  await expected();
  await expect(ui.browser).toHaveURL(/[?&]large=1(&|$)/);
  await expect(ui.browser).toHaveURL(/[?&]network=EF(&|$)/);
  const desktop = await ui.app.screenshot("ti701-targeted-filters-1440");

  await ui.browser.reload();
  await expected();
  await expect(filters.getByText(/^Gros montants : 2 lignes du métré, 95 % du montant chiffré .*, dont 2 à revoir\.$/)).toBeVisible();

  // On a phone the filters stay in view and usable: the list widens again, then narrows back.
  await ui.browser.setViewport({ width: 390, height: 844 });
  const phoneLayout = await ui.browser.evaluate(() => {
    const box = document.querySelector("[role='group'][aria-label='Filtrer les lignes']")!.getBoundingClientRect();
    return { left: box.left >= 0, right: box.right <= window.innerWidth, top: box.top >= 0 && box.top < window.innerHeight / 2 };
  });
  expect(phoneLayout).toEqual({ left: true, right: true, top: true });
  await filters.getByRole("checkbox", "EU · Eaux usées 1", { exact: true }).check();
  await expect(list.getByRole("option")).toHaveCount(2);
  const phone = await ui.app.screenshot("ti701-targeted-filters-390");
  await filters.getByRole("button", "Effacer les filtres", { exact: true }).click();
  await expect(list.getByRole("option")).toHaveCount(5);
  await expect(ui.browser).not.toHaveURL(/[?&](large|network)=/);
  await recordEvidence(ui.army, "TKQ04-targeted-filters", { ids, jobId: seed.jobId, pricing, screenshots: [desktop, phone],
    boundary: "Owned fictional takeoff seed on a local stack; prices from the estimate engine; no model call." });
});
