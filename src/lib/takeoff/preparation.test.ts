import { describe, expect, it } from "vitest";
import { buildDeducedTakeoffPreparation, resolveDeducedPlanVersions } from "@/lib/takeoff/preparation-from-dossier";
import { isSameDocument } from "@/lib/takeoff/page-contributions";

import {
  applyTakeoffPreparationProfile,
  createEmptyTakeoffPreparation,
  createTakeoffPreparationProfile,
  createTakeoffPreparationSnapshot,
  evaluateTakeoffPreparation,
  takeoffPreparationSchema,
  type TakeoffPreparation,
} from "@/lib/takeoff/preparation";

function countingPreparation(): TakeoffPreparation {
  const preparation = createEmptyTakeoffPreparation({ estimateVersionId: "version-a" });
  preparation.objective = "count";
  preparation.objective_confirmed = true;
  preparation.scope = {
    lots: ["Plomberie"], networks: ["ECS"], levels: ["R+1"], zones: ["Zone 1"],
    inclusions: ["Compter les appareils sanitaires"], exclusions: ["RDC", "Zone 2"],
    confirmed: true,
  };
  preparation.sources = [{
    document_id: "plan-a",
    document_name: "Plan plomberie R+1.pdf",
    kind: "plan",
    revision: "B",
    source_version: "plan-a:sha256-content:path-revision-b",
    pages: [1],
    active: true,
    confirmed: true,
    plan_set_id: "set-a",
    file_path: "tenant/project/set-a/revision-b.pdf",
    page_count: 2,
    logical_document_id: "PLO-R1",
    content_hash: null,
    source_updated_at: "2026-10-29T09:00:00Z",
    mime_type: "application/pdf",
    page_triage: null,
  }];
  preparation.conventions.unit = "u";
  preparation.conventions.confirmed = true;
  preparation.destination.confirmed = true;
  return preparation;
}

function blockerCodes(preparation: TakeoffPreparation) {
  return evaluateTakeoffPreparation(preparation).blockers.map((issue) => issue.code);
}

describe("takeoff preparation business admission", () => {
  it("takes a plan without an index and leaves documentary assumptions unaccepted", () => {
    const plan = { ...countingPreparation().sources[0], revision: null, pages: [], confirmed: false, active: false };
    const preparation = buildDeducedTakeoffPreparation({ sources: [plan], planSetId: "set-a", lots: ["Plomberie"] });
    const snapshot = createTakeoffPreparationSnapshot({ preparation, revision: 1, confirmedBy: "metreur", confirmedAt: "2026-11-20T10:00:00Z" });
    expect(snapshot.preparation).toMatchObject({
      objective: "measure_all", objective_confirmed: false, provenance: { kind: "dossier", rule_version: 1, brief_context: { lots: ["Plomberie"] } },
      scope: { lots: [], exclusions: [], confirmed: false },
      sources: [{ revision: null, pages: [], active: true, confirmed: false }],
      conventions: { unit: null, unit_mode: "per_item", measurement_basis: "documentary_evidence", calibration: null, purchase: null },
      processing: { level: "C", provider: "chatgpt" },
      unknowns: [], destination: { kind: "analysis_only", estimate_version_id: null, reviewer: null },
    });
    expect(snapshot.readiness.reservations).toEqual([]);
  });

  it("retains every source identity while measuring identical plan bytes once", () => {
    const a = { ...countingPreparation().sources[0], document_id: "a", content_hash: "a".repeat(64), pages: [1] };
    const b = { ...a, document_id: "b", pages: [2] };
    const draft = buildDeducedTakeoffPreparation({ sources: [b, a], planSetId: "set-a" });
    const resolved = resolveDeducedPlanVersions(draft);
    expect(resolved.sources).toMatchObject([{ document_id: "b", active: false, alternate_of: "a" }, { document_id: "a", active: true, pages: [1, 2] }]);
    expect(draft.sources.every((source) => source.active)).toBe(true);
  });

  it.each([false, true])("retains distinct page identities after variant selection (extra revision: %s)", (extraRevision) => {
    const plan = countingPreparation().sources[0];
    const a = { ...plan, document_id: "a", logical_document_id: "PLO-R1", content_hash: "a".repeat(64) };
    const b = { ...plan, document_id: "b", document_name: "Plan distribution.pdf", logical_document_id: extraRevision ? "PLO-R1" : "plo-r1", content_hash: "b".repeat(64) };
    const c = { ...b, document_id: "c", document_name: "Détail installateur.pdf", content_hash: "c".repeat(64) };
    const draft = buildDeducedTakeoffPreparation({ sources: extraRevision ? [a, b, c] : [a, b], planSetId: "set-a" });
    const fingerprint = ({ document_id, content_hash }: typeof a) => ({ document_id, content_hash });
    draft.plan_revision_decisions = [{ left: fingerprint(a), right: fingerprint(b), choice: "distinct" }];
    if (extraRevision) draft.plan_revision_decisions.push({ left: fingerprint(b), right: fingerprint(c), choice: "left" });
    const resolved = resolveDeducedPlanVersions(draft);
    const active = resolved.sources.filter((source) => source.active);
    expect(active.map((source) => source.document_id)).toEqual(["a", "b"]);
    const [left, right] = active.map((source) => ({
      plan_file_id: source.document_id, content_hash: source.content_hash, logical_document_id: source.logical_document_id, file_name: source.document_name,
    }));
    expect(isSameDocument(left, right)).toBe(false);
    expect(resolveDeducedPlanVersions(takeoffPreparationSchema.parse(resolved))).toEqual(takeoffPreparationSchema.parse(resolved));
  });

  it("keeps exclusions when switching between plan sets", () => {
    const a = { ...countingPreparation().sources[0], document_id: "a" };
    const b = { ...a, document_id: "b" };
    const c = { ...a, document_id: "c", plan_set_id: "set-b" };
    const sources = [a, b, c];
    const initial = buildDeducedTakeoffPreparation({ sources, planSetId: "set-a" });
    initial.sources[1].active = false;
    const switched = buildDeducedTakeoffPreparation({ sources, saved: initial, planSetId: "set-b" });
    const restored = buildDeducedTakeoffPreparation({ sources, saved: switched, planSetId: "set-a" });
    expect(restored.sources.filter((source) => source.active).map((source) => source.document_id)).toEqual(["a"]);
  });

  it("blocks cyclic revision decisions even when another plan remains", () => {
    const source = countingPreparation().sources[0];
    const plans = ["a", "b", "c", "d"].map((id) => ({
      ...source, document_id: id, content_hash: id.repeat(64), logical_document_id: id === "d" ? "OTHER" : "P-101",
    }));
    const draft = buildDeducedTakeoffPreparation({ sources: plans, planSetId: "set-a" });
    const fingerprint = ({ document_id, content_hash }: typeof plans[number]) => ({ document_id, content_hash });
    draft.plan_revision_decisions = [[0, 1], [1, 2], [2, 0]].map(([left, right]) => ({
      left: fingerprint(plans[left]), right: fingerprint(plans[right]), choice: "left",
    }));
    const resolved = resolveDeducedPlanVersions(draft);
    expect(blockerCodes(resolved)).toContain("source_revision_conflict");
    expect(resolved.sources.filter(({ active }) => active)).toHaveLength(4);
  });

  it("preserves the legacy upload's selected page and the confirmed Ouest scope verbatim", () => {
    const previous = countingPreparation();
    previous.scope = { ...previous.scope, inclusions: [], zones: ["Ouest"], confirmed: true };
    const dossierPlan = previous.sources[0];
    const hash = "a".repeat(64);
    const upload = { ...dossierPlan, document_id: `upload:${hash}`, source_version: hash,
      pages: [3], page_count: 4, plan_set_id: null, file_path: null };
    previous.sources = [upload];
    const converted = buildDeducedTakeoffPreparation({
      sources: [dossierPlan], planSetId: "set-a", saved: takeoffPreparationSchema.parse(previous),
    });
    expect(converted.sources.find(({ document_id }) => document_id === upload.document_id)).toMatchObject({ active: true, pages: [3] });
    expect(converted.scope).toEqual(previous.scope);
    expect(evaluateTakeoffPreparation(converted).can_launch).toBe(false);
  });

  it("clears the scope confirmation when the conversion has to add the default inclusion", () => {
    const previous = countingPreparation();
    previous.scope = { ...previous.scope, lots: [], networks: [], levels: [], zones: [], inclusions: [], exclusions: ["RDC"], confirmed: true };
    const converted = buildDeducedTakeoffPreparation({ sources: previous.sources, planSetId: "set-a", saved: takeoffPreparationSchema.parse(previous) });
    expect(converted.scope).toMatchObject({ inclusions: ["Toutes les pages et tous les ouvrages des plans retenus"], exclusions: ["RDC"], confirmed: false });
  });

  it("round-trips the per-item measurement convention through a saved business profile", () => {
    const draft = buildDeducedTakeoffPreparation({ sources: countingPreparation().sources, planSetId: "set-a" });
    const profile = createTakeoffPreparationProfile({ preparation: draft, id: "profile-a", name: "Métré détaillé", version: 1 });
    expect(profile.conventions.unit_mode).toBe("per_item");
    const applied = applyTakeoffPreparationProfile(draft, JSON.parse(JSON.stringify(profile)));
    expect(applied.conventions.unit_mode).toBe("per_item");
    expect(blockerCodes(applied)).not.toContain("measure_all_conventions_invalid");
  });

  it("does not treat a proposal as a confirmed business decision", () => {
    const preparation = countingPreparation();
    preparation.objective_confirmed = false;
    preparation.scope.confirmed = false;
    preparation.sources[0].confirmed = false;
    expect(blockerCodes(preparation)).toEqual(expect.arrayContaining([
      "objective_confirmation_required", "scope_confirmation_required", "source_confirmation_required",
    ]));
  });

  it("rejects a unit incompatible with the requested geometry", () => {
    const preparation = countingPreparation();
    preparation.conventions.unit = "m";
    expect(blockerCodes(preparation)).toContain("unit_incompatible");
    preparation.objective = "measure_area";
    preparation.conventions.measurement_basis = "dimensioned";
    preparation.conventions.unit = "ml";
    expect(blockerCodes(preparation)).toContain("unit_incompatible");
    preparation.conventions.unit = "m²";
    expect(evaluateTakeoffPreparation(preparation).can_launch).toBe(true);
  });

  it("ties calibration to a retained page and refuses to reuse its scale on another page", () => {
    const preparation = countingPreparation();
    preparation.objective = "measure_length";
    preparation.conventions.unit = "m";
    preparation.conventions.measurement_basis = "calibrated";
    preparation.conventions.calibration = {
      document_id: "plan-a", page: 1, reference_length: 5,
      reference_unit: "m", measured_span: 230, measured_span_unit: "pdf_points",
    };
    expect(evaluateTakeoffPreparation(preparation).can_launch).toBe(true);
    preparation.sources[0].pages = [1, 2];
    expect(blockerCodes(preparation)).toContain("calibration_coverage_required");
    preparation.sources[0].pages = [2];
    expect(blockerCodes(preparation)).toContain("calibration_source_invalid");
  });

  it("refuses zero or missing calibration rather than inventing a measured quantity", () => {
    const preparation = countingPreparation();
    preparation.objective = "measure_area";
    preparation.conventions.unit = "m2";
    preparation.conventions.measurement_basis = "calibrated";
    expect(blockerCodes(preparation)).toContain("calibration_required");
    preparation.conventions.calibration = {
      document_id: "plan-a", page: 1, reference_length: 0,
      reference_unit: "m", measured_span: 10, measured_span_unit: "paper_mm",
    };
    expect(blockerCodes(preparation)).toContain("calibration_required");
    expect(takeoffPreparationSchema.safeParse(preparation).success).toBe(false);
  });

  it("saves partially answered calibration without converting unknown distances to zero", () => {
    const preparation = countingPreparation();
    preparation.objective = "measure_length";
    preparation.conventions.unit = "m";
    preparation.conventions.measurement_basis = "calibrated";
    preparation.conventions.calibration = {
      document_id: "plan-a", page: 1, reference_length: null,
      reference_unit: "m", measured_span: null, measured_span_unit: null,
    };
    const draft = takeoffPreparationSchema.parse(preparation);
    expect(draft.conventions.calibration?.reference_length).toBeNull();
    expect(draft.conventions.calibration?.measured_span).toBeNull();
    expect(blockerCodes(draft)).toContain("calibration_required");
  });

  it.each(["pdf_points", "paper_mm"] as const)("admits a calibration expressed in original PDF physical units: %s", (unit) => {
    const preparation = countingPreparation();
    preparation.objective = "measure_length";
    preparation.conventions.unit = "m";
    preparation.conventions.measurement_basis = "calibrated";
    preparation.conventions.calibration = {
      document_id: "plan-a", page: 1, reference_length: 5,
      reference_unit: "m", measured_span: 230, measured_span_unit: unit,
    };
    expect(evaluateTakeoffPreparation(preparation).can_launch).toBe(true);
  });

  it("retains old drafts with an unknown span unit while blocking calibrated measurement only", () => {
    const preparation = countingPreparation();
    const draft = takeoffPreparationSchema.parse({
      ...preparation,
      conventions: {
        ...preparation.conventions,
        calibration: {
          document_id: "plan-a", page: 1, reference_length: 5,
          reference_unit: "m", measured_span: 230,
        },
      },
    });
    expect(draft.conventions.calibration?.measured_span_unit).toBeNull();
    expect(evaluateTakeoffPreparation(draft).can_launch).toBe(true);
    draft.objective = "measure_length";
    draft.conventions.unit = "m";
    draft.conventions.measurement_basis = "calibrated";
    expect(blockerCodes(draft)).toContain("calibration_span_unit_required");
    expect(takeoffPreparationSchema.safeParse({ ...draft, conventions: {
      ...draft.conventions, calibration: { ...draft.conventions.calibration, measured_span_unit: "viewport_pixels" },
    } }).success).toBe(false);
  });

  it("requires a DPGF for comparison and preserves independent counting eligibility", () => {
    const preparation = countingPreparation();
    preparation.objective = "compare_dpgf";
    expect(blockerCodes(preparation)).toContain("dpgf_required");
    preparation.sources.push({
      ...preparation.sources[0], document_id: "dpgf-a", logical_document_id: "DPGF",
      document_name: "DPGF.xlsx", kind: "dpgf", source_version: "dpgf:hash",
    });
    expect(evaluateTakeoffPreparation(preparation).can_launch).toBe(true);
  });

  it("retains an unknown source revision until a named person accepts the reservation", () => {
    const preparation = countingPreparation();
    preparation.sources[0].revision = null;
    expect(blockerCodes(preparation)).toContain("source_revision_unknown");
    preparation.unknowns.push({
      id: "source_revision:plan-a", question: "Indice non communiqué sur le plan reçu",
      impact: "reservation", status: "accepted", answer: "Utiliser la pièce reçue le 29/10, à contrôler avant devis",
      responsible: "Conducteur travaux", source_document_id: "plan-a", page: 1,
    });
    const readiness = evaluateTakeoffPreparation(preparation);
    expect(readiness.can_launch).toBe(true);
    expect(readiness.status).toBe("ready_with_reservations");
    expect(readiness.reservations[0].source_document_id).toBe("plan-a");
  });

  it("keeps two incompatible revisions out of the same analysis", () => {
    const preparation = countingPreparation();
    preparation.sources.push({
      ...preparation.sources[0], document_id: "plan-old", document_name: "Plomberie précédent.pdf",
      revision: "A", source_version: "old-hash",
    });
    expect(blockerCodes(preparation)).toContain("source_revision_conflict");
    preparation.sources[1].active = false;
    expect(evaluateTakeoffPreparation(preparation).can_launch).toBe(true);
    expect(preparation.sources[1].revision).toBe("A");
  });

  it("keeps the revision decision history without blocking when its source revision is now known", () => {
    const preparation = countingPreparation();
    preparation.sources[0].revision = null;
    preparation.unknowns.push({
      id: "source_revision:plan-a", question: "Quel indice retenir ?", impact: "reservation",
      status: "open", answer: null, responsible: null, source_document_id: "plan-a", page: null,
    });
    expect(blockerCodes(preparation)).toContain("unknown_unresolved");
    preparation.sources[0].revision = "B";
    expect(evaluateTakeoffPreparation(preparation).status).toBe("ready");
    expect(preparation.unknowns).toHaveLength(1);
  });

  it("rejects pages outside the actual document or duplicated pages", () => {
    const preparation = countingPreparation();
    preparation.sources[0].pages = [3];
    expect(blockerCodes(preparation)).toContain("source_pages_invalid");
    preparation.sources[0].pages = [1, 1];
    expect(blockerCodes(preparation)).toContain("source_pages_invalid");
  });

  it("does not allow accepting an essential unknown as a reservation", () => {
    const preparation = countingPreparation();
    preparation.unknowns.push({
      id: "height", question: "Quelle hauteur pour les colonnes ?", impact: "blocking",
      status: "accepted", answer: "À vérifier plus tard", responsible: "Responsable étude",
      source_document_id: "plan-a", page: 1,
    });
    expect(blockerCodes(preparation)).toContain("unknown_unresolved");
    preparation.unknowns[0].status = "answered";
    preparation.unknowns[0].answer = "Hauteur de 2,80 m confirmée sur coupe C01";
    expect(evaluateTakeoffPreparation(preparation).can_launch).toBe(true);
  });

  it("requires a recorded answer and owner before considering an unknown treated", () => {
    const preparation = countingPreparation();
    preparation.unknowns.push({
      id: "supports", question: "Supports mutualisés ?", impact: "reservation",
      status: "accepted", answer: null, responsible: null,
      source_document_id: null, page: null,
    });
    expect(blockerCodes(preparation)).toContain("reservation_decision_required");
  });

  it("does not ignore an unresolved question that claims an unknown source revision id", () => {
    const preparation = countingPreparation();
    preparation.unknowns.push({
      id: "source_revision:missing", question: "Question sans référence valide", impact: "blocking",
      status: "open", answer: null, responsible: null, source_document_id: null, page: null,
    });
    expect(blockerCodes(preparation)).toContain("unknown_unresolved");
  });

  it("requires an explicit destination and target version for estimate review", () => {
    const preparation = countingPreparation();
    preparation.destination.kind = "estimate_review";
    preparation.destination.estimate_version_id = null;
    expect(blockerCodes(preparation)).toContain("destination_version_required");
    preparation.destination.estimate_version_id = "version-b";
    preparation.destination.confirmed = false;
    expect(blockerCodes(preparation)).toContain("destination_confirmation_required");
  });
});

describe("takeoff preparation snapshots and reusable profiles", () => {
  it("stores bounded AI acceptance provenance in the same snapshot without granting confirmation", () => {
    const preparation = countingPreparation();
    preparation.assistance = {
      provenance: {
        tenant_id: "tenant-a", project_id: "project-a", revision: 3,
        source_fingerprint: "sources-hash", preparation_fingerprint: "preparation-hash",
        generated_at: "2026-10-29T10:00:00Z", provider: "chatgpt", model: "selected-model",
        prompt_version: "takeoff_preparation_assistance_v1", token_count: 400,
        decisions_request_fingerprint: null, decisions_model: null,
      },
      accepted_proposal_ids: ["proposal:scope-lot"],
    };
    const snapshot = createTakeoffPreparationSnapshot({
      preparation, confirmedBy: "user-a", confirmedAt: "2026-10-29T10:02:00Z", revision: 4,
    });
    preparation.assistance.accepted_proposal_ids.push("proposal:another");
    expect(snapshot.preparation.assistance?.accepted_proposal_ids).toEqual(["proposal:scope-lot"]);
    preparation.scope.confirmed = false;
    expect(evaluateTakeoffPreparation(preparation).can_launch).toBe(false);
    expect(takeoffPreparationSchema.safeParse({
      ...preparation, assistance: { ...preparation.assistance, access_token: "must-not-persist" },
    }).success).toBe(false);
  });

  it("reuses a versioned profile without carrying sources, local zones, calibration or confirmations", () => {
    const preparation = countingPreparation();
    preparation.processing = { level: "C", provider: "chatgpt" };
    preparation.conventions.calibration = {
      document_id: "plan-a", page: 1, reference_length: 3,
      reference_unit: "m", measured_span: 200, measured_span_unit: "paper_mm",
    };
    const profile = createTakeoffPreparationProfile({ preparation, id: "profile-a", name: "Comptage plomberie", version: 2 });
    expect(profile).not.toHaveProperty("processing");
    const next = createEmptyTakeoffPreparation({ estimateVersionId: "version-new" });
    next.processing = { level: "B", provider: "gemini" };
    next.scope.levels = ["R+3"];
    const applied = applyTakeoffPreparationProfile(next, profile);
    expect(applied.profile).toEqual({ id: "profile-a", name: "Comptage plomberie", version: 2 });
    expect(applied.processing).toEqual({ level: "B", provider: "gemini" });
    expect(applied.scope.lots).toEqual(["Plomberie"]);
    expect(applied.scope.levels).toEqual(["R+3"]);
    expect(applied.scope.zones).toEqual([]);
    expect(applied.sources).toEqual([]);
    expect(applied.conventions.calibration).toBeNull();
    expect(applied.objective_confirmed).toBe(false);
    expect(applied.scope.confirmed).toBe(false);
    expect(applied.conventions.confirmed).toBe(false);
    expect(applied.destination.estimate_version_id).toBe("version-new");
    expect(evaluateTakeoffPreparation(applied).can_launch).toBe(false);
  });
});
