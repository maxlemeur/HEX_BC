import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { loopbackOrigin, nonSecretMetadata, requireValue } from "./local-recipe-common.mjs";
export const componentsLabels = ["GC01", "GC02", "GC03", "GC04"];
export const componentsTitles = [
  "GC01 excluded components survive restoration reload application exports and library reuse",
  "GC02 retained zero-cost labor preserves one hour identity provenance and library reuse",
  "GC03 all excluded components refuse human validation and application",
  "GC04 an older application intention refuses a changed component selection",
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{64}$/;
const componentValues = [["material", 1, "u", 4000], ["labor", 1, "h", 4000], ["material", 1, "u", 8000], ["labor", 2, "h", 4000]];

export function componentsRecords(plan) {
  const records = [], common = { tenant_id: plan.owner.tenantId };
  const add = (table, row) => records.push({ table, row });
  const base = (s, label) => {
    add("estimate_projects", { ...common, id: s.projectId, user_id: plan.owner.userId, name: `${plan.prefix} ${label}` });
    add("estimate_versions", { ...common, id: s.versionId, project_id: s.projectId, version_number: 1, title: label, status: "draft", currency: "EUR", calc_engine_version: 2,
      max_section_depth: 3, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [], global_coefficient: 1,
      tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0 });
    add("estimate_items", { ...common, id: s.sectionId, version_id: s.versionId, item_type: "section", title: `${plan.prefix} ${label} S`, position: 1, parent_id: null });
  };
  for (const s of plan.scenarios) {
    base(s, s.label);
    const context = { ...common, project_id: s.projectId, target_version_id: s.versionId };
    add("estimate_generated_ouvrage_drafts", { ...context, id: s.draftId, created_by: plan.owner.userId, source_kind: "internal_note", preferred_lot_id: s.sectionId,
      status: "pending", summary: {}, generation_metadata: { fixture: "Synthetic proposals; human decisions only in real UI" } });
    add("estimate_generated_ouvrage_candidates", { ...context, id: s.candidateId, draft_id: s.draftId, candidate_order: 0, suggested_lot_id: s.sectionId,
      lot_label: `${plan.prefix} ${s.label} S`, designation: s.designation, normalized_designation: s.designation.toLowerCase(), unit: "u", quantity: 1,
      confidence: 1, ai_status: "certain", resolution_status: "pending", reasoning: "Prepared proposals; no reviewed or applied result" });
    add("estimate_generated_ouvrage_subdetail_drafts", { ...context, id: s.subdetailId, draft_id: s.draftId, parent_work_id: s.candidateId,
      created_by: plan.owner.userId, status: "pending_review", summary: {}, generation_metadata: { fixture: "Actual human review still required" } });
    for (const [index, c] of s.components.entries()) {
      add("estimate_generated_ouvrage_source_fragments", { ...common, id: c.fragmentId, project_id: s.projectId, draft_id: s.draftId, fragment_order: index,
        source_kind: "internal_note", label: `${s.label} proposal ${index + 1}`, excerpt: c.designation, normalized_excerpt: c.designation.toLowerCase() });
      add("estimate_generated_ouvrage_candidate_sources", { ...common, draft_id: s.draftId, candidate_id: s.candidateId, source_fragment_id: c.fragmentId, source_rank: index });
      add("estimate_generated_ouvrage_subdetail_items", { ...common, id: c.componentId, project_id: s.projectId, draft_id: s.draftId, subdetail_id: s.subdetailId,
        parent_work_id: s.candidateId, source_fragment_id: c.fragmentId, component_order: index, status: "suggested", designation: c.designation,
        cost_type: c.costType, quantity: c.quantity, unit: c.unit, unit_cost_ht_cents: c.unitCostHtCents, loss_coeff_bp: 0, yield_value: null, yield_unit: null,
        confidence: 1, source_label: `${s.label} proposal ${index + 1}`, facts: [c.designation], hypotheses: [], inferences: [] });
      add("estimate_generated_ouvrage_subdetail_item_sources", { ...common, id: c.sourceLinkId, draft_id: s.draftId, subdetail_id: s.subdetailId,
        parent_work_id: s.candidateId, component_id: c.componentId, source_fragment_id: c.fragmentId, source_rank: 0, evidence_kind: "fact", note: c.designation });
    }
  }
  base(plan.reuse, "reuse");
  return records;
}

export function validateComponentsPlan(plan) {
  nonSecretMetadata(plan);
  requireValue(plan.schemaVersion === "estimate-generated-components-plan-1" && plan.status === "prepared-no-mutation" && plan.approvalReference?.trim() &&
    ["entry", "full", "assembly-totals", "numeric-price", "numeric-decimals", "numeric-loss", "numeric-all"].includes(plan.selection) && plan.prefix?.startsWith("ARMY-GENERATED-COMPONENTS-"), "Explicit component plan and case selection required.");
  loopbackOrigin(plan.apiUrl);
  requireValue(Object.keys(plan.owner ?? {}).sort().join() === "laborRoleId,membershipId,tenantId,userId" && Object.values(plan.owner).every((v) => uuid.test(v)), "Existing owner identities required.");
  for (const key of ["ownerFixture", "stackReceipt", "nativeRecipe"]) requireValue(typeof plan[`${key}Path`] === "string" && plan[`${key}Path`].startsWith(".e2e/") && sha.test(plan[`${key}Sha256`] ?? ""), "Exact local component chain required.");
  for (const key of ["nativeSupportSha256", "nativeHelperSha256", "nativePrimitivesSha256"]) requireValue(sha.test(plan[key] ?? ""), "Reviewed seed source SHA required.");
  requireValue(typeof plan.nativeNodePath === "string" && /^\/[a-zA-Z0-9_./-]+\/node$/.test(plan.nativeNodePath), "Explicit qualified Linux Node path required.");
  requireValue(Array.isArray(plan.scenarios) && isDeepStrictEqual(plan.scenarios.map((s) => s.label), componentsLabels), "Four exact component scenarios required.");
  const ids = Object.values(plan.owner);
  for (const s of plan.scenarios) {
    requireValue(Object.keys(s).sort().join() === "candidateId,components,designation,draftId,label,projectId,sectionId,subdetailId,versionId" &&
      s.designation === `${plan.prefix} ${s.label} ouvrage` && s.components?.length === 4, "Exact component candidate required.");
    ids.push(...["projectId", "versionId", "sectionId", "draftId", "candidateId", "subdetailId"].map((key) => s[key]));
    for (const [index, c] of s.components.entries()) {
      requireValue(Object.keys(c).sort().join() === "componentId,costType,designation,fragmentId,quantity,sourceLinkId,unit,unitCostHtCents" &&
        c.designation === `${plan.prefix} ${s.label} proposition ${index + 1}` &&
        isDeepStrictEqual([c.costType, c.quantity, c.unit, c.unitCostHtCents], componentValues[index]), "Exact suggested component oracle required.");
      ids.push(c.componentId, c.fragmentId, c.sourceLinkId);
    }
  }
  requireValue(Object.keys(plan.reuse ?? {}).sort().join() === "projectId,sectionId,versionId", "Empty reuse witness required.");
  ids.push(...Object.values(plan.reuse));
  requireValue(ids.every((v) => uuid.test(v ?? "")) && new Set(ids).size === ids.length, "New distinct component identities required.");
  requireValue(isDeepStrictEqual(plan.records, componentsRecords(plan)), "Prerequisites differ; final results and preinserted decisions forbidden.");
  return plan;
}

export function newComponentsPlan(config) {
  const plan = { ...config, schemaVersion: "estimate-generated-components-plan-1", status: "prepared-no-mutation",
    scenarios: componentsLabels.map((label) => ({ label, projectId: randomUUID(), versionId: randomUUID(), sectionId: randomUUID(), draftId: randomUUID(),
      candidateId: randomUUID(), subdetailId: randomUUID(), designation: `${config.prefix} ${label} ouvrage`,
      components: componentValues.map(([costType, quantity, unit, unitCostHtCents], index) => ({ componentId: randomUUID(), fragmentId: randomUUID(), sourceLinkId: randomUUID(),
        designation: `${config.prefix} ${label} proposition ${index + 1}`, costType, quantity, unit, unitCostHtCents })) })),
    reuse: { projectId: randomUUID(), versionId: randomUUID(), sectionId: randomUUID() } };
  plan.records = componentsRecords(plan);
  return validateComponentsPlan(plan);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length === 5 && process.argv[2] === "--validate", "Supply --validate <exact-plan> <sha>; no DB access.");
    const bytes = await readFile(process.argv[3]);
    requireValue(createHash("sha256").update(bytes).digest("hex") === process.argv[4], "Plan SHA differs.");
    validateComponentsPlan(JSON.parse(bytes));
    console.log(JSON.stringify({ status: "validated-offline", databaseAccess: false }));
  } catch { console.error("Component plan validation failed; no database access."); process.exitCode = 3; }
}
