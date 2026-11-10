import { randomUUID } from "node:crypto";
import { expect } from "e2e";

import { apiRequest, armyTest, createEstimateViaWizard, recordEvidence, type ArmyState } from "./fixtures";
import { localTakeoffFixture, localTakeoffWorkerClient } from "../takeoff/fixtures";
import type { TakeoffDpgfComparisonResponse } from "@/lib/takeoff/types";

const cases: Array<{ name: string; reference: number | null; measured: number[]; priced: number }> = [
  { name: "higher DPGF reference", reference: 3000, measured: [2980], priced: 3000 },
  { name: "several plan contributions", reference: 3000, measured: [1500, 1520], priced: 3020 },
  { name: "DPGF without quantity", reference: null, measured: [3020], priced: 3020 },
];

type QuantityUi = Parameters<typeof createEstimateViaWizard>[0] & { army: ArmyState };

async function prepareQuantityQuote(ui: QuantityUi, reference: number | null, measured: readonly number[]) {
  const { army } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-TI680`, title: "Quantités fictives" }, army);
  const owned = await localTakeoffFixture(army, ids);
  const sectionId = randomUUID();
  const lineId = randomUUID();
  const section = await owned.client.from("estimate_items").insert({ id: sectionId, tenant_id: owned.tenantId,
    version_id: ids.versionId, item_type: "section", position: 1, title: "Réseaux fictifs" });
  expect(section.error).toBeNull();
  const inserted = await owned.client.from("estimate_items").insert({ id: lineId, tenant_id: owned.tenantId,
    version_id: ids.versionId, parent_id: sectionId, item_type: "line", position: 1, title: "EF cuivre DN 22",
    description: "ml", quantity: reference ?? 0, unit_price_ht_cents: 1000, tax_rate_bp: 2000,
    k_fo: 1, h_mo: 0, k_mo: 1, pu_ht_cents: 1000, line_total_ht_cents: (reference ?? 0) * 1000, line_tax_cents: (reference ?? 0) * 200, line_total_ttc_cents: (reference ?? 0) * 1200,
    source_provider: "dpgf", source_file_name: "dpgf-fictif.xlsx", source_page: 7,
    source_metadata: { dpgf_source_quantity: reference, dpgf_source_unit: "ml" } });
  expect(inserted.error).toBeNull();
  const job = await owned.seed("A", measured.map(quantity => ({ designation: "EF cuivre DN 22", quantity,
    unit: "ml", confidence: 0.99 })), "plan-fictif-ind-B.csv");
  const route = `/dashboard/affaires/${ids.projectId}/takeoff/${job.jobId}/review?versionId=${ids.versionId}&reviewMode=production&view=dpgf`;
  return { ids, owned, sectionId, lineId, job, route };
}

armyTest("TI681 invalidates old review evidence while quantity corrections remain non blocking", { session: "army", tags: ["critical"], timeout: 180_000 }, async ui => {
  const { ids, owned, sectionId, lineId, job, route } = await prepareQuantityQuote(ui, 3000, [3060]);
  await ui.app.open(route);
  await expect(ui.screen.getByText("Quantité proposée pour chiffrer", { exact: true })).toBeVisible();
  expect((await apiRequest(ui.browser, "POST", `/api/estimates/${ids.versionId}/lock`, {})).status).toBe(201);
  const session = await ui.browser.evaluate(id => sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${id}`), ids.versionId);
  if (!session) throw new Error("The owned draft lock session is missing.");
  const apply = () => apiRequest(ui.browser, "POST", `/api/takeoff/jobs/${job.jobId}/apply`,
    { strategy: "merge", target_section_id: sectionId }, { "x-estimate-draft-lock-session-id": session });
  // Review is optional; keep this job completed while exercising correction provenance.
  const decision = await apiRequest(ui.browser, "PATCH", `/api/takeoff/jobs/${job.jobId}/review-decision`,
    { version_id: ids.versionId, estimate_item_id: lineId, decision: "keep_takeoff", reason: "Mesure fictive vérifiée sur le plan indice B." });
  expect(decision.status).toBe(200);
  const accepted = await apiRequest<{ data: TakeoffDpgfComparisonResponse }>(ui.browser, "GET",
    `/api/takeoff/jobs/${job.jobId}/dpgf-compare?version_id=${ids.versionId}&view=all`);
  expect(accepted.body.data.rows[0].applied_decision?.decision).toBe("keep_takeoff");
  const item = await owned.client.from("takeoff_items").select("id,updated_at").eq("job_id", job.jobId).single();
  expect(item.error).toBeNull();
  const changed = await apiRequest(ui.browser, "PATCH", `/api/takeoff/jobs/${job.jobId}/items`,
    { items: [{ item_id: item.data!.id, updated_at: item.data!.updated_at, fields: { quantity: 6000 } }] });
  expect(changed.status).toBe(200);
  const changedSource = await owned.client.from("takeoff_items").select("quantity").eq("id", item.data!.id).single();
  expect(changedSource.data?.quantity).toBe(6000);
  const applied = await apply();
  expect(applied.status).toBe(200);
  const target = await owned.client.from("estimate_items").select("quantity,source_metadata").eq("id", lineId).single();
  expect(target.data?.quantity).toBe(6000);
  await recordEvidence(ui.army, "TI681-stale-review-advisory", { ...ids, jobId: job.jobId, reviewed: 3060, changed: 6000,
    actualStatus: applied.status, preservedQuantity: target.data?.quantity ?? null });
});

armyTest("TI680 copying a printed quantity cannot validate an unknown or SHAB floor basis", { session: "army", tags: ["critical"], timeout: 180_000 }, async ui => {
  const { ids, owned } = await prepareQuantityQuote(ui, 3000, [3000]);
  const job = await owned.seed("A", [{ designation: "Revêtement de sol", quantity: 19.5, unit: "m2", confidence: 0.99 }], "surface-fictive.csv");
  const itemId = job.items[0].id;
  const { client: worker } = await localTakeoffWorkerClient(ui.army, ids.versionId);
  for (const fixture of [{ label: "Bureau", cause: "basis_unknown", message: "Base de la surface" },
    { label: "Bureau SHAB", cause: "basis_mismatch", message: "même base" }]) {
    const seeded = await worker.from("takeoff_items").update({ rules_stale: true, metadata: { rule_inputs: { version: 1,
      source: "vector", kind: "surface", network: null, material: null, dn: null, non_observable: null,
      model_quantity: 19.5, room: fixture.label, printed_m2: 20 } } }).eq("id", itemId);
    expect(seeded.error).toBeNull();
    const current = await owned.client.from("takeoff_items").select("updated_at").eq("id", itemId).single();
    await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${job.jobId}/review/targeted?versionId=${ids.versionId}&line=${itemId}`);
    const copied = await apiRequest(ui.browser, "PATCH", `/api/takeoff/jobs/${job.jobId}/items`,
      { items: [{ item_id: itemId, updated_at: current.data!.updated_at, fields: { quantity: 20 } }] });
    expect(copied.status).toBe(200);
    await ui.browser.reload();
    await expect(ui.screen.getByRole("region", "Décision sur la ligne", { exact: true })).toContainText(fixture.message);
    const stored = await owned.client.from("takeoff_items").select("quantity,rule_results,is_verified").eq("id", itemId).single();
    expect(stored.data).toMatchObject({ quantity: 20, is_verified: false,
      rule_results: expect.arrayContaining([expect.objectContaining({ rule: "area_printed", status: "fail",
        details: expect.objectContaining({ measured_m2: 19.5, printed_m2: 20, cause: fixture.cause }) })]) });
    await recordEvidence(ui.army, `TI680-${fixture.cause.replaceAll("_", "-")}`, { ...ids, jobId: job.jobId, itemId, stored: stored.data });
  }
});

// TI-686 D9 with D17 (H3): accepting a printed-surface failure states the basis of the printed surface. Declared on
// the price line's basis, both surfaces compare and the higher is retained, saved before V; declared on another basis,
// nothing is compared and the line keeps its quantity.
armyTest("TI680 accepts a printed surface with its declared basis, retaining the higher surface on the line's basis", { session: "army", tags: ["critical"], timeout: 180_000 }, async ui => {
  const { ids, owned } = await prepareQuantityQuote(ui, 3000, [3000]);
  const job = await owned.seed("A", [
    { designation: "Revêtement de sol", quantity: 19.5, unit: "m2", confidence: 0.99 },
    { designation: "Revêtement de sol", quantity: 19.5, unit: "m2", confidence: 0.99 },
  ], "surface-fictive-motifs.csv");
  const [netFloorId, shabId] = job.items.map(item => item.id);
  const { client: worker } = await localTakeoffWorkerClient(ui.army, ids.versionId);
  const seeded = await worker.from("takeoff_items").update({ rules_stale: true, metadata: { rule_inputs: { version: 1,
    source: "vector", kind: "surface", network: null, material: null, dn: null, non_observable: null,
    model_quantity: 19.5, room: "Bureau", printed_m2: 20 } } }).in("id", [netFloorId, shabId]);
  expect(seeded.error).toBeNull();
  const read = async (id: string) => {
    const row = await owned.client.from("takeoff_items")
      .select("quantity,updated_at,is_verified,verification_justification,rule_results").eq("id", id).single();
    expect(row.error).toBeNull();
    return row.data!;
  };
  const targeted = (id: string) => `/dashboard/affaires/${ids.projectId}/takeoff/${job.jobId}/review/targeted?versionId=${ids.versionId}&line=${id}`;
  await ui.app.open(targeted(netFloorId));
  // Any save computes the version's rules again: the unchanged quantity is saved to read the printed surface.
  const computed = await apiRequest(ui.browser, "PATCH", `/api/takeoff/jobs/${job.jobId}/items`,
    { items: [{ item_id: netFloorId, updated_at: (await read(netFloorId)).updated_at, fields: { quantity: 19.5 } }] });
  expect(computed.status).toBe(200);
  for (const id of [netFloorId, shabId]) {
    expect((await read(id)).rule_results).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "area_printed",
      status: "fail", version: 3, details: expect.objectContaining({ printed_m2: 20, measured_m2: 19.5, expected_basis: "net_floor" }) })]));
  }

  const note = "Tableau des surfaces du plan fictif, indice B.";
  const refused = await apiRequest<{ data: { results: Array<{ success: boolean; error?: string }> } }>(ui.browser, "PATCH",
    `/api/takeoff/jobs/${job.jobId}/items`, { items: [{ item_id: netFloorId, updated_at: (await read(netFloorId)).updated_at,
      fields: { is_verified: true, verification_justification: { area_printed: { reason_code: "printed_area_basis_identified",
        retained_basis: "net_floor", note } } } }] });
  expect(refused.status).toBe(200);
  expect(refused.body.data.results[0]).toMatchObject({ success: false,
    error: "Même base que la prestation : les deux surfaces se comparent et la plus élevée est retenue. Retenez 20 m² avant d’accepter." });

  const accept = async (id: string, basis: "Sol net" | "SHAB", retain: boolean) => {
    await ui.app.open(targeted(id));
    await ui.screen.getByRole("region", "Décision sur la ligne", { exact: true }).getByRole("button", /^Accepter/).click();
    const dialog = ui.screen.getByRole("dialog");
    await expect(dialog.getByRole("heading", "Justifier l’acceptation")).toBeVisible();
    await dialog.getByLabel("Motif de surface", { exact: true }).selectOption({ value: "printed_area_basis_identified" });
    await dialog.getByRole("radio", basis, { exact: true }).click();
    await dialog.getByLabel("Note", { exact: true }).fill(note);
    const confirm = dialog.getByRole("button", "Confirmer l’acceptation", { exact: true });
    if (retain) {
      await expect(confirm).toBeDisabled();
      const saved = ui.browser.waitForResponse(`**/api/takeoff/jobs/${job.jobId}/items`);
      await dialog.getByRole("button", "Retenir 20 m²", { exact: true }).click();
      expect((await saved).status).toBe(200);
    }
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(ui.screen.getByText("Ligne acceptée avec justification", { exact: true })).toBeVisible();
  };
  await accept(netFloorId, "Sol net", true);
  expect(await read(netFloorId)).toMatchObject({ quantity: 20, is_verified: true,
    verification_justification: { area_printed: { reason_code: "printed_area_basis_identified", retained_basis: "net_floor", note } } });
  await accept(shabId, "SHAB", false);
  expect(await read(shabId)).toMatchObject({ quantity: 19.5, is_verified: true,
    verification_justification: { area_printed: { retained_basis: "shab" } } });
  await recordEvidence(ui.army, "TI680-declared-surface-basis", { ...ids, jobId: job.jobId,
    netFloor: await read(netFloorId), shab: await read(shabId) });
});

for (const fixture of cases) {
  armyTest(`TI680 applies the protected quantity and preserves ${fixture.name}`, { session: "army", tags: ["critical"], timeout: 180_000 }, async ui => {
    const { app, screen, browser, army } = ui;
    const { ids, owned, sectionId, lineId, job, route } = await prepareQuantityQuote(ui, fixture.reference, fixture.measured);
    await app.open(route);
    await expect(screen.getByText("Quantité proposée pour chiffrer", { exact: true })).toBeVisible();
    const comparisonPath = `/api/takeoff/jobs/${job.jobId}/dpgf-compare?version_id=${ids.versionId}&view=all`;
    const before = await apiRequest<{ data: TakeoffDpgfComparisonResponse }>(browser, "GET", comparisonPath);
    expect(before.status).toBe(200);
    // Without a reference nothing confirms the measurement: a person retains it explicitly before the apply.
    expect(before.body.data.rows[0]).toMatchObject({ dpgf_quantity: fixture.reference,
      takeoff_quantity: fixture.measured.reduce((sum, value) => sum + value, 0),
      review_status: fixture.reference === null ? "to_confirm" : "reliable_match" });
    if (fixture.reference === null) {
      const retained = await apiRequest(browser, "PATCH", `/api/takeoff/jobs/${job.jobId}/review-decision`,
        { version_id: ids.versionId, estimate_item_id: lineId, decision: "keep_takeoff", reason: "Mesure fictive retenue sans quantité DPGF." });
      expect(retained.status).toBe(200);
      await app.open(route);
    }
    await screen.getByRole("button", "Appliquer au chiffrage", { exact: true }).click();
    const dialog = screen.getByRole("dialog");
    await expect(dialog.getByLabel("Section cible", { exact: true })).toHaveValue(sectionId);
    await dialog.getByRole("button", "Suivant", { exact: true }).click();
    await expect(dialog.getByRole("radio", /Fusionner avec l'existant/)).toBeChecked();
    await dialog.getByRole("button", "Suivant", { exact: true }).click();
    await expect(dialog.getByText("Preview d'impact", { exact: true })).toBeVisible();
    await dialog.getByRole("button", "Suivant", { exact: true }).click();
    const applied = browser.waitForResponse(`**/api/takeoff/jobs/${job.jobId}/apply`);
    await dialog.getByRole("button", "Confirmer l'application", { exact: true }).click();
    expect((await applied).status).toBe(200);
    const final = await owned.client.from("estimate_items").select("id,quantity,source_provider,source_file_name,source_page,source_metadata,line_total_ht_cents")
      .eq("version_id", ids.versionId).eq("item_type", "line");
    expect(final.error).toBeNull();
    expect(final.data).toHaveLength(1);
    expect(final.data![0]).toMatchObject({ id: lineId, quantity: fixture.priced, source_provider: "dpgf",
      source_file_name: "dpgf-fictif.xlsx", source_page: 7,
      source_metadata: { dpgf_source_quantity: fixture.reference, takeoff_quantity_policy: {
        measured_quantity: fixture.measured.reduce((sum, value) => sum + value, 0), priced_quantity: fixture.priced } } });
    await app.open(route);
    const after = await apiRequest<{ data: TakeoffDpgfComparisonResponse }>(browser, "GET", comparisonPath);
    expect(after.status).toBe(200);
    expect(after.body.data.rows[0]).toMatchObject({ dpgf_quantity: fixture.reference,
      takeoff_quantity: fixture.measured.reduce((sum, value) => sum + value, 0) });
    await recordEvidence(army, "TI680-quantities-persisted", { ...ids, jobId: job.jobId, fixture, estimate: final.data,
      referenceAfterApply: after.body.data.rows[0].dpgf_quantity });
  });
}
