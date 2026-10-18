import { expect } from "e2e";
import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyVersion } from "../critical/fixtures";
import { signUpDedicatedOwner } from "./dedicated-owner";

type Envelope<T> = { ok: boolean; data: T };
type Created = { project: { id: string }; version: ArmyVersion };
const settings = { margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, tax_rate_bp: 2000,
  discount_bp: 0, global_coefficient: 1, rounding_mode: "none", rounding_step_cents: 1 };

armyTest("PG1000 a 2501-row DPGF keeps late duplicates, every item, exact money and its full template", {
  session: "army", tags: ["critical", "large-row-completeness"], trace: "off", timeout: 600_000,
}, async ({ app, browser, army }) => {
  await app.open("/dashboard");
  await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "PG1000" });
  const blank = await apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", {
    project: { name: `${army.runPrefix}-pagination` }, version: settings,
  });
  expect(blank.status).toBe(201); expect(blank.body.ok).toBe(true);
  ownEstimate(army, { projectId: blank.body.data.project.id, versionId: blank.body.data.version.id });
  const rows = Array.from({ length: 2501 }, (_, index) => ({
    ref: index === 2500 ? "PG-0000" : `PG-${String(index).padStart(4, "0")}`,
    label: index === 2500 ? "Poste 0" : `Poste ${index}`, qty: "1", unit: "u", price: "1,00",
  }));
  const imported = await apiRequest<Envelope<{ id: string; row_count: number }>>(browser, "POST", "/api/imports", {
    filename: `${army.runPrefix}.json`, project_id: blank.body.data.project.id, rows,
  });
  expect(imported.status).toBe(201); expect(imported.body.data.row_count).toBe(2501);
  const mapping = { ref: "hex_code", label: "designation", qty: "quantity", unit: "unit", price: "unit_price_ht" };
  const duplicates = await apiRequest<Envelope<{ scanned_rows: number; total_groups: number; total_rows_impacted: number }>>(
    browser, "POST", "/api/mappings", { action: "duplicates", import_id: imported.body.data.id, mapping, limit: 10000 });
  await recordEvidence(army, "pg1000-late-duplicate", duplicates);
  expect(duplicates.status).toBe(200); expect(duplicates.body.data).toMatchObject({ scanned_rows: 2501, total_groups: 1, total_rows_impacted: 2 });
  const mapped = await apiRequest<Envelope<{ mapped_rows_count: number }>>(browser, "POST", "/api/mappings", {
    action: "create", import_id: imported.body.data.id, mapping, save_template: false,
  });
  expect(mapped.status).toBe(201); expect(mapped.body.data.mapped_rows_count).toBe(2501);
  const created = await apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", {
    project_id: blank.body.data.project.id, creation_mode: "linked_dpgf_source", version: settings,
  });
  await recordEvidence(army, "pg1000-linked-create", created);
  expect(created.status).toBe(201); expect(created.body.ok).toBe(true);
  ownEstimate(army, { projectId: created.body.data.project.id, versionId: created.body.data.version.id });
  const state = await readEstimate(browser, created.body.data.version.id);
  const lines = state.items.filter(item => item.item_type === "line");
  expect(lines).toHaveLength(2501); expect(new Set(lines.map(line => line.id)).size).toBe(2501);
  expect(lines.filter(line => line.title === "Poste 0")).toHaveLength(2);
  expect(lines.some(line => line.title === "Poste 2499")).toBe(true);
  expect([state.version.total_ht_cents, state.version.total_tax_cents, state.version.total_ttc_cents]).toEqual([250100, 50020, 300120]);
  const saved = await apiRequest<Envelope<{ template: { id: string } }>>(browser, "POST", "/api/estimates/templates", {
    source_version_id: state.version.id, name: `${army.runPrefix}-modele-complet`,
  });
  expect(saved.status).toBe(201);
  const templateId = saved.body.data.template.id;
  const template = await apiRequest<Envelope<{ template: { items: Array<{ id: string; item_type: string }> } }>>(browser, "GET", `/api/estimates/templates/${templateId}`);
  expect(template.status).toBe(200); expect(template.body.data.template.items.filter(item => item.item_type === "line")).toHaveLength(2501);
  const instantiated = await apiRequest<Envelope<{ projectId: string; versionId: string }>>(browser, "POST", `/api/estimates/templates/${templateId}/instantiate`, {
    project_name: `${army.runPrefix}-modele-instancie`,
  });
  expect(instantiated.status).toBe(201);
  ownEstimate(army, { projectId: instantiated.body.data.projectId, versionId: instantiated.body.data.versionId });
  const copy = await readEstimate(browser, instantiated.body.data.versionId);
  expect(copy.items.filter(item => item.item_type === "line")).toHaveLength(2501);
  expect([copy.version.total_ht_cents, copy.version.total_tax_cents, copy.version.total_ttc_cents]).toEqual([250100, 50020, 300120]);
  await recordEvidence(army, "pg1000-complete", { importId: imported.body.data.id, templateId, expected: 2501,
    actualIds: lines.map(line => line.id), templateItems: template.body.data.template.items.length,
    totals: [copy.version.total_ht_cents, copy.version.total_tax_cents, copy.version.total_ttc_cents] });
});
