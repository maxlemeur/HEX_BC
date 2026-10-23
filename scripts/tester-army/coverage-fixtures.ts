import { createHash, randomUUID } from "node:crypto";
import {
  checked, componentsFixtures, executePlan, journeysFixtures, versionDefaults, writeFixture,
  type CalcV3FixtureContext, type CalcV3PhaseFixtures, type PlanRecord,
} from "./calc-v3-fixtures";
import { installGeneratedAtomicFault, readGeneratedAtomicFault } from "./coverage-native-fault";
import type { CoveragePhase } from "./coverage-phases";

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

async function generatedFixtures(context: CalcV3FixtureContext, campaign: string, recovery: boolean): Promise<CalcV3PhaseFixtures> {
  const owner = context.owner, prefix = `ARMY-GENERATED-ATOMIC-${campaign}`;
  const common = { tenant_id: owner.tenantId }, records: PlanRecord[] = [];
  const add = (table: string, row: Record<string, unknown>) => records.push({ table, row });
  const base = (label: string, sections: string[]) => {
    const projectId = randomUUID(), versionId = randomUUID();
    add("estimate_projects", { ...common, id: projectId, user_id: owner.userId, name: `${prefix} ${label}` });
    add("estimate_versions", { ...versionDefaults, ...common, id: versionId, project_id: projectId, title: label,
      calc_engine_version: 2, max_section_depth: 3, discount_bp: recovery ? 0 : 1667,
      discount_mode: "simple", discount_steps: [], tax_rate_bp: recovery ? 2000 : 0 });
    sections.forEach((id, index) => add("estimate_items", { ...common, id, version_id: versionId, item_type: "section",
      title: label === "generation" ? `${prefix} génération lot${index + 1}` : `${prefix} ${label} S`, position: index + 1, parent_id: null }));
    return { projectId, versionId };
  };
  const scenarios = (recovery ? ["lost", "malformed", "stale", "partial", "abandon"] : ["existing", "fallback"]).map((label) => {
    const sectionId = randomUUID(), draftId = randomUUID(), identity = base(label, [sectionId]);
    const lot = recovery || label === "existing" ? sectionId : null;
    const scope = { ...common, project_id: identity.projectId, target_version_id: identity.versionId };
    add("estimate_generated_ouvrage_drafts", { ...scope, id: draftId, created_by: owner.userId, source_kind: "internal_note",
      preferred_lot_id: lot, status: "pending", summary: {}, generation_metadata: { fixture: "Synthetic pending prerequisite; no model" } });
    const candidates = Array.from({ length: label === "partial" ? 2 : 1 }, (_, index) => {
      const candidate = { candidateId: randomUUID(), fragmentId: randomUUID(), subdetailId: randomUUID(), componentId: randomUUID(),
        designation: `${prefix} ${label} ouvrage ${index + 1}`, componentDesignation: `${prefix} ${label} fourniture ${index + 1}`,
        unitCostHtCents: recovery ? (index + 1) * 1000 : 3 };
      add("estimate_generated_ouvrage_source_fragments", { ...common, id: candidate.fragmentId, project_id: identity.projectId, draft_id: draftId,
        fragment_order: index, source_kind: "internal_note", label: "ARMY generated work", excerpt: candidate.designation, normalized_excerpt: candidate.designation.toLowerCase() });
      add("estimate_generated_ouvrage_candidates", { ...scope, id: candidate.candidateId, draft_id: draftId, candidate_order: index,
        suggested_lot_id: lot, lot_label: lot ? `${prefix} ${label} S` : null, designation: candidate.designation,
        normalized_designation: candidate.designation.toLowerCase(), unit: "u", quantity: 1, confidence: 1, ai_status: "certain",
        resolution_status: "pending", reasoning: "Prepared fixture; review in real UI" });
      add("estimate_generated_ouvrage_candidate_sources", { ...common, draft_id: draftId, candidate_id: candidate.candidateId,
        source_fragment_id: candidate.fragmentId, source_rank: 0 });
      add("estimate_generated_ouvrage_subdetail_drafts", { ...scope, id: candidate.subdetailId, draft_id: draftId, parent_work_id: candidate.candidateId,
        created_by: owner.userId, status: "pending_review", summary: {}, generation_metadata: { fixture: "Real human review still required" } });
      add("estimate_generated_ouvrage_subdetail_items", { ...common, project_id: identity.projectId, id: candidate.componentId, draft_id: draftId,
        subdetail_id: candidate.subdetailId, parent_work_id: candidate.candidateId, source_fragment_id: candidate.fragmentId, component_order: 0,
        status: "manual", designation: candidate.componentDesignation, cost_type: "material", quantity: 1, unit: "u",
        unit_cost_ht_cents: candidate.unitCostHtCents, loss_coeff_bp: 0, yield_value: null, yield_unit: null, confidence: 1,
        source_label: "ARMY generated work", facts: ["Synthetic supply prerequisite"], hypotheses: [], inferences: [] });
      return candidate;
    });
    return recovery ? { label, ...identity, sectionId, draftId, candidates }
      : { label, ...identity, sectionId, draftId, ...candidates[0], requestedLot: lot ? "section" : "fallback" };
  });
  const sectionA = randomUUID(), sectionB = randomUUID();
  const generation = recovery ? { ...base("generation", [sectionA, sectionB]), sectionA, sectionB } : undefined;
  const kind = recovery ? "recovery" : "atomic";
  await executePlan(context, `generated-${kind}`, records);
  const fault = recovery ? undefined : installGeneratedAtomicFault(context, scenarios.map((scenario) => scenario.versionId));
  const fixture = await writeFixture(context, `generated-${kind}`, { schemaVersion: `estimate-generated-${kind}-fixture-1`, status: "ready",
    campaign, prefix, apiUrl: context.backend, owner, scenarios, ...(generation ? { generation } : {}), planSha256: sha256(JSON.stringify(records)) });
  return { env: { [recovery ? "E2E_GENERATED_RECOVERY_FIXTURE_PATH" : "E2E_GENERATED_ATOMIC_FIXTURE_PATH"]: fixture }, secretEnv: {},
    identities: { owner, prefix, scenarios, generation, fault, prerequisiteRows: records.length } };
}

async function sourceCoverageFixtures(context: CalcV3FixtureContext, campaign: string): Promise<CalcV3PhaseFixtures> {
  // Reuse the tracked fictional PDF corpus and canonical prerequisite plan. No
  // result, coverage decision, generated application or library item is seeded.
  const { newCctpPlan, cctpCorpus } = await import("./cctp-seed-plan.mjs");
  const prefix = `ARMY-COVERAGE-${campaign}`;
  const membership = await checked("CCTP owner membership", context.admin.from("tenant_memberships").select("id")
    .eq("user_id", context.owner.userId).eq("tenant_id", context.owner.tenantId).single());
  const owner = { ...context.owner, membershipId: membership.id };
  type CctpPlan = Awaited<ReturnType<typeof newCctpPlan>> & { records: PlanRecord[];
    scenarios: Array<Awaited<ReturnType<typeof newCctpPlan>>["scenarios"][number] & { sources: { revision: string; documentId: string; storagePath: string }[] }> };
  const plan = await newCctpPlan({ campaign, owner, prefix, apiUrl: context.backend, approvalReference: "Owned ephemeral CI prerequisites" }) as CctpPlan;
  await executePlan(context, "source-coverage", plan.records);
  const { corpus } = await cctpCorpus();
  for (const scenario of plan.scenarios) {
    for (const source of scenario.sources) {
      const pdf = corpus.get(source.revision)!;
      await checked("CCTP storage upload", context.admin.storage.from("affaire-intake").upload(source.storagePath, pdf.bytes, { contentType: "application/pdf", upsert: false }));
      const downloaded = await checked("CCTP storage readback", context.admin.storage.from("affaire-intake").download(source.storagePath));
      if (sha256(new Uint8Array(await downloaded.arrayBuffer())) !== pdf.sha256) throw new Error("Owned CCTP storage hash differs.");
      await checked("CCTP document ready", context.admin.from("affaire_intake_documents").update({ upload_status: "uploaded" })
        .eq("id", source.documentId).eq("tenant_id", owner.tenantId).eq("project_id", scenario.projectId).select("id").single());
    }
  }
  const scenarios = Object.fromEntries(plan.scenarios.map((s: { label: string; projectId: string; versionId: string; sectionA: string; sectionB: string; draftId: string; candidateId: string; designation: string; sources: { revision: string; documentId: string }[] }) => [s.label, {
    projectId: s.projectId, versionId: s.versionId, sectionA: s.sectionA, sectionB: s.sectionB,
    draftId: s.draftId, candidateId: s.candidateId, designation: s.designation,
    documents: Object.fromEntries(s.sources.map((source) => [source.revision, source.documentId])),
  }]));
  const fixture = await writeFixture(context, "source-coverage", { schemaVersion: "source-coverage-fixture-1", status: "ready", campaign, prefix,
    apiUrl: context.backend, owner, scenarios, corpus: Object.fromEntries([...corpus].map(([revision, pdf]) => [revision, { sha256: pdf.sha256, bytes: pdf.byteSize }])) });
  return { env: { E2E_COVERAGE_FIXTURE_PATH: fixture }, secretEnv: {}, identities: { owner, prefix, scenarios, prerequisiteRows: plan.records.length } };
}

export async function prepareCoverageFixtures(phase: CoveragePhase, context: CalcV3FixtureContext, campaign: string): Promise<CalcV3PhaseFixtures> {
  if (phase === "mobile") return { env: {}, secretEnv: {}, identities: { owner: context.owner, viewport: "390x844" } };
  if (phase === "source-coverage") return sourceCoverageFixtures(context, campaign);
  if (phase === "generated-atomic" || phase === "generated-recovery") return generatedFixtures(context, campaign, phase === "generated-recovery");
  if (phase === "assembly-totals") return componentsFixtures(context, campaign, "assembly-totals");
  return journeysFixtures(context, campaign);
}

export function verifyCoverageFixtureEffects(phase: string, context: CalcV3FixtureContext, fixtures: CalcV3PhaseFixtures, filtered = false) {
  if (phase !== "generated-atomic") return null;
  const fault = fixtures.identities.fault as { sequence: string } | undefined;
  if (!fault) throw new Error("Atomic refusal fixture was not installed.");
  return readGeneratedAtomicFault(context, fault.sequence, filtered ? undefined : 2);
}
