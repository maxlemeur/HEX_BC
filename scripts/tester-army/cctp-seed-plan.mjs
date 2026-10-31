import { randomUUID } from "node:crypto";
import { readFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { isDeepStrictEqual } from "node:util";
import { repositoryRoot as root, requireValue, sha256, loopbackOrigin, readProof, nonSecretMetadata } from "./local-recipe-common.mjs";

export const cctpScenarios = ["nominal", "reference", "register", "l2_quantity", "l1_quantity", "l4_quantity", "l2_price", "recovery", "read_failure", "stale", "form_change"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function assertCctpLaborSelection(roles, owner) {
  requireValue(Array.isArray(roles), "CCTP ordinary labor-role read is required.");
  const active = roles.filter((role) => role.user_id === owner.userId && role.tenant_id === owner.tenantId && role.is_active === true);
  requireValue(active.every((role) => uuid.test(role.id) && Number.isInteger(role.position)), "CCTP active labor-role ordering is invalid.");
  active.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  requireValue(active[0]?.id === owner.laborRoleId && active[0]?.hourly_rate_cents === 4000, "CCTP effective first active owner labor role differs; no repair.");
  return active[0];
}
export async function cctpCorpus() {
  const base = path.join(root, "e2e/fixtures/source-coverage"), bytes = await readFile(path.join(base, "manifest.json"));
  const manifest = JSON.parse(bytes), corpus = new Map();
  requireValue(manifest.schemaVersion === "source-reference-corpus-1" && manifest.documents.length === 2, "Tracked CCTP corpus required.");
  for (const entry of manifest.documents) {
    requireValue(["A", "B"].includes(entry.revision) && entry.path === `${entry.revision}/ARMY-CCTP-calorifuge.pdf`, "CCTP corpus path differs.");
    const requested = path.join(base, entry.path), file = await realpath(requested);
    requireValue(!(await lstat(requested)).isSymbolicLink() && file.startsWith(await realpath(base) + path.sep), "CCTP corpus escaped.");
    const data = await readFile(file), pdf = await PDFDocument.load(data);
    requireValue(sha256(data) === entry.sha256 && data.length === entry.byteSize && entry.pageCount === 3 && pdf.getPageCount() === 3 && !pdf.isEncrypted, "CCTP corpus bytes/pages differ.");
    corpus.set(entry.revision, { ...entry, bytes: data });
  }
  requireValue(corpus.size === 2 && corpus.get("A").sha256 !== corpus.get("B").sha256, "Distinct CCTP A/B required.");
  return { sha256: sha256(bytes), corpus };
}
export async function newCctpPlan({ campaign, owner, prefix, apiUrl, approvalReference, ...chain }) {
  const source = await cctpCorpus();
  const scenarios = cctpScenarios.map((label) => ({ label, projectId: randomUUID(), versionId: randomUUID(), sectionA: randomUUID(), sectionB: randomUUID(),
    draftId: randomUUID(), candidateId: randomUUID(), fragmentId: randomUUID(), subdetailId: randomUUID(), componentIds: [randomUUID(), randomUUID(), randomUUID()],
    designation: "ARMY Réseau CH-A avec calorifuge", sources: ["A", "B"].map((revision) => ({ revision, uploadId: randomUUID(), documentId: randomUUID() })) }));
  const plan = { schemaVersion: "army-local-cctp-plan-1", status: "prepared-no-mutation", scenarioSet: "source-coverage", campaign, owner, prefix, apiUrl, approvalReference,
    createdAt: new Date().toISOString(), corpusSha256: source.sha256, scenarios, ...chain };
  plan.records = await cctpRecords(plan); return plan;
}
export async function cctpRecords(plan) {
  // Node 26 strips this module's erasable TypeScript natively. Using tsx here
  // would require esbuild for both Windows and the SQL helper's Linux host.
  const imported = await import(pathToFileURL(path.join(root, "src/lib/affaires/intake.ts")).href);
  const intake = imported.default ?? imported;
  requireValue(intake.AFFAIRE_INTAKE_BUCKET === "affaire-intake", "Canonical intake bucket differs.");
  const { corpus } = await cctpCorpus(), o = plan.owner, records = [];
  const add = (table, row) => records.push({ table, row });
  for (const s of plan.scenarios) {
    const common = { tenant_id: o.tenantId }, context = { ...common, project_id: s.projectId, target_version_id: s.versionId }, name = `${plan.prefix} ${s.label}`;
    add("estimate_projects", { ...common, id: s.projectId, user_id: o.userId, name });
    add("estimate_versions", { ...common, id: s.versionId, project_id: s.projectId, version_number: 1, title: name, status: "draft", currency: "EUR", calc_engine_version: 2, max_section_depth: 1, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0 });
    for (const [index, id] of [s.sectionA, s.sectionB].entries()) add("estimate_items", { ...common, id, version_id: s.versionId, item_type: "section", parent_id: null, title: `${name} S${index === 0 ? "A" : "B"}`, position: index + 1 });
    add("estimate_generated_ouvrage_drafts", { ...context, id: s.draftId, created_by: o.userId, source_kind: "internal_note", preferred_lot_id: s.sectionA, status: "pending", summary: {}, generation_metadata: { fixture: "Synthetic prepared draft, no model invoked" } });
    add("estimate_generated_ouvrage_source_fragments", { ...common, project_id: s.projectId, draft_id: s.draftId, id: s.fragmentId, fragment_order: 0, source_kind: "internal_note", label: "ARMY oracle synthétique", excerpt: s.designation, normalized_excerpt: s.designation.toLowerCase() });
    add("estimate_generated_ouvrage_candidates", { ...context, id: s.candidateId, draft_id: s.draftId, candidate_order: 0, suggested_lot_id: s.sectionA, lot_label: `${name} SA`, designation: s.designation, normalized_designation: s.designation.toLowerCase(), unit: "m", quantity: 10, confidence: 1, ai_status: "certain", resolution_status: "pending", reasoning: "Oracle synthétique, aucune génération" });
    add("estimate_generated_ouvrage_candidate_sources", { ...common, draft_id: s.draftId, candidate_id: s.candidateId, source_fragment_id: s.fragmentId, source_rank: 0 });
    add("estimate_generated_ouvrage_subdetail_drafts", { ...context, id: s.subdetailId, draft_id: s.draftId, parent_work_id: s.candidateId, created_by: o.userId, status: "pending_review", summary: {}, generation_metadata: { fixture: "Human review is required in the application" } });
    for (const [index, component] of [
      { designation: "ARMY calorifuge 30 mm CH-A", cost_type: "material", quantity: 10, unit: "m", unit_cost_ht_cents: 800 },
      { designation: "ARMY canalisation CH-A", cost_type: "material", quantity: 10, unit: "m", unit_cost_ht_cents: 1200 },
      { designation: "ARMY pose réseau CH-A", cost_type: "labor", quantity: 5, unit: "h", unit_cost_ht_cents: 4000 },
    ].entries()) add("estimate_generated_ouvrage_subdetail_items", { ...component, ...common, project_id: s.projectId, draft_id: s.draftId, subdetail_id: s.subdetailId, parent_work_id: s.candidateId, source_fragment_id: s.fragmentId, id: s.componentIds[index], component_order: index, status: "manual", loss_coeff_bp: 0, yield_value: null, yield_unit: null, confidence: 1, source_label: "ARMY oracle synthétique", facts: ["Valeur de recette synthétique"], hypotheses: [], inferences: [] });
    for (const source of s.sources) {
      const pdf = corpus.get(source.revision), storagePath = intake.buildAffaireIntakeStoragePath({ tenantId: o.tenantId, projectId: s.projectId, uploadId: source.uploadId, documentId: source.documentId, fileName: pdf.fileName });
      source.storagePath = storagePath;
      requireValue(storagePath === `${o.tenantId}/${s.projectId}/${source.uploadId}/${source.documentId}/${pdf.fileName}`, "Canonical new Storage path differs.");
      add("affaire_intake_uploads", { ...common, id: source.uploadId, project_id: s.projectId, created_by: o.userId, status: "ready", attempt_count: 0, next_retry_at: null, last_error: null, completed_at: plan.createdAt });
      add("affaire_intake_documents", { ...common, id: source.documentId, project_id: s.projectId, upload_id: source.uploadId, created_by: o.userId, storage_path: storagePath, file_name: pdf.fileName, mime_type: "application/pdf", size_bytes: pdf.byteSize, upload_status: "pending", rejection_reason: null, classification_status: "classified", document_kind: "cctp", document_priority: source.revision === "A" ? "primary" : "secondary", confidence: 1, issues: [], extracted_metadata: intake.createEmptyAffaireIntakeExtractedMetadata(), classification_source: "manual", classified_by: o.userId, classified_at: plan.createdAt, manually_overridden_at: plan.createdAt });
    }
  }
  return records;
}
export async function validateCctpPlan(plan) {
  nonSecretMetadata(plan);
  requireValue(plan.schemaVersion === "army-local-cctp-plan-1" && plan.status === "prepared-no-mutation" && plan.scenarioSet === "source-coverage" && plan.prefix?.startsWith("ARMY-COVERAGE-") && plan.approvalReference?.trim() && Number.isFinite(Date.parse(plan.createdAt)), "Explicit prepared CCTP plan required.");
  const origin = loopbackOrigin(plan.apiUrl); requireValue(origin.hostname === "127.0.0.1", "Native CCTP API must use 127.0.0.1.");
  requireValue(Object.keys(plan.owner ?? {}).sort().join() === "laborRoleId,membershipId,tenantId,userId" && Object.values(plan.owner).every((id) => uuid.test(id)), "Exact existing CCTP owner required.");
  requireValue(isDeepStrictEqual(plan.scenarios.map((s) => s.label), cctpScenarios), "Eleven exact CCTP scenarios required.");
  for (const s of plan.scenarios) requireValue(Object.keys(s).sort().join() === "candidateId,componentIds,designation,draftId,fragmentId,label,projectId,sectionA,sectionB,sources,subdetailId,versionId" && s.designation === "ARMY Réseau CH-A avec calorifuge" && s.componentIds.length === 3 && s.sources.length === 2 && s.sources.every((source, i) => source.revision === ["A", "B"][i] && Object.keys(source).sort().join() === "documentId,revision,storagePath,uploadId"), "CCTP exact scenario shape differs.");
  const canonical = structuredClone(plan), expected = await cctpRecords(canonical);
  requireValue(plan.corpusSha256 === (await cctpCorpus()).sha256 && isDeepStrictEqual(expected, plan.records) && isDeepStrictEqual(canonical.scenarios, plan.scenarios) && expected.length === 176, "Tracked CCTP corpus, Storage paths or exact prerequisite records differ.");
  const ids = expected.map((r) => r.row.id).filter(Boolean);
  requireValue(ids.every((id) => uuid.test(id)) && new Set(ids).size === ids.length && ids.every((id) => !Object.values(plan.owner).includes(id)), "CCTP prerequisite identities must be new and independent.");
  return expected;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length === 7 && process.argv[2] === "--validate" && process.argv[3] === "--plan" && process.argv[5] === "--plan-sha", "Use --validate --plan <path> --plan-sha <sha>; no backend action.");
    const proof = await readProof(process.argv[4], process.argv[6]);
    const records = await validateCctpPlan(proof.data);
    console.log(JSON.stringify({ status: "validated-offline", databaseAccess: false, records }));
  } catch { console.error("CCTP exact plan refused before backend access."); process.exitCode = 3; }
}
