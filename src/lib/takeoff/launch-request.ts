import { getAffaireDossierState, type AffaireDossierState, type AffaireIntakeReviewableDocument } from "@/lib/affaires/intake";
import type { TakeoffExecutionSelection, TakeoffPreparationSource } from "@/lib/takeoff/preparation";
import { describePosteReadingBounds, type PosteReadingBoundsFacts } from "@/lib/takeoff/poste-reading-bounds-text";

/**
 * The launch requests of a takeoff (migration 20261121170448_takeoff_launch_requests.sql): one execution of an affaire's
 * analysis on a sealed manifest. The automatic request is the one start of an affaire, when its dossier is confirmed; a
 * manual request is one explicit command (a relaunch). This module holds what the server and the screens decide alike.
 */
/** superseded: an automatic start set aside by an explicit relaunch, final. A command's receipt is not a request. */
export const TAKEOFF_LAUNCH_REQUEST_STATES = ["evaluating", "not_eligible", "blocked", "admitted", "closed", "superseded"] as const;
export type TakeoffLaunchRequestState = (typeof TAKEOFF_LAUNCH_REQUEST_STATES)[number];

/** The dossier does not allow an analysis yet: a change of the dossier evaluates it again. */
export const TAKEOFF_LAUNCH_DOSSIER_REASONS = [
  "DOSSIER_EMPTY", "DOSSIER_PROCESSING", "DOSSIER_TO_REVIEW", "BRIEF_NOT_CONFIRMED", "NO_EXPLOITABLE_PLAN",
  "PLAN_COPY_MISSING", "PREPARATION_NEEDS_REVIEW", "PLAN_SET_TOO_LARGE",
] as const;
/** Only the gesture of the member who pays (or of an operator who takes it on) lifts these. */
export const TAKEOFF_LAUNCH_MANDATE_REASONS = [
  "OPERATOR_REQUIRED", "MANDATE_REQUIRED", "LOCAL_RUNTIME_REQUIRED", "HOST_NOT_AUTHORISED", "CHATGPT_NOT_CONNECTED",
  "CHATGPT_ACCESS_REVOKED", "CHATGPT_MODEL_MISSING", "CHATGPT_SELECTION_CHANGED", "PAYER_NOT_ELIGIBLE",
  "EVALUATION_FAILED",
] as const;
/** The Mac of the mandate tries again on its own. */
export const TAKEOFF_LAUNCH_TRANSIENT_REASONS = ["ADMISSION_LIMIT", "SOURCE_UNREADABLE", "ANOTHER_ANALYSIS_RUNNING", "TAKEOFF_DISABLED",
  // Lot 4: the list of items cannot be sealed yet (a DPGF to prepare or to choose), once the second order is activated.
  "ITEM_LIST_TO_PREPARE"] as const;

/**
 * Why a request ended without its units ending normally: its budget spent, set aside by a relaunch (its state), or the
 * rest of it stopped by a member (lot 3: the plans not read yet are cancelled, the plans read stay).
 */
export const TAKEOFF_LAUNCH_CLOSURE_REASONS = ["BUDGET_EXHAUSTED", "SUPERSEDED", "STOPPED_BY_MEMBER"] as const;

export type TakeoffLaunchDossierReason = (typeof TAKEOFF_LAUNCH_DOSSIER_REASONS)[number];
export type TakeoffLaunchMandateReason = (typeof TAKEOFF_LAUNCH_MANDATE_REASONS)[number];
export type TakeoffLaunchTransientReason = (typeof TAKEOFF_LAUNCH_TRANSIENT_REASONS)[number];
export type TakeoffLaunchReason = TakeoffLaunchDossierReason | TakeoffLaunchMandateReason | TakeoffLaunchTransientReason
  | (typeof TAKEOFF_LAUNCH_CLOSURE_REASONS)[number];
/** The blockings a mandate check on the Mac (or at the gesture) can find. */
export type TakeoffMandateIssue = Extract<TakeoffLaunchMandateReason,
  "LOCAL_RUNTIME_REQUIRED" | "HOST_NOT_AUTHORISED" | "CHATGPT_NOT_CONNECTED" | "CHATGPT_ACCESS_REVOKED" | "CHATGPT_MODEL_MISSING">;

const REASONS = new Set<string>([...TAKEOFF_LAUNCH_DOSSIER_REASONS, ...TAKEOFF_LAUNCH_MANDATE_REASONS, ...TAKEOFF_LAUNCH_TRANSIENT_REASONS,
  ...TAKEOFF_LAUNCH_CLOSURE_REASONS]);

/**
 * The selection a mandate is given under: the execution selection of Mon profil on this Mac, and the authorization of
 * the connection it was read from. A disconnection, a lost access or a reconnection gives another authorization.
 */
export type TakeoffMandateSelection = TakeoffExecutionSelection & { authorizationId: string };
export function isTakeoffLaunchReason(value: unknown): value is TakeoffLaunchReason {
  return typeof value === "string" && REASONS.has(value);
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
  // The module is decided by the database (the claim, the admission). Whatever the dossier's state, a withdrawn
  // connection is never revived by a later one, only by a new gesture.
  if (facts.mandateIssue === "CHATGPT_ACCESS_REVOKED") return { state: "blocked", reason: "CHATGPT_ACCESS_REVOKED", pieces: [] };
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

/**
 * The measuring order of a manifest: the free extraction (version 1), or the affaire's list of items sealed at admission
 * (version 2, lot 4: its stored revision, its number, the database's digest of its entries and its size), behind its own
 * activation (migration 20261121230719_takeoff_item_lists.sql).
 */
export type TakeoffLaunchOrder =
  | { kind: "free_extraction"; version: 1; list: null }
  | { kind: "item_list"; version: 2; list: { revision_id: string; revision: number; content_sha256: string; item_count: number } };

export const TAKEOFF_FREE_EXTRACTION_ORDER: TakeoffLaunchOrder = { kind: "free_extraction", version: 1, list: null };

export type TakeoffLaunchManifest = {
  format_version: 1;
  intent: "initial" | "reread_plans";
  order: TakeoffLaunchOrder;
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
    /**
     * Retained in the dossier but not read: a revision set aside, an identical copy, a plan the analysis cannot read, or
     * a plan an earlier analysis of the affaire read that a member's command did not name (not_requested: that analysis
     * stays; the dossier piece and generation it sealed are kept, so that the dossier's change since is still told).
     */
    plans_omitted: Array<{ id: string; name: string; reason: "alternate" | "identical_copy" | "unsupported_format" | "not_requested";
      intake_document_id?: string | null; generation?: string | null }>;
    /**
     * Retained in the dossier but not attached: no stored copy to read, a stored object that is not this piece's in this
     * affaire, a format the analysis does not read, content the worker cannot read (a corrupt or protected PDF, an invalid
     * workbook), or past the bounds of the references.
     */
    references_omitted: Array<{ id: string; name: string; reason: "unreadable" | "outside_affaire" | "unsupported_format" | "invalid" | "limit" }>;
  };
  preparation: { revision: number; rule_version: 1 };
  /** The request's budget over every attempt of its jobs (lot 2: the tenant's per-job budget of the detailed reading). */
  budget: { tokens: number; cost_cents: number };
};

type TakeoffLaunchManifestInput = {
  intent: TakeoffLaunchManifest["intent"];
  sources: ReadonlyArray<TakeoffPreparationSource>;
  intakeDocumentByPlanFile: ReadonlyMap<string, { intakeDocumentId: string; generation: string | null }>;
  omittedPlans: TakeoffLaunchManifest["coverage"]["plans_omitted"];
  omittedReferences: TakeoffLaunchManifest["coverage"]["references_omitted"];
  preparationRevision: number;
  budget: TakeoffLaunchManifest["budget"];
  /** The free extraction unless the second order is activated (lot 4). */
  order?: TakeoffLaunchOrder;
};

/** The manifest of the grouped unit, from the snapshot the request seals (its active plans and references). */
export function buildTakeoffLaunchManifest(input: TakeoffLaunchManifestInput): TakeoffLaunchManifest {
  const { plans, references } = sealedManifestEntries(input);
  return {
    format_version: 1, intent: input.intent, order: input.order ?? TAKEOFF_FREE_EXTRACTION_ORDER,
    units: [{ key: TAKEOFF_GROUPED_UNIT_KEY, plans: plans.map((plan) => plan.entry_key) }],
    plans, references,
    coverage: { plans_retained: plans.length, plans_omitted: input.omittedPlans, references_omitted: input.omittedReferences },
    preparation: { revision: input.preparationRevision, rule_version: 1 },
    budget: input.budget,
  };
}

/** The most units a request seals: one per plan, within the plan set's file limit (src/lib/takeoff/plans.ts). */
export const TAKEOFF_LAUNCH_MAX_UNITS = 20;

/** The key of a plan's unit in a manifest of format 2: its entry, the plan copy's identifier. Never a name or a page. */
export function takeoffPlanUnitKey(entryKey: string) {
  return `plan:${entryKey.toLowerCase()}`;
}

/**
 * Lot 3, format 2: one unit per retained plan, each analysed by its own job, one at a time on the Mac of the mandate, in
 * the order recorded here (`ordinal`, from 1), which is exposed before the first reading and never changes afterwards
 * (a renamed plan or another sort on a screen plans nothing again). Each unit seals its share of the request's budget;
 * the request's envelope stays the one of a grouped analysis (it is not multiplied by the number of plans).
 */
export type TakeoffPlanLaunchManifest = Omit<TakeoffLaunchManifest, "format_version" | "units"> & {
  format_version: 2;
  units: Array<TakeoffPlanLaunchUnit>;
  /** The rule the order was recorded with: the normalized display name, then the copy's identifier. */
  dispatch: { order: "display_name"; version: 1 };
};
export type TakeoffPlanLaunchUnit = {
  key: string;
  ordinal: number;
  /** Its one plan: the entry key of `plans`, which lists the plans in the same order. */
  plans: [string];
  /** The original pages read, 1-based; empty for the whole plan. */
  pages: number[];
  page_count: number | null;
  /** Its share of the request's budget: every paid call of its job needs a positive balance of it. */
  budget: { tokens: number; cost_cents: number };
  /** Its pages of the dossier's vector reading, allotted in the recorded order (TAKEOFF_LAUNCH_VECTOR_PAGES in all). */
  vector_pages: number;
};
export type AnyTakeoffLaunchManifest = TakeoffLaunchManifest | TakeoffPlanLaunchManifest;

/**
 * The unit a job of one analysis per plan reads, from the snapshot its admission attested (the database's projection of
 * the request's snapshot, migration 20261121231238_takeoff_plan_dispatcher.sql): its request, key, place, budget and
 * vector pages. None for a grouped analysis or a job without a request.
 */
export function readTakeoffLaunchUnit(snapshot: unknown): null | {
  requestId: string; key: string; ordinal: number; vectorPages: number; budget: TakeoffPlanLaunchUnit["budget"] | null;
} {
  const unit = (snapshot as { launch_unit?: Record<string, unknown> } | null)?.launch_unit;
  if (!unit || typeof unit.request_id !== "string" || typeof unit.key !== "string" || typeof unit.ordinal !== "number") return null;
  const budget = unit.budget as TakeoffPlanLaunchUnit["budget"] | undefined;
  return { requestId: unit.request_id, key: unit.key, ordinal: unit.ordinal,
    vectorPages: typeof unit.vector_pages === "number" ? unit.vector_pages : 0,
    budget: budget && typeof budget.tokens === "number" && typeof budget.cost_cents === "number" ? budget : null };
}

/** A display name compared without case, accents or repeated spaces. */
function normalizedPlanName(name: string) {
  return name.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}
const PLAN_NAME_ORDER = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

/** The recorded order of a request's plans: their normalized display name (« Plan 2 » before « Plan 10 »), then identifier. */
export function compareTakeoffPlansForDispatch(left: { name: string; entry_key: string }, right: { name: string; entry_key: string }) {
  return PLAN_NAME_ORDER.compare(normalizedPlanName(left.name), normalizedPlanName(right.name))
    || (left.entry_key < right.entry_key ? -1 : left.entry_key > right.entry_key ? 1 : 0);
}

/**
 * The shares of a request's budget, by weight (the pages a unit reads): each rounded up, so that a positive envelope
 * never leaves a unit with nothing; their sum exceeds the envelope by less than the number of units, and the request's
 * own balance is checked as well before every call.
 */
export function splitTakeoffRequestBudget(budget: TakeoffLaunchManifest["budget"], weights: ReadonlyArray<number>) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.length === 0 || weights.some((weight) => !Number.isInteger(weight) || weight < 1)) {
    throw new Error("Each unit of a request needs a positive weight.");
  }
  return weights.map((weight) => ({
    tokens: Math.ceil((budget.tokens * weight) / total),
    cost_cents: Math.ceil((budget.cost_cents * weight) / total),
  }));
}

/** The pages of the vector reading of one request, over all its plans (a grouped analysis reads as many: TAKEOFF_VECTOR_MAX_PAGES). */
export const TAKEOFF_LAUNCH_VECTOR_PAGES = 60;

/**
 * The pages each plan is weighed by: those retained, else its page count. A plan whose page count is not known when the
 * request is sealed (a dossier copy not read yet) weighs as the mean of the others, or as each other when none is known.
 */
export function takeoffPlanWeights(plans: ReadonlyArray<{ pages: number[]; page_count: number | null }>) {
  const known = plans.map((plan) => plan.pages.length || plan.page_count || null);
  const counted = known.filter((weight): weight is number => weight !== null);
  const fallback = counted.length ? Math.max(1, Math.round(counted.reduce((sum, weight) => sum + weight, 0) / counted.length)) : 1;
  return known.map((weight) => weight ?? fallback);
}

/** The dossier's vector pages allotted to its plans in the recorded order, each at most its own pages. */
export function allotTakeoffVectorPages(weights: ReadonlyArray<number>, total = TAKEOFF_LAUNCH_VECTOR_PAGES) {
  let left = total;
  return weights.map((weight) => {
    const pages = Math.max(0, Math.min(weight, left));
    left -= pages;
    return pages;
  });
}

/** The manifest of format 2 (lot 3): one unit per active plan of the snapshot the request seals, in the recorded order. */
export function buildTakeoffPlanLaunchManifest(input: TakeoffLaunchManifestInput): TakeoffPlanLaunchManifest {
  return splitTakeoffLaunchManifest(buildTakeoffLaunchManifest(input));
}

/**
 * The same seal, one unit per plan: the grouped manifest's plans, references and coverage, its plans in the recorded
 * order, each with its share of the envelope and of the dossier's vector pages, weighed by its retained pages, else its
 * page count (stored, or counted by the sealing on its bytes). Nothing is read again: the plans are those the request's
 * one seal verified.
 */
export function splitTakeoffLaunchManifest(grouped: TakeoffLaunchManifest,
  /** The pages of each plan counted on its bytes (as the worker counts them), before the count its row stores. */
  countedPages: ReadonlyMap<string, number> = new Map()): TakeoffPlanLaunchManifest {
  const plans = [...grouped.plans].map((plan) => ({ ...plan, page_count: countedPages.get(plan.plan_file_id) ?? plan.page_count }))
    .sort(compareTakeoffPlansForDispatch);
  if (plans.length === 0 || plans.length > TAKEOFF_LAUNCH_MAX_UNITS) {
    throw new Error(`A request seals between 1 and ${TAKEOFF_LAUNCH_MAX_UNITS} plans.`);
  }
  const weights = takeoffPlanWeights(plans);
  const shares = splitTakeoffRequestBudget(grouped.budget, weights);
  const vectors = allotTakeoffVectorPages(weights);
  return {
    ...grouped,
    format_version: 2,
    units: plans.map((plan, index) => ({ key: takeoffPlanUnitKey(plan.entry_key), ordinal: index + 1, plans: [plan.entry_key],
      pages: plan.pages, page_count: plan.page_count, budget: shares[index], vector_pages: vectors[index] })),
    plans,
    dispatch: { order: "display_name", version: 1 },
  };
}

function sealedManifestEntries(input: Pick<TakeoffLaunchManifestInput, "sources" | "intakeDocumentByPlanFile">) {
  const plans = input.sources.filter((source) => source.active && source.kind === "plan")
    .sort((left, right) => left.document_id.localeCompare(right.document_id))
    .map((source) => {
      const intake = input.intakeDocumentByPlanFile.get(source.document_id);
      if (!source.content_hash) throw new Error("A sealed plan has no verified digest.");
      return {
        entry_key: source.document_id, name: source.document_name, logical_id: intake?.intakeDocumentId ?? source.document_id,
        intake_document_id: intake?.intakeDocumentId ?? null, plan_file_id: source.document_id,
        // A dossier copy's own generation (none for a copy made before generations were recorded), never a file's date.
        generation: intake ? intake.generation : source.source_updated_at ?? null, content_sha256: source.content_hash,
        pages: [...source.pages].sort((left, right) => left - right), page_count: source.page_count ?? null,
      };
    });
  const references = input.sources.filter((source) => source.active && source.kind !== "plan")
    .sort((left, right) => left.document_id.localeCompare(right.document_id))
    .map((source) => {
      if (!source.content_hash) throw new Error("A sealed reference has no verified digest.");
      return { document_id: source.document_id, kind: source.kind, content_sha256: source.content_hash };
    });
  return { plans, references };
}

/**
 * A relaunch that cannot read the plans of the analysis it replaces as they were (lot 3): the plans that have no working
 * copy now, named as the member may read them, with why (their piece left the dossier, or its copy is missing for now),
 * and the plans of that analysis that remain to read, which the member chooses (nothing is recorded until then).
 */
export type TakeoffRelaunchChoice = {
  withoutCopy: Array<{ name: string; reason: "removed" | "copy_missing" }>;
  remaining: Array<{ id: string; name: string }>;
};

/** Each plan of the analysis without a working copy, named, with why, in French. */
function describePlansWithoutCopy(plans: TakeoffRelaunchChoice["withoutCopy"]) {
  const removed = plans.filter(({ reason }) => reason === "removed").map(({ name }) => `« ${name} »`);
  const missing = plans.filter(({ reason }) => reason === "copy_missing").map(({ name }) => `« ${name} »`);
  return [
    removed.length ? `${removed.join(", ")} ${removed.length > 1 ? "ne sont plus" : "n’est plus"} dans les plans de l’affaire` : null,
    missing.length ? `${missing.join(", ")} ${missing.length > 1 ? "n’ont" : "n’a"} pas de copie de travail pour l’instant `
      + "(manquante ou illisible)" : null,
  ].filter(Boolean).join(" ; ");
}

/** Why the analysis is not relaunched as it was, while other plans of it remain to read, in French. */
export function describeTakeoffRelaunchChoice(choice: TakeoffRelaunchChoice) {
  return `${describePlansWithoutCopy(choice.withoutCopy)} : l’analyse ne peut pas être relancée telle quelle. `
    + "Les autres plans peuvent être relus.";
}

/**
 * Why an analysis none of whose plans can be read now is not relaunched, in French: a plan that left the plan set never
 * comes back; a copy missing for now may.
 */
export function describeTakeoffRelaunchWithoutPlans(plans: TakeoffRelaunchChoice["withoutCopy"]) {
  const waiting = plans.filter(({ reason }) => reason === "copy_missing").length;
  return `${describePlansWithoutCopy(plans)} : ${waiting === 0 ? "cette analyse ne peut plus être relancée."
    : `l’analyse se relance quand ${waiting > 1 ? "ces plans ont de nouveau leur copie" : "ce plan a de nouveau sa copie"}.`}`;
}

/**
 * The reason of a request, in French, as the affaire shows it. Names come from the dossier the reader already sees. A
 * request whose reading against the list of items passes its bounds (lot 4) also says the effective limits, from the
 * facts its reason keeps.
 */
export function describeTakeoffLaunchReason(reason: TakeoffLaunchReason, pieces: ReadonlyArray<TakeoffLaunchPiece> = [],
  readingBounds: PosteReadingBoundsFacts | null = null): string {
  const names = pieces.map((piece) => `« ${piece.name} »`).join(", ");
  if (reason === "PLAN_SET_TOO_LARGE" && readingBounds) {
    return `Métré non démarré — ${names ? `les plans ${names} dépassent` : "les plans dépassent"} les limites d’une lecture contre `
      + `la liste des postes. ${describePosteReadingBounds(readingBounds)}`;
  }
  switch (reason) {
    case "DOSSIER_EMPTY": return "Ajoutez le dossier de consultation : le métré démarrera quand il sera confirmé.";
    case "DOSSIER_PROCESSING": return "Classement des documents en cours : le métré démarrera quand le dossier sera confirmé.";
    case "DOSSIER_TO_REVIEW": return "Des pièces du dossier sont à vérifier : le métré démarrera quand le dossier sera confirmé.";
    case "BRIEF_NOT_CONFIRMED": return "Confirmez le brief de l’affaire : le métré démarrera quand le dossier sera confirmé.";
    case "NO_EXPLOITABLE_PLAN": return "Dossier confirmé sans plan exploitable : ajoutez un plan PDF pour que le métré démarre.";
    case "PLAN_COPY_MISSING": return `Métré non démarré — copie de travail manquante ou illisible pour ${names || "un plan du dossier"}. Rendez la pièce accessible ou retirez-la du dossier.`;
    case "PREPARATION_NEEDS_REVIEW": return "Métré non démarré — choisissez dans les options du métré la version à retenir des plans concernés.";
    case "PLAN_SET_TOO_LARGE": return `Métré non démarré — ${names ? `les plans ${names} dépassent` : "les plans dépassent"} les limites d’une analyse. Restreignez-les dans les options du métré.`;
    case "TAKEOFF_DISABLED": return "Le métré n’est pas activé pour cette entreprise.";
    case "OPERATOR_REQUIRED": return "Métré non démarré — prise en charge par un métreur requise";
    case "MANDATE_REQUIRED": return "Métré non démarré — la confirmation du dossier n’a engagé aucun forfait ChatGPT. Un métreur peut le prendre en charge avec le sien.";
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
    case "ITEM_LIST_TO_PREPARE": return "Métré en attente — la liste des postes est à préparer : importez ou choisissez la DPGF de l’affaire. Nouvelle tentative automatique.";
    case "EVALUATION_FAILED": return "Métré non démarré — la vérification du dossier a échoué plusieurs fois. Reprenez avec votre forfait pour réessayer.";
    case "SUPERSEDED": return "Métré automatique remplacé par une relance de l’analyse : une nouvelle analyse se lance depuis les options du métré.";
    case "BUDGET_EXHAUSTED": return "Métré arrêté — le budget de cette analyse est épuisé. Une nouvelle analyse se lance depuis les options du métré.";
    case "STOPPED_BY_MEMBER": return "Métré arrêté à la demande d’un métreur : les plans déjà lus restent disponibles, les autres n’ont pas été lus.";
  }
}

/** The notice of who pays, told at the brief's confirmation to the member whose subscription the analysis will use. */
export const TAKEOFF_AUTOMATIC_PAYER_NOTICE = "Une fois les plans prêts, le métré utilisera votre forfait ChatGPT et les réglages de Mon profil.";
