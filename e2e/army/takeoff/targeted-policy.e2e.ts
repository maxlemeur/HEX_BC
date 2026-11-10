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
