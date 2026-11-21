import { getAffaireDossierState, type AffaireDossierState, type AffaireIntakeReviewableDocument } from "@/lib/affaires/intake";
import type { TakeoffPreparationSource } from "@/lib/takeoff/preparation";

/**
 * The launch requests of a takeoff (migration 20261121083011_takeoff_launch_requests.sql): one execution of an affaire's
 * analysis on a sealed manifest. The automatic request is the one start of an affaire, when its dossier is confirmed; a
 * manual request is one explicit command (a relaunch). This module holds what the server and the screens decide alike.
 */
export const TAKEOFF_LAUNCH_REQUEST_STATES = ["evaluating", "not_eligible", "blocked", "admitted", "closed"] as const;
export type TakeoffLaunchRequestState = (typeof TAKEOFF_LAUNCH_REQUEST_STATES)[number];

/** The dossier does not allow an analysis yet: a change of the dossier evaluates it again. */
export const TAKEOFF_LAUNCH_DOSSIER_REASONS = [
  "DOSSIER_EMPTY", "DOSSIER_PROCESSING", "DOSSIER_TO_REVIEW", "BRIEF_NOT_CONFIRMED", "NO_EXPLOITABLE_PLAN",
  "PLAN_COPY_MISSING", "PREPARATION_NEEDS_REVIEW", "REFERENCE_UNAVAILABLE", "PLAN_SET_TOO_LARGE", "TAKEOFF_DISABLED",
] as const;
/** Only the gesture of the member who pays (or of an operator who takes it on) lifts these. */
export const TAKEOFF_LAUNCH_MANDATE_REASONS = [
  "OPERATOR_REQUIRED", "MANDATE_REQUIRED", "LOCAL_RUNTIME_REQUIRED", "HOST_NOT_AUTHORISED", "CHATGPT_NOT_CONNECTED",
  "CHATGPT_ACCESS_REVOKED", "CHATGPT_MODEL_MISSING", "CHATGPT_SELECTION_CHANGED", "PAYER_NOT_ELIGIBLE",
] as const;
/** The Mac of the mandate tries again on its own. */
export const TAKEOFF_LAUNCH_TRANSIENT_REASONS = ["ADMISSION_LIMIT", "SOURCE_UNREADABLE", "ANOTHER_ANALYSIS_RUNNING"] as const;

export type TakeoffLaunchDossierReason = (typeof TAKEOFF_LAUNCH_DOSSIER_REASONS)[number];
export type TakeoffLaunchMandateReason = (typeof TAKEOFF_LAUNCH_MANDATE_REASONS)[number];
export type TakeoffLaunchTransientReason = (typeof TAKEOFF_LAUNCH_TRANSIENT_REASONS)[number];
export type TakeoffLaunchReason = TakeoffLaunchDossierReason | TakeoffLaunchMandateReason | TakeoffLaunchTransientReason;
/** The blockings a mandate check on the Mac (or at the gesture) can find. */
export type TakeoffMandateIssue = Extract<TakeoffLaunchMandateReason,
  "LOCAL_RUNTIME_REQUIRED" | "HOST_NOT_AUTHORISED" | "CHATGPT_NOT_CONNECTED" | "CHATGPT_ACCESS_REVOKED" | "CHATGPT_MODEL_MISSING">;

const REASONS = new Set<string>([...TAKEOFF_LAUNCH_DOSSIER_REASONS, ...TAKEOFF_LAUNCH_MANDATE_REASONS, ...TAKEOFF_LAUNCH_TRANSIENT_REASONS]);
export function isTakeoffLaunchReason(value: unknown): value is TakeoffLaunchReason {
  return typeof value === "string" && REASONS.has(value);
}
export function isTakeoffLaunchMandateReason(value: unknown): value is TakeoffLaunchMandateReason {
  return (TAKEOFF_LAUNCH_MANDATE_REASONS as readonly string[]).includes(value as string);
}

/** A piece named by a blocking: what every reader of the affaire already sees in its dossier. */
export type TakeoffLaunchPiece = { id: string; name: string };

export type TakeoffLaunchDecision =
  | { state: "not_eligible"; reason: TakeoffLaunchDossierReason; pieces: TakeoffLaunchPiece[] }
  | { state: "blocked"; reason: TakeoffLaunchReason; pieces: TakeoffLaunchPiece[] }
  | { state: "ready" };

const DOSSIER_STATE_REASON: Record<Exclude<AffaireDossierState, "confirmed">, TakeoffLaunchDossierReason> = {
  empty: "DOSSIER_EMPTY", processing: "DOSSIER_PROCESSING", to_review: "DOSSIER_TO_REVIEW", brief_to_confirm: "BRIEF_NOT_CONFIRMED",
};

/**
 * Whether a request may be admitted now, in the order a member reads it: the module, then the dossier (« Dossier
 * confirmé », as the affaire's title says it), its plans and their working copies, the payer's right, then the payer's
 * subscription on this Mac. The preparation and the bytes are checked after this, when the snapshot is sealed.
 */
export function decideTakeoffLaunch(facts: {
  takeoffEnabled: boolean;
  documents: ReadonlyArray<AffaireIntakeReviewableDocument>;
  briefStatus: string | null;
  /** The dossier's PDF plans that have a working copy of their current generation. */
  plansWithCopy: number;
  /** The dossier's PDF plans without one (a copy never made, removed, or a Drive file that could not be read). */
  plansWithoutCopy: TakeoffLaunchPiece[];
  /** Plans already in the affaire's plan set that do not come from the dossier (uploaded to the plan set). */
  otherPlans: number;
  payerEligible: boolean;
  mandateIssue: TakeoffMandateIssue | "CHATGPT_SELECTION_CHANGED" | null;
}): TakeoffLaunchDecision {
  if (!facts.takeoffEnabled) return { state: "blocked", reason: "TAKEOFF_DISABLED", pieces: [] };
  const dossier = getAffaireDossierState({ documents: facts.documents, briefStatus: facts.briefStatus });
  if (dossier !== "confirmed") return { state: "not_eligible", reason: DOSSIER_STATE_REASON[dossier], pieces: [] };
  if (facts.plansWithoutCopy.length > 0) return { state: "blocked", reason: "PLAN_COPY_MISSING", pieces: facts.plansWithoutCopy };
  if (facts.plansWithCopy + facts.otherPlans === 0) return { state: "not_eligible", reason: "NO_EXPLOITABLE_PLAN", pieces: [] };
  if (!facts.payerEligible) return { state: "blocked", reason: "PAYER_NOT_ELIGIBLE", pieces: [] };
  if (facts.mandateIssue) return { state: "blocked", reason: facts.mandateIssue, pieces: [] };
  return { state: "ready" };
}

/** The unit key lot 2 seals: one grouped unit holding the affaire's retained plans (lot 3 seals one unit per plan). */
export const TAKEOFF_GROUPED_UNIT_KEY = "grouped";

export type TakeoffLaunchManifest = {
  format_version: 1;
  intent: "initial" | "reread_plans";
  /** The measuring order: free extraction today; a sealed list of items later (its identity, revision and digest). */
  order: { kind: "free_extraction"; version: 1; list: null };
  units: Array<{ key: string; plans: string[] }>;
  plans: Array<{
    /** The entry's key in this manifest: the plan copy's identifier. */
    entry_key: string;
    name: string;
    /** The plan's logical identity: its dossier piece, or the copy itself for a plan uploaded to the plan set. */
    logical_id: string;
    intake_document_id: string | null;
    /** The working copy read (a plan file of the affaire's plan set), its generation and the digest of its bytes. */
    plan_file_id: string;
    generation: string | null;
    content_sha256: string;
    /** Original pages, 1-based; empty for the whole plan. */
    pages: number[];
    page_count: number | null;
  }>;
  references: Array<{ document_id: string; kind: string; content_sha256: string }>;
  coverage: {
    plans_retained: number;
    /** Retained in the dossier but not read: a revision set aside, an identical copy, or a plan the analysis cannot read. */
    plans_omitted: Array<{ id: string; name: string; reason: "alternate" | "identical_copy" | "unsupported_format" }>;
    references_omitted: Array<{ id: string; name: string; reason: "unreadable" | "unsupported_format" | "limit" }>;
  };
  preparation: { revision: number; rule_version: 1 };
};

/** The manifest of the grouped unit, from the snapshot the request seals (its active plans and references). */
export function buildTakeoffLaunchManifest(input: {
  intent: TakeoffLaunchManifest["intent"];
  sources: ReadonlyArray<TakeoffPreparationSource>;
  intakeDocumentByPlanFile: ReadonlyMap<string, { intakeDocumentId: string; generation: string | null }>;
  omittedPlans: TakeoffLaunchManifest["coverage"]["plans_omitted"];
  omittedReferences: TakeoffLaunchManifest["coverage"]["references_omitted"];
  preparationRevision: number;
}): TakeoffLaunchManifest {
  const plans = input.sources.filter((source) => source.active && source.kind === "plan")
    .sort((left, right) => left.document_id.localeCompare(right.document_id))
    .map((source) => {
      const intake = input.intakeDocumentByPlanFile.get(source.document_id);
      if (!source.content_hash) throw new Error("A sealed plan has no verified digest.");
      return {
        entry_key: source.document_id, name: source.document_name, logical_id: intake?.intakeDocumentId ?? source.document_id,
        intake_document_id: intake?.intakeDocumentId ?? null, plan_file_id: source.document_id,
        generation: intake?.generation ?? source.source_updated_at ?? null, content_sha256: source.content_hash,
        pages: [...source.pages].sort((left, right) => left - right), page_count: source.page_count ?? null,
      };
    });
  const references = input.sources.filter((source) => source.active && source.kind !== "plan")
    .sort((left, right) => left.document_id.localeCompare(right.document_id))
    .map((source) => {
      if (!source.content_hash) throw new Error("A sealed reference has no verified digest.");
      return { document_id: source.document_id, kind: source.kind, content_sha256: source.content_hash };
    });
  return {
    format_version: 1, intent: input.intent, order: { kind: "free_extraction", version: 1, list: null },
    units: [{ key: TAKEOFF_GROUPED_UNIT_KEY, plans: plans.map((plan) => plan.entry_key) }],
    plans, references,
    coverage: { plans_retained: plans.length, plans_omitted: input.omittedPlans, references_omitted: input.omittedReferences },
    preparation: { revision: input.preparationRevision, rule_version: 1 },
  };
}

/** The reason of a request, in French, as the affaire shows it. Names come from the dossier the reader already sees. */
export function describeTakeoffLaunchReason(reason: TakeoffLaunchReason, pieces: ReadonlyArray<TakeoffLaunchPiece> = []): string {
  const names = pieces.map((piece) => `« ${piece.name} »`).join(", ");
  switch (reason) {
    case "DOSSIER_EMPTY": return "Ajoutez le dossier de consultation : le métré démarrera quand il sera confirmé.";
    case "DOSSIER_PROCESSING": return "Classement des documents en cours : le métré démarrera quand le dossier sera confirmé.";
    case "DOSSIER_TO_REVIEW": return "Des pièces du dossier sont à vérifier : le métré démarrera quand le dossier sera confirmé.";
    case "BRIEF_NOT_CONFIRMED": return "Confirmez le brief de l’affaire : le métré démarrera quand le dossier sera confirmé.";
    case "NO_EXPLOITABLE_PLAN": return "Dossier confirmé sans plan exploitable : ajoutez un plan PDF pour que le métré démarre.";
    case "PLAN_COPY_MISSING": return `Métré non démarré — copie de travail manquante pour ${names || "un plan du dossier"}. Rendez la pièce accessible ou retirez-la du dossier.`;
    case "PREPARATION_NEEDS_REVIEW": return "Métré non démarré — choisissez dans les options du métré la version à retenir des plans concernés.";
    case "REFERENCE_UNAVAILABLE": return "Métré non démarré — une pièce de référence retenue n’est pas lisible.";
    case "PLAN_SET_TOO_LARGE": return "Métré non démarré — les plans dépassent les limites d’une analyse. Restreignez-les dans les options du métré.";
    case "TAKEOFF_DISABLED": return "Le métré n’est pas activé pour cette entreprise.";
    case "OPERATOR_REQUIRED": return "Métré non démarré — prise en charge par un métreur requise";
    case "MANDATE_REQUIRED": return "Métré non démarré — la personne qui a confirmé le dossier doit le reprendre avec son forfait ChatGPT.";
    case "LOCAL_RUNTIME_REQUIRED": return "Métré non démarré — ouvrez MergeOne sur le Mac connecté, puis reprenez avec votre forfait.";
    case "HOST_NOT_AUTHORISED": return "Métré non démarré — cette adresse ne peut pas utiliser le forfait ChatGPT. Ouvrez MergeOne sur le Mac connecté.";
    case "CHATGPT_NOT_CONNECTED": return "Métré non démarré — forfait ChatGPT non connecté. Connectez-le dans Mon profil, puis reprenez avec votre forfait.";
    case "CHATGPT_ACCESS_REVOKED": return "Métré non démarré — connexion ChatGPT expirée ou partage révoqué. Reconnectez votre forfait dans Mon profil, puis reprenez.";
    case "CHATGPT_MODEL_MISSING": return "Métré non démarré — aucun modèle ChatGPT choisi. Choisissez-en un dans Mon profil, puis reprenez.";
    case "CHATGPT_SELECTION_CHANGED": return "Métré non démarré — le compte, le modèle ou l’effort ChatGPT a changé depuis la confirmation. Reprenez avec votre forfait pour confirmer ces réglages.";
    case "PAYER_NOT_ELIGIBLE": return "Métré non démarré — la personne qui devait payer ne peut plus lancer de métré sur cette affaire. Un métreur peut le prendre en charge.";
    case "ADMISSION_LIMIT": return "Métré en attente — trop d’analyses en cours ou récentes sur ce forfait. Il démarrera dès que possible.";
    case "SOURCE_UNREADABLE": return "Métré en attente — une pièce du dossier n’a pas pu être lue. Nouvelle tentative automatique.";
    case "ANOTHER_ANALYSIS_RUNNING": return "Métré en attente — une autre analyse de l’affaire est en cours.";
  }
}

/** The notice of who pays, told at the brief's confirmation to the member whose subscription the analysis will use. */
export const TAKEOFF_AUTOMATIC_PAYER_NOTICE = "Une fois les plans prêts, le métré utilisera votre forfait ChatGPT et les réglages de Mon profil.";
