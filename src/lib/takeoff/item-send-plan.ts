import { usesPerUnitLabor, type EstimateEngineVersion } from "@/lib/estimates/engine/capabilities";
import {
  composeDpgfTarget,
  upgradeDpgfComposition,
  type DpgfContribution,
  type StoredDpgfComposition,
} from "@/lib/takeoff/dpgf-composition";
import { round4 } from "@/lib/takeoff/dpgf-quantity-policy";
import type { ItemSendRuleAction, ItemSendRuleEffect, ItemSendRuleEffectKind } from "@/lib/takeoff/item-send-rules";
import { lengthFactor, roundedMeasure } from "@/lib/takeoff/page-replacement";
import type { Poste } from "@/lib/takeoff/poste-list";
import { compareQuantityPairs } from "@/lib/takeoff/quantity-policy";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";

/**
 * Lot 4, PR 5a: from what was accepted for one plan to what the estimate would become (« Unité d'envoi »,
 * « Regroupement », « Découpage », « DPGF et saisies », « Garde de pages », « Correspondances silencieuses et prix »).
 * Pure and client-safe: the server reads every fact, this module decides, and the writer of a later pull request checks
 * the same facts again under its locks before it writes the plan this module returns. Nothing here writes.
 *
 * - The unit of a send stays « the retained lines of this plan »: each item of the plan's sealed scope is either sent
 *   (a target), not sent with its reason, or to resolve by an explicit choice of the member. A hypothesis not retained
 *   never contributes; an alternative reading (PDF/vector, an overlap page, a detail plan) is never added.
 * - A target is one line of the estimate for one item in one compartment of the breakdown: a DPGF line where it is
 *   (resolved through the import's raw row, never by its title), a line an earlier send created for the same item and
 *   compartment, or a new line in the sections of the list (lot then family), each section by its identity, never by a
 *   homonymous title. A length is rounded once, on the sum of the compartment.
 * - A quantity typed by hand (on a DPGF line or on a line an earlier send fed) is never overwritten without a choice;
 *   the DPGF policy (the protective maximum, the 1 % check) is the one of dpgf-quantity-policy.ts, unchanged.
 * - A page another analysis already brought into the estimate is never counted again without its page decision; the
 *   items of one page's first send share one page contribution.
 * - Prices are never part of the plan: an existing line changes its quantity only, a new line has none.
 */

export const ITEM_SEND_BREAKDOWNS = ["together", "by_level", "by_building"] as const;
export type ItemSendBreakdown = (typeof ITEM_SEND_BREAKDOWNS)[number];

export const ITEM_SEND_BREAKDOWN_LABELS: Record<ItemSendBreakdown, string> = {
  together: "Ensemble", by_level: "Par niveau", by_building: "Par bâtiment",
};

/** The section that receives, with a DPGF, the items the DPGF does not hold. */
export const ITEM_SEND_COMPLEMENT_SECTION_TITLE = "Compléments du métré hors DPGF";
/** The section of an item the list placed in none. */
export const ITEM_SEND_DEFAULT_SECTION_TITLE = "Métré";
export const ITEM_SEND_UNALLOCATED_LABEL = "Non réparti";
export const ITEM_SEND_DPGF_COMPARTMENT_LABEL = "Ligne du DPGF";

export const ITEM_SEND_PLAN_FORMAT = "takeoff_item_send";
export const ITEM_SEND_PLAN_VERSION = 1;

// ---------------------------------------------------------------------------------------------------------------- inputs

/** An item of the plan's sealed list revision. */
export type ItemSendListItem = Pick<Poste, "id" | "label" | "expectedUnit" | "measurementBasis" | "qualifiers" | "sections" | "origin"
  | "referenceQuantity">;

/** An observation of a stored answer (lot 4 PR 3a): only a contribution counts. */
export type ItemSendObservation = {
  observationId: string;
  role: "contribution" | "candidate" | "alternative";
  source: "model" | "vector";
  quantity: number | null;
  unit: string | null;
  /** The plan's original page, 1-based. */
  page: number | null;
  measurementBasis: string | null;
};

/** The stored answer of one item on this plan, with its review decision and the entry of this plan's scope (lot 4 PR 4). */
export type ItemSendAnswer = {
  itemId: string;
  answerId: string;
  /** Compared as is: the writer refuses a plan whose answers moved. */
  revision: string;
  outcome: "measured" | "uncertain" | "not_found";
  observations: readonly ItemSendObservation[];
  /** What the review found and nobody decided (a low confidence, a rule failing, an alert…): the answer waits for its review. */
  anomalies: readonly string[];
  /** Taken on this very revision of the answer; the reader gives none taken on an earlier one. */
  decision: { kind: "accepted" | "set_aside"; revision: number } | null;
  /** A quantity a member entered for this plan; an hypothesis counts only once included by its own decision. */
  entry: { revision: number; quantity: number; unit: string; category: string; included: boolean } | null;
};

export type ItemSendLocationField = { value: string | null; state: "proposed" | "confirmed" | "corrected" | "unknown" | "multiple" };
/** The plan revision's location (lot 3): only a value an operator confirmed or set places a part. */
export type ItemSendPlanLocation = { building: ItemSendLocationField; level: ItemSendLocationField; generation: number | null };

export type ItemSendDraftSection = { id: string; parentId: string | null; position: number | null; title: string | null };

export type ItemSendDraftLine = {
  id: string;
  parentId: string | null;
  title: string | null;
  unitCode: string | null;
  pricingStatus: string | null;
  quantity: number;
  updatedAt: string;
  /** A DPGF line, with what the server proved of its import row (its mapped row's raw row) and what it holds. */
  dpgf: {
    importId: string | null;
    mappedRowId: string | null;
    rawRowId: string | null;
    /** The DPGF's own quantity for the line, as imported. */
    reference: number | null;
    composition: StoredDpgfComposition;
  } | null;
};

export type ItemSendDestinationState =
  | { kind: "first_draft"; engine: EstimateEngineVersion | null; maxSectionDepth: number }
  | { kind: "existing_draft"; versionId: string; engine: EstimateEngineVersion | null; maxSectionDepth: number;
    sections: readonly ItemSendDraftSection[]; lines: readonly ItemSendDraftLine[] }
  | { kind: "unresolved"; reason: "choose_destination" | "issued_only" };

/** A target an earlier send by item wrote in this draft, with the live parts it holds (migration C; none until it exists). */
export type ItemSendEarlierTarget = {
  itemId: string;
  breakdown: ItemSendBreakdown;
  compartmentKey: string;
  estimateItemId: string;
  parts: ReadonlyArray<{ jobId: string; answerId: string | null; quantity: number; unit: string; pages: readonly number[] }>;
};
export type ItemSendEarlierSection = { key: string; estimateItemId: string };

/** A page of this plan's document that another analysis already brought into the draft. */
export type ItemSendPageInEstimate = { page: number | null; earlierJobIds: readonly string[]; estimateItemIds: readonly string[] };

export type ItemSendChoice =
  | { kind: "line"; estimateItemId: string }
  | { kind: "new_line" }
  | { kind: "keep_entry" }
  | { kind: "use_retained" }
  | { kind: "leave_out" };
/** A member's explicit choice for one point to resolve, by the key the preview gave it. */
export type ItemSendResolution = { key: string; choice: ItemSendChoice };

export type ItemSendInput = {
  job: { id: string; status: string; sent: boolean; canEdit: boolean };
  plan: { key: string; name: string; location: ItemSendPlanLocation | null };
  list: { revisionId: string; revision: number };
  /** The sealed list revision, in document order. */
  items: readonly ItemSendListItem[];
  /** The items this plan was asked about (the sealed order). */
  scope: readonly string[];
  answers: readonly ItemSendAnswer[];
  /** Quantities entered for an item on the whole affaire: never added to one plan's measure. */
  affaireEntries: ReadonlyArray<{ itemId: string; revision: number }>;
  destination: ItemSendDestinationState;
  earlier: { targets: readonly ItemSendEarlierTarget[]; sections: readonly ItemSendEarlierSection[] };
  pagesInEstimate: readonly ItemSendPageInEstimate[];
  rules: ReadonlyMap<string, ItemSendRuleEffect>;
  breakdown: ItemSendBreakdown;
  resolutions: readonly ItemSendResolution[];
};

// --------------------------------------------------------------------------------------------------------------- outputs

export type ItemSendBlockerReason = "not_completed" | "already_sent" | "read_only" | "choose_destination" | "issued_only"
  | "engine_not_v3" | "engine_policy_v2" | "dpgf_import_required" | "no_line";
export type ItemSendBlocker = { reason: ItemSendBlockerReason; engine: number | null };

export type ItemSendUnallocatedReason = "location_unknown" | "location_multiple" | "location_to_confirm";
export type ItemSendCompartment = { key: string; label: string; reason: ItemSendUnallocatedReason | null };

export type ItemSendContribution = {
  answerId: string;
  answerRevision: string;
  kind: "measured" | "entered";
  observationIds: string[];
  quantity: number;
  unit: string;
  pages: number[];
};

export type ItemSendTargetLine =
  | { kind: "dpgf_line" | "earlier_line"; estimateItemId: string; title: string | null; expectedUpdatedAt: string; expectedQuantity: number }
  | { kind: "new_line"; sectionKey: string; sectionId: string | null; title: string };

export type ItemSendGap = { absolute: number; percent: number | null; requiresReview: boolean };

export type ItemSendQuantity = {
  /** The line's quantity now; null for a new line. */
  before: number | null;
  /** The DPGF's own quantity for a DPGF line. */
  reference: number | null;
  /** The quantity typed by hand on the line, when it is no longer what the sends wrote. */
  entered: number | null;
  /** What the line already holds of other analyses, and what this plan brings (raw, in the line's unit). */
  earlier: number;
  added: number;
  measured: number;
  /** The quantity the policy retains: the protective maximum with the DPGF reference, a length rounded once. */
  retained: number;
  /** The quantity written: the retained one, or the entry the member kept. */
  after: number;
  /** The value before a length's rounding, when rounding moves it. */
  roundedFrom: number | null;
  /** The gap to the DPGF reference on the line's total (cumulated, no compensation), and whether it needs a check. */
  gap: ItemSendGap | null;
  keptEntry: boolean;
};

export type ItemSendTarget = {
  key: string;
  itemId: string;
  label: string;
  position: number;
  compartment: ItemSendCompartment;
  unit: string;
  line: ItemSendTargetLine;
  quantity: ItemSendQuantity;
  contributions: ItemSendContribution[];
  rule: ItemSendRuleEffect | null;
  resolution: ItemSendChoice["kind"] | null;
};

export type ItemSendNotSentReason = "set_aside" | "not_found" | "uncertain" | "empty" | "unit_incompatible"
  | "hypothesis_not_included" | "rule_skip" | "affaire_entry" | "no_answer" | "left_out" | "entry_suspended";
export type ItemSendNotSent = { itemId: string; label: string; reason: ItemSendNotSentReason; ruleName: string | null };

export type ItemSendToResolveKind = "review_required" | "target_missing" | "target_multiple" | "unit_conflict" | "entered_quantity"
  | "breakdown_mixed" | "page_decision" | "section_depth";
export type ItemSendOption =
  | { kind: "line"; estimateItemId: string; title: string | null }
  | { kind: "new_line" }
  | { kind: "keep_entry" }
  | { kind: "use_retained" }
  | { kind: "leave_out" };
export type ItemSendToResolve = {
  key: string;
  kind: ItemSendToResolveKind;
  itemId: string | null;
  label: string | null;
  compartmentKey: string | null;
  /** A page waiting for its decision, and the items whose parts on it are held. */
  page: number | null;
  heldItemIds: string[];
  options: ItemSendOption[];
  facts: { reference: number | null; entered: number; measured: number; retained: number } | null;
};

export type ItemSendSection = {
  key: string;
  title: string;
  parentKey: string | null;
  /** The draft's section the new one goes under, when its parent is reused; null under a new parent or at the root. */
  parentExistingId: string | null;
  depth: number;
  /** A section of the same title already at that place, made by hand: never reused, said in the preview. */
  homonymInDraft: boolean;
};

export type ItemSendPageContribution = { page: number; itemIds: string[]; targetKeys: string[]; observationIds: string[] };

export type ItemSendNotAdded = {
  itemId: string; observationId: string; role: "alternative" | "candidate"; quantity: number | null; unit: string | null; page: number | null;
};

export type ItemSendRuleReport = { itemId: string; label: string; ruleId: string | null; ruleName: string | null;
  action: ItemSendRuleAction; effect: ItemSendRuleEffectKind; assemblyId: string | null };

/** The plan the writer of migration C stores and executes, versioned; built only when nothing is left to resolve. */
export type ItemSendWritePlan = {
  format: typeof ITEM_SEND_PLAN_FORMAT;
  version: typeof ITEM_SEND_PLAN_VERSION;
  job_id: string;
  plan_key: string;
  list: { revision_id: string; revision: number };
  destination: { kind: "first_draft" } | { kind: "existing_draft"; version_id: string };
  engine: 3;
  breakdown: ItemSendBreakdown;
  /** The sections the send creates, parents first. */
  sections: Array<{ key: string; title: string; parent_key: string | null; parent_id: string | null }>;
  targets: Array<{
    key: string;
    item_id: string;
    compartment_key: string;
    line: { kind: "dpgf_line" | "earlier_line"; estimate_item_id: string; expected_updated_at: string; expected_quantity: number }
      | { kind: "new_line"; section_key: string; section_id: string | null; title: string; unit_code: string; position: number };
    unit_code: string;
    quantity_after: number;
    quantity: { reference: number | null; entered: number | null; earlier: number; added: number; measured: number; retained: number;
      rounded_from: number | null; gap: ItemSendGap | null; kept_entry: boolean };
    rule: { rule_id: string | null; action: ItemSendRuleAction; effect: ItemSendRuleEffectKind; category_id: string | null;
      assembly_id: string | null } | null;
    contributions: Array<{ answer_id: string; answer_revision: string; kind: "measured" | "entered"; observation_ids: string[];
      quantity: number; unit: string; pages: number[] }>;
  }>;
  page_contributions: Array<{ page: number; item_ids: string[]; target_keys: string[]; observation_ids: string[] }>;
  left_out: Array<{ item_id: string; reason: ItemSendNotSentReason }>;
  /** What the plan was computed from: the writer reads each again under its locks and refuses the plan when one moved. */
  dependencies: {
    answers: Array<{ item_id: string; answer_id: string; revision: string; decision_revision: number | null; entry_revision: number | null }>;
    affaire_entries: Array<{ item_id: string; revision: number }>;
    location_generation: number | null;
    earlier_targets: Array<{ estimate_item_id: string; item_id: string; compartment_key: string }>;
    pages_in_estimate: Array<{ page: number | null; earlier_job_ids: string[] }>;
    resolutions: Array<{ key: string; choice: ItemSendChoice }>;
  };
};

export type ItemSendPlan = {
  blocker: ItemSendBlocker | null;
  breakdown: ItemSendBreakdown;
  engine: number | null;
  sections: ItemSendSection[];
  targets: ItemSendTarget[];
  notSent: ItemSendNotSent[];
  toResolve: ItemSendToResolve[];
  pageContributions: ItemSendPageContribution[];
  notAdded: ItemSendNotAdded[];
  rules: ItemSendRuleReport[];
  confirmable: boolean;
  writePlan: ItemSendWritePlan | null;
};

// ---------------------------------------------------------------------------------------------------------------- helpers

const unitCode = (raw: string | null | undefined) => (raw ? normalizeMeasurementUnit(raw).unitCode : null);
const same = (left: number, right: number) => round4(left) === round4(right);
const fold = (value: string | null | undefined) => (value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
const KNOWN = new Set(["confirmed", "corrected"]);

type Located = { known: true; value: string; key: string } | { known: false; reason: ItemSendUnallocatedReason | null };

function locatedField(field: ItemSendLocationField | undefined): Located {
  if (field && KNOWN.has(field.state) && field.value?.trim()) {
    return { known: true, value: field.value.trim(), key: fold(field.value) };
  }
  if (!field || field.state === "unknown" || (KNOWN.has(field.state) && !field.value?.trim())) return { known: false, reason: "location_unknown" };
  return { known: false, reason: field.state === "multiple" ? "location_multiple" : "location_to_confirm" };
}

const unallocated = (reason: ItemSendUnallocatedReason): ItemSendCompartment => ({ key: "unallocated", label: ITEM_SEND_UNALLOCATED_LABEL, reason });

/**
 * The compartment of the parts of one plan: « Ensemble »; by level, the plan's building and level (two buildings'
 * homonymous levels stay two compartments; an unknown building is left out of the key, a building only proposed or
 * several is not); by building, its building. A field unknown, several or only proposed → « Non réparti ».
 */
export function itemSendCompartment(breakdown: ItemSendBreakdown, location: ItemSendPlanLocation | null): ItemSendCompartment {
  if (breakdown === "together") return { key: "together", label: ITEM_SEND_BREAKDOWN_LABELS.together, reason: null };
  if (!location) return unallocated("location_unknown");
  const building = locatedField(location.building);
  if (breakdown === "by_building") {
    return building.known ? { key: `building:${building.key}`, label: building.value, reason: null } : unallocated(building.reason ?? "location_unknown");
  }
  const level = locatedField(location.level);
  if (!level.known) return unallocated(level.reason ?? "location_unknown");
  if (!building.known && building.reason !== "location_unknown") return unallocated(building.reason ?? "location_unknown");
  return building.known
    ? { key: `level:${building.key}|${level.key}`, label: `${building.value} · ${level.value}`, reason: null }
    : { key: `level:|${level.key}`, label: level.value, reason: null };
}

type Part = {
  kind: "measured" | "entered";
  answer: ItemSendAnswer;
  observationIds: string[];
  quantity: number;
  unit: string | null;
  basis: string | null;
  page: number | null;
};

type SectionStep = { key: string; title: string };

function sectionPath(item: ItemSendListItem, compartment: ItemSendCompartment, withDpgf: boolean): SectionStep[] {
  let path: SectionStep[];
  if (withDpgf) {
    const family = item.sections.at(-1);
    path = [{ key: "complement", title: ITEM_SEND_COMPLEMENT_SECTION_TITLE },
      ...(family ? [{ key: `complement/${family.id}`, title: family.title }] : [])];
  } else if (item.sections.length === 0) {
    path = [{ key: "list:", title: ITEM_SEND_DEFAULT_SECTION_TITLE }];
  } else {
    path = item.sections.map((section, index) => ({ key: `list:${item.sections.slice(0, index + 1).map(({ id }) => id).join("/")}`,
      title: section.title }));
  }
  if (compartment.key === "together" || compartment.key === "dpgf") return path;
  return [...path, { key: `${path.at(-1)!.key}/${compartment.key}`, title: compartment.label }];
}

function earlierParts(stored: StoredDpgfComposition, jobId: string): DpgfContribution[] {
  if (stored.version === 2) return stored.contributions.filter((part) => part.job_id !== jobId);
  if (stored.version === 1) return stored.job_id === jobId ? [] : upgradeDpgfComposition(stored, []).contributions;
  return [];
}

function gapOf(reference: number | null, measured: number): ItemSendGap | null {
  if (reference === null) return null;
  const pair = compareQuantityPairs([{ reference, measured }])!;
  return { absolute: round4(pair.absoluteGap), percent: pair.percentGap === null ? null : round4(pair.percentGap), requiresReview: pair.requiresReview };
}

/**
 * The send by item writes engine 3 lines only (a unit code, a line status, hours per unit in columns): never another
 * engine, never a converted copy.
 */
export function itemSendEngineFits(engine: EstimateEngineVersion | null): boolean {
  return engine !== null && usesPerUnitLabor(engine);
}

// ------------------------------------------------------------------------------------------------------------------- plan

export function planTakeoffItemSend(input: ItemSendInput): ItemSendPlan {
  const positions = new Map(input.items.map((item, position) => [item.id, position]));
  const scope = new Set(input.scope);
  for (const id of scope) {
    if (!positions.has(id)) throw new Error("Un poste de la portée scellée de ce plan manque à sa révision de liste.");
  }
  const answers = new Map<string, ItemSendAnswer>();
  for (const answer of input.answers) {
    if (!scope.has(answer.itemId)) throw new Error("Une réponse porte sur un poste hors de la portée scellée de ce plan.");
    if (answers.has(answer.itemId)) throw new Error("Deux réponses enregistrées pour un même poste de ce plan.");
    answers.set(answer.itemId, answer);
  }
  const destination = input.destination;
  const engine = destination.kind === "unresolved" ? null : destination.engine;
  const scoped = input.items.filter((item) => scope.has(item.id));
  const rules: ItemSendRuleReport[] = scoped.flatMap((item) => {
    const rule = input.rules.get(item.id);
    return rule && rule.effect !== "none" ? [{ itemId: item.id, label: item.label, ruleId: rule.ruleId, ruleName: rule.ruleName,
      action: rule.action, effect: rule.effect, assemblyId: rule.assemblyId }] : [];
  });
  const draftLines = destination.kind === "existing_draft" ? destination.lines : [];
  const withDpgf = draftLines.some((line) => line.dpgf !== null);
  const listHoldsDpgf = scoped.some((item) => item.origin.kind === "dpgf");

  const blockerReason: ItemSendBlockerReason | null = input.job.sent ? "already_sent"
    : input.job.status !== "completed" ? "not_completed"
      : !input.job.canEdit ? "read_only"
        : destination.kind === "unresolved" ? destination.reason
          : !itemSendEngineFits(engine) ? (destination.kind === "first_draft" ? "engine_policy_v2" : "engine_not_v3")
            : listHoldsDpgf && !withDpgf ? "dpgf_import_required" : null;
  const result: ItemSendPlan = { blocker: blockerReason ? { reason: blockerReason, engine } : null, breakdown: input.breakdown, engine,
    sections: [], targets: [], notSent: [], toResolve: [], pageContributions: [], notAdded: [], rules, confirmable: false, writePlan: null };
  if (result.blocker || destination.kind === "unresolved") return result;

  const resolutions = new Map(input.resolutions.map((resolution) => [resolution.key, resolution.choice]));
  /** The resolutions applied: the plan records them among its dependencies. */
  const resolved = new Set<string>();
  const notSent = (item: ItemSendListItem, reason: ItemSendNotSentReason) => result.notSent.push({ itemId: item.id, label: item.label, reason,
    ruleName: reason === "rule_skip" ? input.rules.get(item.id)?.ruleName ?? null : null });
  const ask = (entry: Omit<ItemSendToResolve, "page" | "heldItemIds" | "facts"> & Partial<Pick<ItemSendToResolve, "facts">>) =>
    result.toResolve.push({ page: null, heldItemIds: [], facts: null, ...entry });
  /** A choice the member made among the options shown, else null (a choice not offered is never applied). */
  const offered = (key: string, options: ItemSendOption[]) => {
    const choice = resolutions.get(key);
    if (!choice) return null;
    const match = options.find((option) => option.kind === choice.kind
      && (option.kind !== "line" || (choice.kind === "line" && option.estimateItemId.toLowerCase() === choice.estimateItemId.toLowerCase())));
    if (!match) return null;
    resolved.add(key);
    return choice;
  };
  const held = new Map<string, { page: number | null; itemIds: Set<string> }>();
  const earlierSections = new Map(input.earlier.sections.filter((section) => destination.kind === "existing_draft"
    && destination.sections.some(({ id }) => id === section.estimateItemId)).map((section) => [section.key, section.estimateItemId]));
  const createdSections = new Map<string, ItemSendSection>();
  const dpgfCandidates = (item: ItemSendListItem) => {
    if (item.origin.kind !== "dpgf") return [];
    const origin = item.origin;
    return draftLines.filter((line) => line.dpgf && line.dpgf.importId === origin.importId
      && (line.dpgf.mappedRowId === origin.mappedRowId || (line.dpgf.rawRowId !== null && line.dpgf.rawRowId === origin.rawRowId)));
  };
  // A DPGF line feeds one item at most: a line proven for an item, or chosen for one, is never offered to another.
  const claimed = new Map<string, string>();
  if (withDpgf) {
    for (const item of scoped) {
      const proven = dpgfCandidates(item);
      if (proven.length === 1) claimed.set(proven[0].id, item.id);
    }
  }

  for (const item of scoped) {
    const answer = answers.get(item.id);
    const rule = input.rules.get(item.id) ?? null;
    if (!answer) { notSent(item, "no_answer"); continue; }
    if (rule?.effect === "skipped") { notSent(item, "rule_skip"); continue; }
    if (input.affaireEntries.some((entry) => entry.itemId === item.id)) { notSent(item, "affaire_entry"); continue; }
    if (answer.decision?.kind === "set_aside") { notSent(item, "set_aside"); continue; }

    let parts: Part[];
    if (answer.entry) {
      if (!answer.entry.included) { notSent(item, "hypothesis_not_included"); continue; }
      parts = [{ kind: "entered", answer, observationIds: [], quantity: answer.entry.quantity, unit: answer.entry.unit, basis: null, page: null }];
    } else if (answer.outcome === "not_found") {
      notSent(item, "not_found"); continue;
    } else if (answer.outcome === "uncertain") {
      notSent(item, "uncertain"); continue;
    } else {
      if (answer.anomalies.length > 0 && answer.decision?.kind !== "accepted") {
        const key = `review:${item.id}`;
        if (offered(key, [{ kind: "leave_out" }])) { notSent(item, "left_out"); continue; }
        ask({ key, kind: "review_required", itemId: item.id, label: item.label, compartmentKey: null, options: [{ kind: "leave_out" }] });
        continue;
      }
      for (const observation of answer.observations) {
        if (observation.role !== "contribution") {
          result.notAdded.push({ itemId: item.id, observationId: observation.observationId, role: observation.role,
            quantity: observation.quantity, unit: observation.unit, page: observation.page });
        }
      }
      parts = answer.observations.filter((observation) => observation.role === "contribution" && observation.quantity !== null
        && Number.isFinite(observation.quantity) && observation.quantity > 0).map((observation) => ({ kind: "measured", answer,
        observationIds: [observation.observationId], quantity: observation.quantity!, unit: observation.unit, basis: observation.measurementBasis,
        page: observation.page }));
      if (parts.length === 0) { notSent(item, "empty"); continue; }
    }

    // One quantitative identity: one normalised unit (the item's expected one when it has one) and one basis.
    const units = new Set(parts.map((part) => unitCode(part.unit)));
    const unit = units.size === 1 ? [...units][0] : null;
    const bases = new Set(parts.flatMap((part) => (part.basis ? [part.basis] : [])));
    if (!unit || (item.expectedUnit && unitCode(item.expectedUnit) !== unit) || bases.size > 1
      || (item.measurementBasis && [...bases].some((basis) => basis !== item.measurementBasis))) {
      notSent(item, "unit_incompatible"); continue;
    }

    // A page another analysis brought into the estimate: its parts wait for the page decision, never counted twice.
    let leftOutByPage = 0;
    const sendable = parts.filter((part) => {
      if (part.kind !== "measured") return true;
      const page = input.pagesInEstimate.find((known) => known.page === null || part.page === null || known.page === part.page);
      if (!page) return true;
      const key = `page:${page.page ?? "all"}`;
      if (offered(key, [{ kind: "leave_out" }])) {
        leftOutByPage += 1;
        return false;
      }
      const entry = held.get(key) ?? { page: page.page, itemIds: new Set<string>() };
      entry.itemIds.add(item.id);
      held.set(key, entry);
      return false;
    });
    if (sendable.length === 0) {
      if (leftOutByPage === parts.length) notSent(item, "left_out");
      continue;
    }
    const added = round4(sendable.reduce((sum, part) => sum + part.quantity, 0));
    const contributions: ItemSendContribution[] = sendable.map((part) => ({ answerId: answer.answerId, answerRevision: answer.revision,
      kind: part.kind, observationIds: part.observationIds, quantity: part.quantity, unit: unit, pages: part.page === null ? [] : [part.page] }));
    const position = positions.get(item.id)!;
    const dpgfItem = item.origin.kind === "dpgf" && withDpgf;
    const compartment: ItemSendCompartment = dpgfItem ? { key: "dpgf", label: ITEM_SEND_DPGF_COMPARTMENT_LABEL, reason: null }
      : itemSendCompartment(input.breakdown, input.plan.location);
    const targetKey = `${item.id}|${compartment.key}`;
    const base = { key: targetKey, itemId: item.id, label: item.label, position, compartment, unit, contributions, rule };

    /** A line that already exists: its quantity typed by hand is protected, the rest is the policy's. */
    const feedExisting = (line: ItemSendDraftLine, kind: "dpgf_line" | "earlier_line", resolution: ItemSendChoice["kind"] | null,
      earlier: DpgfContribution[], reference: number | null) => {
      if (unitCode(line.unitCode) !== unit) {
        const key = `unit:${targetKey}`;
        if (offered(key, [{ kind: "leave_out" }])) { notSent(item, "left_out"); return; }
        ask({ key, kind: "unit_conflict", itemId: item.id, label: item.label, compartmentKey: compartment.key, options: [{ kind: "leave_out" }] });
        return;
      }
      const factor = lengthFactor({ unit_code: line.unitCode, description: null });
      const composed = (parts: DpgfContribution[]) => composeDpgfTarget(reference, parts);
      const fedBefore = earlier.length > 0;
      const expectedBefore = fedBefore ? roundedMeasure(composed(earlier).priced, factor) : reference;
      const typed = expectedBefore === null ? line.quantity !== 0 : !same(line.quantity, expectedBefore);
      const total = composed([...earlier, { job_id: input.job.id, item_ids: [answer.answerId], quantity: added, protective: 0, printed_gap: 0 }]);
      const retainedRaw = round4(total.priced);
      const retained = round4(roundedMeasure(retainedRaw, factor));
      let after = retained;
      let keptEntry = false;
      let choice: ItemSendChoice["kind"] | null = resolution;
      if (typed) {
        const key = `entry:${targetKey}`;
        const options: ItemSendOption[] = [{ kind: "keep_entry" }, { kind: "use_retained" }, { kind: "leave_out" }];
        const picked = offered(key, options);
        if (!picked) {
          ask({ key, kind: "entered_quantity", itemId: item.id, label: item.label, compartmentKey: compartment.key, options,
            facts: { reference, entered: line.quantity, measured: total.measured, retained } });
          return;
        }
        if (picked.kind === "leave_out") { notSent(item, "left_out"); return; }
        if (picked.kind === "keep_entry") {
          // Keeping an entry below what the policy retains would break the protective maximum: the line is not written.
          if (reference !== null && line.quantity + 1e-9 < retained) { notSent(item, "entry_suspended"); return; }
          after = line.quantity;
          keptEntry = true;
        }
        choice = picked.kind;
      }
      result.targets.push({ ...base, resolution: choice,
        line: { kind, estimateItemId: line.id, title: line.title, expectedUpdatedAt: line.updatedAt, expectedQuantity: line.quantity },
        quantity: { before: line.quantity, reference, entered: typed ? line.quantity : null,
          earlier: round4(earlier.reduce((sum, part) => sum + part.quantity, 0)), added, measured: total.measured, retained, after,
          roundedFrom: retained !== retainedRaw ? retainedRaw : null, gap: gapOf(reference, total.measured), keptEntry } });
    };

    /** A new line in the sections of the list (or the complementary section), each section by its identity. */
    const createLine = (resolution: ItemSendChoice["kind"] | null) => {
      const path = sectionPath(item, compartment, withDpgf);
      if (path.length > destination.maxSectionDepth) {
        const key = `depth:${targetKey}`;
        if (offered(key, [{ kind: "leave_out" }])) { notSent(item, "left_out"); return; }
        ask({ key, kind: "section_depth", itemId: item.id, label: item.label, compartmentKey: compartment.key, options: [{ kind: "leave_out" }] });
        return;
      }
      let parent: { key: string; existingId: string | null } | null = null;
      for (const [index, step] of path.entries()) {
        const reused = earlierSections.get(step.key);
        if (reused) {
          parent = { key: step.key, existingId: reused };
          continue;
        }
        if (!createdSections.has(step.key)) {
          // The draft's sections at that place (the root, or under a reused parent): one of the same title is never reused.
          const siblings = destination.kind === "existing_draft" && (parent === null || parent.existingId !== null)
            ? destination.sections.filter((section) => (section.parentId ?? null) === (parent?.existingId ?? null)) : [];
          createdSections.set(step.key, { key: step.key, title: step.title, parentKey: parent?.key ?? null,
            parentExistingId: parent?.existingId ?? null, depth: index + 1,
            homonymInDraft: siblings.some((section) => fold(section.title) === fold(step.title)) });
        }
        parent = { key: step.key, existingId: null };
      }
      const sectionKey = path.at(-1)!.key;
      const factor = lengthFactor({ unit_code: unit, description: null });
      const after = round4(roundedMeasure(added, factor));
      result.targets.push({ ...base, resolution,
        line: { kind: "new_line", sectionKey, sectionId: earlierSections.get(sectionKey) ?? null, title: rule?.designation ?? item.label },
        quantity: { before: null, reference: null, entered: null, earlier: 0, added, measured: added, retained: after, after,
          roundedFrom: after !== added ? added : null, gap: null, keptEntry: false } });
    };

    if (dpgfItem) {
      const candidates = dpgfCandidates(item);
      let line = candidates.length === 1 ? candidates[0] : null;
      let resolution: ItemSendChoice["kind"] | null = null;
      if (!line) {
        const key = `target:${targetKey}`;
        const pool = (candidates.length > 1 ? candidates : draftLines.filter((candidate) => candidate.dpgf && unitCode(candidate.unitCode) === unit))
          .filter((candidate) => (claimed.get(candidate.id) ?? item.id) === item.id);
        const options: ItemSendOption[] = [...pool.map((candidate) => ({ kind: "line" as const, estimateItemId: candidate.id, title: candidate.title })),
          { kind: "leave_out" }];
        const picked = offered(key, options);
        if (picked?.kind === "leave_out") { notSent(item, "left_out"); continue; }
        if (picked?.kind !== "line") {
          ask({ key, kind: candidates.length > 1 ? "target_multiple" : "target_missing", itemId: item.id, label: item.label,
            compartmentKey: compartment.key, options });
          continue;
        }
        line = draftLines.find((candidate) => candidate.id.toLowerCase() === picked.estimateItemId.toLowerCase())!;
        claimed.set(line.id, item.id);
        resolution = "line";
      }
      const v2 = input.earlier.targets.filter((target) => target.estimateItemId === line!.id).flatMap((target) => target.parts)
        .map((part) => ({ job_id: part.jobId, item_ids: [part.answerId ?? part.jobId], quantity: part.quantity, protective: 0, printed_gap: 0 }));
      feedExisting(line, "dpgf_line", resolution, [...earlierParts(line.dpgf!.composition, input.job.id), ...v2], line.dpgf!.reference);
      continue;
    }

    const ofItem = input.earlier.targets.filter((target) => target.itemId === item.id);
    if (ofItem.some((target) => target.breakdown !== input.breakdown)) {
      const key = `breakdown:${item.id}`;
      if (offered(key, [{ kind: "leave_out" }])) { notSent(item, "left_out"); continue; }
      ask({ key, kind: "breakdown_mixed", itemId: item.id, label: item.label, compartmentKey: compartment.key, options: [{ kind: "leave_out" }] });
      continue;
    }
    const earlier = ofItem.find((target) => target.compartmentKey === compartment.key);
    if (!earlier) { createLine(null); continue; }
    const line = draftLines.find((candidate) => candidate.id === earlier.estimateItemId);
    if (!line) {
      // The line an earlier send fed is gone (deleted in the editor): its parts left with it; a new line only by choice.
      const key = `target:${targetKey}`;
      const options: ItemSendOption[] = [{ kind: "new_line" }, { kind: "leave_out" }];
      const picked = offered(key, options);
      if (picked?.kind === "leave_out") { notSent(item, "left_out"); continue; }
      if (picked?.kind === "new_line") { createLine("new_line"); continue; }
      ask({ key, kind: "target_missing", itemId: item.id, label: item.label, compartmentKey: compartment.key, options });
      continue;
    }
    if (earlier.parts.some((part) => unitCode(part.unit) !== unit)) {
      const key = `unit:${targetKey}`;
      if (offered(key, [{ kind: "leave_out" }])) { notSent(item, "left_out"); continue; }
      ask({ key, kind: "unit_conflict", itemId: item.id, label: item.label, compartmentKey: compartment.key, options: [{ kind: "leave_out" }] });
      continue;
    }
    feedExisting(line, "earlier_line", null, earlier.parts.map((part) => ({ job_id: part.jobId, item_ids: [part.answerId ?? part.jobId],
      quantity: part.quantity, protective: 0, printed_gap: 0 })), null);
  }

  // A page already in the estimate: replacing its earlier parts or keeping both is decided with the confirmation; here
  // its parts are held, or left out by the member's choice.
  for (const [key, entry] of held) {
    result.toResolve.push({ key, kind: "page_decision", itemId: null, label: null, compartmentKey: null, page: entry.page,
      heldItemIds: [...entry.itemIds].sort((left, right) => positions.get(left)! - positions.get(right)!), options: [{ kind: "leave_out" }],
      facts: null });
  }

  const compartmentOrder = (compartment: ItemSendCompartment) => (compartment.key === "unallocated" ? 1 : 0);
  result.targets.sort((left, right) => left.position - right.position || compartmentOrder(left.compartment) - compartmentOrder(right.compartment)
    || left.compartment.label.localeCompare(right.compartment.label, "fr-FR"));
  result.sections = [...createdSections.values()];
  const pages = new Map<number, ItemSendPageContribution>();
  for (const target of result.targets) {
    for (const contribution of target.contributions) {
      for (const page of contribution.pages) {
        const entry = pages.get(page) ?? { page, itemIds: [], targetKeys: [], observationIds: [] };
        if (!entry.itemIds.includes(target.itemId)) entry.itemIds.push(target.itemId);
        if (!entry.targetKeys.includes(target.key)) entry.targetKeys.push(target.key);
        entry.observationIds.push(...contribution.observationIds);
        pages.set(page, entry);
      }
    }
  }
  result.pageContributions = [...pages.values()].sort((left, right) => left.page - right.page);
  if (result.targets.length === 0 && result.toResolve.length === 0) result.blocker = { reason: "no_line", engine };
  result.confirmable = result.blocker === null && result.toResolve.length === 0 && result.targets.length > 0;
  if (result.confirmable) result.writePlan = writePlanOf(input, result, destination, resolved);
  return result;
}

function writePlanOf(input: ItemSendInput, plan: ItemSendPlan, destination: Exclude<ItemSendDestinationState, { kind: "unresolved" }>,
  resolved: ReadonlySet<string>): ItemSendWritePlan {
  const positionsInSection = new Map<string, number>();
  return {
    format: ITEM_SEND_PLAN_FORMAT,
    version: ITEM_SEND_PLAN_VERSION,
    job_id: input.job.id,
    plan_key: input.plan.key,
    list: { revision_id: input.list.revisionId, revision: input.list.revision },
    destination: destination.kind === "first_draft" ? { kind: "first_draft" } : { kind: "existing_draft", version_id: destination.versionId },
    engine: 3,
    breakdown: input.breakdown,
    sections: plan.sections.map((section) => ({ key: section.key, title: section.title, parent_key: section.parentKey,
      parent_id: section.parentExistingId })),
    targets: plan.targets.map((target) => {
      const line = target.line;
      const written = line.kind === "new_line" ? (() => {
        const position = positionsInSection.get(line.sectionKey) ?? 0;
        positionsInSection.set(line.sectionKey, position + 1);
        return { kind: "new_line" as const, section_key: line.sectionKey, section_id: line.sectionId, title: line.title, unit_code: target.unit,
          position };
      })() : { kind: line.kind, estimate_item_id: line.estimateItemId, expected_updated_at: line.expectedUpdatedAt,
        expected_quantity: line.expectedQuantity };
      return {
        key: target.key,
        item_id: target.itemId,
        compartment_key: target.compartment.key,
        line: written,
        unit_code: target.unit,
        quantity_after: target.quantity.after,
        quantity: { reference: target.quantity.reference, entered: target.quantity.entered, earlier: target.quantity.earlier,
          added: target.quantity.added, measured: target.quantity.measured, retained: target.quantity.retained,
          rounded_from: target.quantity.roundedFrom, gap: target.quantity.gap, kept_entry: target.quantity.keptEntry },
        rule: target.rule && target.rule.effect !== "none" ? { rule_id: target.rule.ruleId, action: target.rule.action, effect: target.rule.effect,
          category_id: line.kind === "new_line" ? target.rule.categoryId : null, assembly_id: target.rule.assemblyId } : null,
        contributions: target.contributions.map((contribution) => ({ answer_id: contribution.answerId, answer_revision: contribution.answerRevision,
          kind: contribution.kind, observation_ids: contribution.observationIds, quantity: contribution.quantity, unit: contribution.unit,
          pages: contribution.pages })),
      };
    }),
    page_contributions: plan.pageContributions.map((page) => ({ page: page.page, item_ids: page.itemIds, target_keys: page.targetKeys,
      observation_ids: page.observationIds })),
    left_out: plan.notSent.map((entry) => ({ item_id: entry.itemId, reason: entry.reason })),
    dependencies: {
      answers: input.answers.map((answer) => ({ item_id: answer.itemId, answer_id: answer.answerId, revision: answer.revision,
        decision_revision: answer.decision?.revision ?? null, entry_revision: answer.entry?.revision ?? null })),
      affaire_entries: input.affaireEntries.map((entry) => ({ item_id: entry.itemId, revision: entry.revision })),
      location_generation: input.plan.location?.generation ?? null,
      earlier_targets: input.earlier.targets.map((target) => ({ estimate_item_id: target.estimateItemId, item_id: target.itemId,
        compartment_key: target.compartmentKey })),
      pages_in_estimate: input.pagesInEstimate.map((page) => ({ page: page.page, earlier_job_ids: [...page.earlierJobIds] })),
      resolutions: input.resolutions.filter((resolution) => resolved.has(resolution.key)),
    },
  };
}

/** An existing line as the write plan leaves it: its quantity only; every price input is the line's own. */
export function itemSendLineAfter<Line extends { id: string; quantity: number }>(line: Line,
  target: ItemSendWritePlan["targets"][number]): Line {
  if (target.line.kind === "new_line" || target.line.estimate_item_id !== line.id) return line;
  return { ...line, quantity: target.quantity_after };
}
