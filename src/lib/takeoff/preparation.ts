import { z } from "zod";

import { takeoffPageTriageSchema } from "@/lib/takeoff/page-triage";
import { TAKEOFF_COUNT_UNIT_TOKENS, toUnitToken } from "@/lib/takeoff/units";
import { findPlanRevisionConflicts, hasCyclicPlanRevisionDecisions, planIdentitySchema, planRevisionDecisionSchema } from "@/lib/takeoff/plan-revision-identity";
import { chatGptPreferencesSchema } from "@/lib/ai/chatgpt-model-preferences";

export const TAKEOFF_PREPARATION_OBJECTIVES = {
  measure_all: "Tout mesurer",
  count: "Compter sur les plans",
  measure_length: "Mesurer des longueurs",
  measure_area: "Mesurer des surfaces",
  extract_quantities: "Lire des quantités documentaires",
  compare_dpgf: "Comparer au DPGF",
  prepare_purchase: "Préparer les achats",
  estimate: "Produire une estimation avec hypothèses",
} as const;

const objectiveSchema = z.enum([
  "measure_all", "count", "measure_length", "measure_area", "extract_quantities",
  "compare_dpgf", "prepare_purchase", "estimate",
]);
const textSchema = z.string().trim().min(1).max(4000);
const optionalTextSchema = textSchema.nullable();
const listSchema = z.array(textSchema).max(200);

export const takeoffPreparationSourceSchema = z.object({
  document_id: textSchema,
  document_name: textSchema,
  kind: z.enum(["plan", "dpgf", "cctp", "other"]),
  revision: optionalTextSchema,
  // The server resolves this against the actual file identity before confirmation.
  source_version: z.string().trim().max(2000),
  pages: z.array(z.number().int().positive()).max(2000),
  active: z.boolean(),
  confirmed: z.boolean(),
  plan_set_id: optionalTextSchema.default(null),
  file_path: optionalTextSchema.default(null),
  page_count: z.number().int().positive().nullable().default(null),
  logical_document_id: optionalTextSchema.default(null),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/i).nullable().default(null),
  source_updated_at: optionalTextSchema.default(null),
  mime_type: optionalTextSchema.default(null),
  // Decisions page triage proposal (TI-663). Only an acceptance writes pages/active.
  page_triage: takeoffPageTriageSchema.nullable().default(null),
  plan_identity: planIdentitySchema.nullable().optional(),
  declared_logical_document_id: optionalTextSchema.optional(),
  inferred_logical_reference: z.boolean().optional(),
  alternate_of: optionalTextSchema.optional(),
  pages_before_deduplication: z.array(z.number().int().positive()).max(2000).optional(),
  selected_in_plan_set: z.boolean().optional(),
  // The title-block index the member settled (kept the retained index or took this one): their choice is the
  // recorded index for these bytes, and the confirmation keeps it.
  revision_reading_settled: z.string().trim().min(1).max(40).optional(),
}).strict();

const scopeSchema = z.object({
  buildings: listSchema.optional(),
  lots: listSchema,
  networks: listSchema,
  levels: listSchema,
  zones: listSchema,
  inclusions: listSchema,
  exclusions: listSchema,
  confirmed: z.boolean(),
}).strict();

const conventionsSchema = z.object({
  unit: optionalTextSchema,
  unit_mode: z.literal("per_item").optional(),
  measurement_basis: z.enum(["unknown", "dimensioned", "calibrated", "documented", "documentary_evidence"]),
  calibration: z.object({
    document_id: optionalTextSchema,
    page: z.number().int().positive().nullable(),
    reference_length: z.number().positive().nullable(),
    reference_unit: z.enum(["m", "cm", "mm"]).nullable(),
    measured_span: z.number().positive().nullable(),
    measured_span_unit: z.enum(["pdf_points", "paper_mm"]).nullable().default(null),
  }).strict().nullable(),
  purchase: z.object({
    deductions: z.string().trim().max(4000),
    waste_percent: z.number().min(0).max(100).nullable(),
    rounding: z.string().trim().max(4000),
    packaging: z.string().trim().max(4000),
  }).strict().nullable(),
  confirmed: z.boolean(),
}).strict();

export const takeoffPreparationUnknownSchema = z.object({
  id: textSchema,
  question: textSchema,
  impact: z.enum(["blocking", "reservation"]),
  status: z.enum(["open", "answered", "accepted", "excluded"]),
  answer: optionalTextSchema,
  responsible: optionalTextSchema,
  source_document_id: optionalTextSchema,
  page: z.number().int().positive().nullable(),
}).strict();

export const takeoffPreparationAssistanceTraceSchema = z.object({
  provenance: z.object({
    tenant_id: textSchema,
    project_id: textSchema,
    revision: z.number().int().positive().nullable(),
    source_fingerprint: z.string().trim().min(1).max(128),
    preparation_fingerprint: z.string().trim().min(1).max(128),
    generated_at: z.iso.datetime({ offset: true }),
    provider: z.enum(["chatgpt", "gemini"]).nullable(),
    model: optionalTextSchema,
    prompt_version: textSchema,
    token_count: z.number().int().nonnegative().nullable(),
    decisions_request_fingerprint: z.string().trim().min(1).max(128).nullable(),
    decisions_model: optionalTextSchema,
  }).strict(),
  accepted_proposal_ids: z.array(textSchema).max(200),
}).strict();

export const takeoffPreparationProcessingSchema = z.object({
  level: z.enum(["A", "B", "C"]).nullable(),
  provider: z.enum(["auto", "chatgpt", "gemini"]),
}).strict();

export const takeoffPreparationSchema = z.object({
  schema_version: z.literal(1),
  provenance: z.object({
    kind: z.literal("dossier"), rule_version: z.literal(1), converted_from_legacy: z.boolean(), plan_set_id: textSchema,
    brief_context: z.object({ buildings: listSchema, lots: listSchema, zones: listSchema }).strict(),
  }).strict().optional(),
  plan_revision_decisions: z.array(planRevisionDecisionSchema).max(500).optional(),
  objective: objectiveSchema.nullable(),
  objective_confirmed: z.boolean(),
  scope: scopeSchema,
  sources: z.array(takeoffPreparationSourceSchema).max(500),
  conventions: conventionsSchema,
  unknowns: z.array(takeoffPreparationUnknownSchema).max(200),
  destination: z.object({
    kind: z.enum(["analysis_only", "estimate_review"]),
    estimate_version_id: optionalTextSchema,
    reviewer: optionalTextSchema,
    confirmed: z.boolean(),
  }).strict(),
  profile: z.object({
    id: textSchema,
    name: textSchema,
    version: z.number().int().positive(),
  }).strict().nullable(),
  assistance: takeoffPreparationAssistanceTraceSchema.nullable().default(null),
  processing: z.preprocess(
    (value) => value === null ? undefined : value,
    takeoffPreparationProcessingSchema.default({ level: null, provider: "auto" })
  ),
}).strict();

export type TakeoffPreparation = z.infer<typeof takeoffPreparationSchema>;
export type TakeoffPreparationSource = z.infer<typeof takeoffPreparationSourceSchema>;
export type TakeoffPreparationUnknown = z.infer<typeof takeoffPreparationUnknownSchema>;

export type TakeoffPreparationIssue = {
  code: string;
  path: string;
  message: string;
  source_document_id?: string;
};

export type TakeoffPreparationReadiness = {
  status: "incomplete" | "ready_with_reservations" | "ready";
  can_launch: boolean;
  blockers: TakeoffPreparationIssue[];
  reservations: TakeoffPreparationIssue[];
};

export function createEmptyTakeoffPreparation(input: {
  estimateVersionId?: string | null;
} = {}): TakeoffPreparation {
  return {
    schema_version: 1,
    objective: null,
    objective_confirmed: false,
    processing: { level: null, provider: "auto" },
    scope: {
      buildings: [],
      lots: [], networks: [], levels: [], zones: [], inclusions: [], exclusions: [],
      confirmed: false,
    },
    sources: [],
    conventions: {
      unit: null,
      measurement_basis: "unknown",
      calibration: null,
      purchase: null,
      confirmed: false,
    },
    unknowns: [],
    destination: {
      kind: "analysis_only",
      estimate_version_id: input.estimateVersionId ?? null,
      reviewer: null,
      confirmed: false,
    },
    profile: null,
    assistance: null,
  };
}

function hasRecordedDecision(unknown: TakeoffPreparationUnknown) {
  return Boolean(unknown.answer?.trim() && unknown.responsible?.trim());
}

/** Shared by the UI, confirmation, launch and replay: AI ranking never alters it. */
/** A title-block index that differs from the retained one and that the member has not settled yet. */
export function getUnresolvedRevisionReading(source: Pick<TakeoffPreparationSource, "kind" | "revision" | "plan_identity" | "revision_reading_settled">) {
  const reading = source.kind === "plan" ? source.plan_identity?.revision : null;
  return reading && source.revision && reading !== source.revision && source.revision_reading_settled !== reading ? reading : null;
}

export function evaluateTakeoffPreparation(
  preparation: TakeoffPreparation
): TakeoffPreparationReadiness {
  const blockers: TakeoffPreparationIssue[] = [];
  const reservations: TakeoffPreparationIssue[] = [];
  const block = (code: string, path: string, message: string, sourceId?: string) => {
    blockers.push({ code, path, message, ...(sourceId ? { source_document_id: sourceId } : {}) });
  };
  const deduced = preparation.provenance?.kind === "dossier";
  const measureAll = preparation.objective === "measure_all";

  if (!preparation.objective) {
    block("objective_required", "objective", "Choisissez le résultat attendu du métré.");
  } else if (!(deduced && measureAll) && !preparation.objective_confirmed) {
    block("objective_confirmation_required", "objective", "Confirmez le résultat attendu.");
  }
  const { scope } = preparation;
  if (![scope.buildings ?? [], scope.lots, scope.networks, scope.levels, scope.zones, scope.inclusions].some((values) => values.length > 0)) {
    block("scope_required", "scope", "Précisez les lots, réseaux ou zones à analyser, ou indiquez explicitement tout le dossier.");
  }
  if (!deduced && !scope.confirmed) {
    block("scope_confirmation_required", "scope", "Confirmez le périmètre et ses exclusions.");
  }

  const activeSources = preparation.sources.filter((source) => source.active);
  if (activeSources.length === 0) {
    block("sources_required", "sources", "Sélectionnez au moins une pièce de référence.");
  }
  const seenIds = new Set<string>();
  const logicalSources = new Map<string, TakeoffPreparationSource>();
  for (const source of activeSources) {
    const path = `sources.${source.document_id}`;
    if (seenIds.has(source.document_id)) {
      block("source_duplicate", path, "Une même pièce est sélectionnée plusieurs fois.", source.document_id);
    }
    seenIds.add(source.document_id);
    if (!deduced && !source.confirmed) {
      block("source_confirmation_required", path, `Confirmez la source « ${source.document_name} » et sa version.`, source.document_id);
    }
    if (!source.source_version.trim() && deduced && source.document_id.startsWith("upload:")) {
      block("source_unavailable", path, `Le fichier téléversé « ${source.document_name} » est indisponible dans le dossier. Retirez-le des sources actives ou ajoutez-le au jeu de plans et vérifiez les pages retenues.`, source.document_id);
    } else if (!source.source_version.trim() && deduced) {
      block("source_unavailable", path, `La pièce « ${source.document_name} » n’est plus dans le dossier. Retirez-la de la préparation dans « Mes documents ».`, source.document_id);
    } else if (!source.source_version.trim()) {
      block("source_version_required", path, `L'identité du fichier « ${source.document_name} » doit être vérifiée.`, source.document_id);
    }
    const reading = deduced ? getUnresolvedRevisionReading(source) : null;
    if (reading) {
      block("source_revision_mismatch", path, `Le cartouche de « ${source.document_name} » indique l’indice ${reading}, la préparation retient l’indice ${source.revision}. Choisissez l’indice à garder dans « Mes documents ».`, source.document_id);
    }
    if (new Set(source.pages).size !== source.pages.length || source.pages.some((page) => page < 1 || (source.page_count !== null && page > source.page_count))) {
      block("source_pages_invalid", `${path}.pages`, `Vérifiez les pages retenues de « ${source.document_name} ».`, source.document_id);
    }
    if (!deduced && !source.revision) {
      const revisionDecision = preparation.unknowns.find((unknown) => unknown.id === `source_revision:${source.document_id}`);
      if (revisionDecision?.impact !== "reservation" || revisionDecision.status !== "accepted" || !hasRecordedDecision(revisionDecision)) {
        block("source_revision_unknown", `${path}.revision`, `L'indice de « ${source.document_name} » est inconnu : renseignez-le ou acceptez une réserve attribuée.`, source.document_id);
      }
    }
    const logicalKey = source.logical_document_id ?? source.document_name.trim().toLocaleLowerCase("fr");
    const prior = logicalSources.get(logicalKey);
    if (!deduced && prior && (prior.revision !== source.revision || prior.source_version !== source.source_version)) {
      block("source_revision_conflict", path, `Choisissez la version applicable de « ${source.document_name} » ; les révisions ne peuvent pas se cumuler.`, source.document_id);
    } else {
      logicalSources.set(logicalKey, source);
    }
  }
  if (deduced) {
    const plans = activeSources.filter((source) => source.kind === "plan");
    const decisions = preparation.plan_revision_decisions ?? [];
    if (hasCyclicPlanRevisionDecisions(plans, decisions)) {
      block("source_revision_conflict", "sources", "Les choix d’indices se contredisent. Gardez une version de chaque plan.");
    }
    for (const [left, right] of findPlanRevisionConflicts(plans, decisions)) {
      block("source_revision_conflict", `sources.${right.document_id}`, `Choisissez entre « ${left.document_name} » et « ${right.document_name} », ou indiquez qu’il s’agit de deux plans distincts.`, right.document_id);
    }
  }

  const objective = preparation.objective;
  if (objective && ["measure_all", "count", "measure_length", "measure_area", "compare_dpgf"].includes(objective) && !activeSources.some((source) => source.kind === "plan")) {
    block("plan_required", "sources", "Ajoutez un plan actif pour ce résultat.");
  }
  if (objective === "compare_dpgf" && !activeSources.some((source) => source.kind === "dpgf")) {
    block("dpgf_required", "sources", "La comparaison nécessite le DPGF de référence.");
  }

  const conventions = preparation.conventions;
  if (measureAll) {
    if (conventions.unit_mode !== "per_item" || conventions.unit || conventions.measurement_basis !== "documentary_evidence" || conventions.purchase || conventions.calibration) {
      block("measure_all_conventions_invalid", "conventions", "Tout mesurer utilise l’unité de chaque ouvrage et les preuves du dossier.");
    }
  } else if (!conventions.unit?.trim()) {
    block("unit_required", "conventions.unit", "Précisez l'unité des quantités attendues.");
  } else {
    const unit = toUnitToken(conventions.unit);
    if ((objective === "count" && !(TAKEOFF_COUNT_UNIT_TOKENS as readonly string[]).includes(unit)) ||
      (objective === "measure_length" && !["m", "ml", "mm", "cm", "km", "ft", "in"].includes(unit)) ||
      (objective === "measure_area" && !["m2", "mm2", "cm2", "km2", "ft2", "ha"].includes(unit))) {
      block("unit_incompatible", "conventions.unit", "Choisissez une unité compatible avec le comptage, la longueur ou la surface demandée.");
    }
  }
  if (!(deduced && measureAll) && !conventions.confirmed) {
    block("conventions_confirmation_required", "conventions", "Confirmez la méthode et les conventions applicables.");
  }
  if (objective === "measure_length" || objective === "measure_area") {
    if (!["dimensioned", "calibrated"].includes(conventions.measurement_basis)) {
      block("calibration_required", "conventions.measurement_basis", "Une mesure géométrique nécessite des cotes fiables ou une calibration.");
    } else if (conventions.measurement_basis === "calibrated") {
      const calibration = conventions.calibration;
      if (calibration && !calibration.measured_span_unit) {
        block("calibration_span_unit_required", "conventions.calibration.measured_span_unit", "Précisez l'unité de la portée sur la page PDF d'origine : points PDF ou millimètres à 100 %, jamais des pixels d'écran.");
      }
      if (!calibration || !calibration.document_id || calibration.page === null || !calibration.reference_unit || calibration.reference_length === null || !Number.isFinite(calibration.reference_length) || calibration.reference_length <= 0 || calibration.measured_span === null || !Number.isFinite(calibration.measured_span) || calibration.measured_span <= 0) {
        block("calibration_required", "conventions.calibration", "Renseignez une référence et une distance de calibration strictement positives.");
      } else {
        const calibratedSource = activeSources.find((source) => source.document_id === calibration.document_id && source.kind === "plan");
        if (!calibratedSource || (calibratedSource.pages.length > 0 && !calibratedSource.pages.includes(calibration.page)) || (calibratedSource.page_count !== null && calibration.page > calibratedSource.page_count)) {
          block("calibration_source_invalid", "conventions.calibration", "La calibration doit viser une page retenue d'un plan actif.", calibration.document_id);
        }
        // A calibration belongs to one page. It cannot silently establish other scales.
        const uncovered = activeSources.filter((source) => source.kind === "plan").some((source) =>
          source.document_id !== calibration.document_id ||
          (source.pages.length > 0 ? source.pages.some((page) => page !== calibration.page) : source.page_count !== 1)
        );
        if (uncovered) {
          block("calibration_coverage_required", "conventions.calibration", "Cette calibration couvre une seule page : retenez cette page ou utilisez des cotes fiables pour l'ensemble du périmètre.");
        }
      }
    }
  }
  if (objective === "prepare_purchase") {
    const purchase = conventions.purchase;
    if (!purchase || !purchase.deductions.trim() || purchase.waste_percent === null || !Number.isFinite(purchase.waste_percent) || purchase.waste_percent < 0 || !purchase.rounding.trim() || !purchase.packaging.trim()) {
      block("purchase_conventions_required", "conventions.purchase", "Les achats nécessitent les déductions, pertes, arrondis et conditionnements ; zéro perte doit être indiqué explicitement.");
    }
  }

  for (const unknown of preparation.unknowns) {
    if (unknown.id.startsWith("source_revision:")) {
      const source = preparation.sources.find((entry) => entry.document_id === unknown.id.slice("source_revision:".length));
      if (source && (!source.active || source.revision)) continue;
      if (deduced && unknown.status === "open") continue;
    }
    const path = `unknowns.${unknown.id}`;
    if (unknown.status === "open") {
      block("unknown_unresolved", path, unknown.question, unknown.source_document_id ?? undefined);
    } else if (!hasRecordedDecision(unknown)) {
      block("reservation_decision_required", path, `Enregistrez une réponse et un responsable : ${unknown.question}`, unknown.source_document_id ?? undefined);
    } else if (unknown.status === "accepted") {
      if (unknown.impact === "blocking") {
        block("unknown_unresolved", path, `Ce prérequis nécessite une réponse ou une exclusion explicite : ${unknown.question}`, unknown.source_document_id ?? undefined);
      } else {
        reservations.push({ code: "accepted_reservation", path, message: unknown.question, ...(unknown.source_document_id ? { source_document_id: unknown.source_document_id } : {}) });
      }
    }
  }
  if (!(deduced && preparation.destination.kind === "analysis_only" && !preparation.destination.estimate_version_id && !preparation.destination.reviewer) && !preparation.destination.confirmed) {
    block("destination_confirmation_required", "destination", "Confirmez la destination du métré et la revue avant toute application.");
  }
  if (preparation.destination.kind === "estimate_review" && !preparation.destination.estimate_version_id) {
    block("destination_version_required", "destination.estimate_version_id", "Choisissez la version de devis qui recevra les propositions après revue.");
  }
  return {
    status: blockers.length > 0 ? "incomplete" : reservations.length > 0 ? "ready_with_reservations" : "ready",
    can_launch: blockers.length === 0,
    blockers,
    reservations,
  };
}

export class TakeoffPreparationNotReadyError extends Error {
  readonly readiness: TakeoffPreparationReadiness;

  constructor(readiness: TakeoffPreparationReadiness) {
    super(readiness.blockers[0]?.message ?? "La préparation du métré est incomplète.");
    this.name = "TakeoffPreparationNotReadyError";
    this.readiness = readiness;
  }
}

export type TakeoffPreparationSnapshot = {
  schema_version: 1;
  preparation_revision: number;
  confirmed_by: string;
  confirmed_at: string;
  preparation: TakeoffPreparation;
  readiness: TakeoffPreparationReadiness;
  execution_selection?: TakeoffExecutionSelection;
};

export const takeoffExecutionSelectionSchema = chatGptPreferencesSchema.extend({
  profileId: textSchema,
  hostId: textSchema,
  /** The authorization of the connection a launch request's mandate was given under (launch-request.ts). */
  authorizationId: textSchema.optional(),
}).strict();

export type TakeoffExecutionSelection = z.infer<typeof takeoffExecutionSelectionSchema>;

export function publicTakeoffPreparationSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || !("execution_selection" in snapshot)) return snapshot;
  const publicSnapshot: Record<string, unknown> = { ...snapshot };
  delete publicSnapshot.execution_selection;
  return publicSnapshot;
}

/** Sources must already be reconciled with authorized server-side file identities. */
export function createTakeoffPreparationSnapshot(input: {
  preparation: TakeoffPreparation;
  confirmedBy: string;
  confirmedAt: string;
  revision: number;
  executionSelection?: TakeoffExecutionSelection;
}): TakeoffPreparationSnapshot {
  const preparation = takeoffPreparationSchema.parse(input.preparation);
  const readiness = evaluateTakeoffPreparation(preparation);
  if (!readiness.can_launch) throw new TakeoffPreparationNotReadyError(readiness);
  if (!input.confirmedBy.trim() || !Number.isFinite(Date.parse(input.confirmedAt)) || !Number.isInteger(input.revision) || input.revision < 1) {
    throw new Error("L'auteur, la date et la révision de confirmation sont requis.");
  }
  return {
    schema_version: 1,
    preparation_revision: input.revision,
    confirmed_by: input.confirmedBy,
    confirmed_at: input.confirmedAt,
    preparation,
    readiness,
    ...(input.executionSelection ? { execution_selection: takeoffExecutionSelectionSchema.parse(input.executionSelection) } : {}),
  };
}

// Profiles deliberately omit file identities, destinations and project decisions.
export const takeoffPreparationProfileSchema = z.object({
  schema_version: z.literal(1),
  id: textSchema,
  name: textSchema,
  version: z.number().int().positive(),
  objective: objectiveSchema.nullable(),
  scope: scopeSchema.omit({ levels: true, zones: true, confirmed: true }),
  conventions: conventionsSchema.omit({ calibration: true, confirmed: true }),
}).strict();
export type TakeoffPreparationProfile = z.infer<typeof takeoffPreparationProfileSchema>;

export function createTakeoffPreparationProfile(input: {
  preparation: TakeoffPreparation;
  id: string;
  name: string;
  version: number;
}): TakeoffPreparationProfile {
  const { scope, conventions } = input.preparation;
  return takeoffPreparationProfileSchema.parse({
    schema_version: 1,
    id: input.id,
    name: input.name,
    version: input.version,
    objective: input.preparation.objective,
    scope: { lots: scope.lots, networks: scope.networks, inclusions: scope.inclusions, exclusions: scope.exclusions },
    conventions: { unit: conventions.unit, unit_mode: conventions.unit_mode, measurement_basis: conventions.measurement_basis, purchase: conventions.purchase },
  });
}

export function applyTakeoffPreparationProfile(
  preparation: TakeoffPreparation,
  savedProfile: TakeoffPreparationProfile
): TakeoffPreparation {
  const profile = takeoffPreparationProfileSchema.parse(savedProfile);
  const result = takeoffPreparationSchema.parse(preparation);
  result.profile = { id: profile.id, name: profile.name, version: profile.version };
  result.objective = profile.objective;
  result.objective_confirmed = false;
  result.scope = { ...result.scope, ...profile.scope, confirmed: false };
  result.conventions = {
    ...profile.conventions,
    ...(profile.objective === "measure_all" && !profile.conventions.unit_mode ? { unit_mode: "per_item" as const } : {}),
    calibration: null,
    confirmed: false,
  };
  return result;
}
