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
import { PLAN_LOCATION_LABEL_MAX } from "@/lib/takeoff/plan-location";
import type { Poste, PosteQualifiers } from "@/lib/takeoff/poste-list";
import { QUANTITY_REVIEW_PERCENT } from "@/lib/takeoff/quantity-policy";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";

/**
 * Lot 4, PR 5a: from what was retained for one plan to what the estimate would become (« Unité d'envoi »,
 * « Regroupement », « Découpage », « DPGF et saisies », « Garde de pages », « Correspondances silencieuses et prix »).
 * Pure and client-safe: the server reads every fact, this module decides, and the writer of a later pull request checks
 * the same facts again under its locks before it writes the plan this module returns. Nothing here writes.
 *
 * - The unit of a send stays « the retained lines of this plan »: an accepted measure or an included entry. Each item of
 *   the plan's sealed scope is either sent (a target), not sent with its reason (a measure nobody accepted among them),
 *   or to resolve by an explicit choice. An alternative reading (PDF/vector, an overlap page, a detail plan) is never
 *   added; every part not sent is listed with its observations, pages and quantity.
 * - A target is one line of the estimate for one item in one compartment of the breakdown: a DPGF line where it is,
 *   proven through the import's raw row and live for no other item, a line an earlier send wrote for the same item and
 *   compartment, or a new line in the sections of the list (lot then family), each section by its identity, never by a
 *   homonymous title. Parts add only within one quantitative identity (unit, basis, network, material, diameter). A
 *   length is rounded once, on the sum of the compartment; a quantity engine 3 cannot write is to resolve.
 * - A quantity typed by hand is never overwritten without a choice; the DPGF policy (the protective maximum, its
 *   cumulative gap, the check above 1 %) is the one of dpgf-composition.ts and quantity-policy.ts, unchanged.
 * - A page another analysis already brought into the estimate is never counted again without its page decision: a
 *   measure on it, or an entry of the plan, whose pages are the plan's. The items of one page's first send share one
 *   page contribution.
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

/** What an engine 3 line holds (estimate_items.quantity, numeric(12,3)): three decimals, at most this value. */
export const ITEM_SEND_QUANTITY_LIMITS = { decimals: 3, max: 999_999_999.999 } as const;

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
  /** The plan's pages the answer covers (searched and unreadable): where an entry of this plan stands. */
  pages: readonly number[];
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
  /**
   * A DPGF line: the import and raw row its provenance proves (null when nothing proves them: no automatic target), its
   * DPGF quantity as imported, and what it holds of earlier takeoffs.
   */
  dpgf: {
    importId: string | null;
    mappedRowId: string | null;
    rawRowId: string | null;
    reference: number | null;
    composition: StoredDpgfComposition;
  } | null;
};

export type ItemSendDestinationState =
  | { kind: "first_draft"; engine: EstimateEngineVersion | null; maxSectionDepth: number }
  | { kind: "existing_draft"; versionId: string; engine: EstimateEngineVersion | null; maxSectionDepth: number;
    sections: readonly ItemSendDraftSection[]; lines: readonly ItemSendDraftLine[] }
  | { kind: "unresolved"; reason: "choose_destination" | "issued_only" };

/**
 * A target an earlier send by item wrote in this draft, live, with the parts it holds (migration C; none until it
 * exists). Each part keeps its sources and its quantitative identity, so that another identity never adds to it.
 */
export type ItemSendEarlierTarget = {
  itemId: string;
  breakdown: ItemSendBreakdown;
  compartmentKey: string;
  estimateItemId: string;
  parts: ReadonlyArray<{
    jobId: string;
    answerId: string | null;
    observationIds: readonly string[];
    quantity: number;
    unit: string;
    basis: string | null;
    qualifiers: Pick<PosteQualifiers, "network" | "material" | "diameter">;
    pages: readonly number[];
    planKey: string | null;
  }>;
};
export type ItemSendEarlierSection = { key: string; estimateItemId: string };

/** A page of this plan's document that another analysis already brought into the draft. */
export type ItemSendPageInEstimate = { page: number | null; earlierJobIds: readonly string[]; estimateItemIds: readonly string[] };

/**
 * What else the confirmation must find unchanged, which the server reads and the writer compares again: the job's rule
 * stamp, the draft's peers stamp, lot 3's send context, the DPGF imports the draft's lines come from, and the settings a
 * first draft would be created with.
 */
export type ItemSendStamps = {
  job: string | null;
  peers: string | null;
  context: { peers: string; locations: string } | null;
  dpgf: ReadonlyArray<{ importId: string; updatedAt: string; status: string; rowCount: number }>;
  firstDraftSettings: Readonly<Record<string, unknown>> | null;
};

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
  /** Some confirmed location of the affaire names a building: « Par niveau » then never allocates a level without one. */
  affaireNamesBuilding: boolean;
  stamps: ItemSendStamps;
  resolutions: readonly ItemSendResolution[];
};

// --------------------------------------------------------------------------------------------------------------- outputs

export type ItemSendBlockerReason = "not_completed" | "already_sent" | "read_only" | "choose_destination" | "issued_only"
  | "engine_not_v3" | "engine_policy_v2" | "dpgf_import_required" | "no_line";
export type ItemSendBlocker = { reason: ItemSendBlockerReason; engine: number | null };

export type ItemSendUnallocatedReason = "location_unknown" | "location_multiple" | "location_to_confirm";
export type ItemSendCompartment = { key: string; label: string; reason: ItemSendUnallocatedReason | null };

/** The quantitative identity of a part: what must be equal for two parts to add. */
export type ItemSendIdentity = { unit: string; basis: string | null; network: string | null; material: string | null; diameter: string | null };

export type ItemSendContribution = {
  answerId: string;
  answerRevision: string;
  kind: "measured" | "entered";
  observationIds: string[];
  quantity: number;
  unit: string;
  pages: number[];
  identity: ItemSendIdentity;
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
  /** The DPGF policy's cumulative gap to the reference (printed gaps included, no compensation), and its check. */
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

export type ItemSendNotSentReason = "set_aside" | "not_accepted" | "not_found" | "uncertain" | "empty" | "unit_incompatible"
  | "hypothesis_not_included" | "rule_skip" | "affaire_entry" | "no_answer" | "left_out" | "entry_suspended";
export type ItemSendNotSent = { itemId: string; label: string; reason: ItemSendNotSentReason; ruleName: string | null };

/** A part of an answer that does not enter the estimate, with what it would have brought. */
export type ItemSendPartNotSent = {
  itemId: string;
  kind: "measured" | "entered";
  observationIds: string[];
  pages: number[];
  quantity: number;
  unit: string | null;
  /** page_held: its page waits for the page decision; otherwise the item's own reason, or the member's « leave out ». */
  reason: "page_held" | ItemSendNotSentReason;
};

export type ItemSendToResolveKind = "target_missing" | "target_multiple" | "identity_conflict" | "entered_quantity"
  | "breakdown_mixed" | "page_decision" | "section_depth" | "quantity_unwritable";
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
  /** A page waiting for its decision, the items whose parts on it are held, and the estimate's lines already there. */
  page: number | null;
  heldItemIds: string[];
  earlierLines: Array<{ estimateItemId: string; title: string | null; quantity: number }>;
  options: ItemSendOption[];
  facts: { reference: number | null; entered: number | null; measured: number; retained: number } | null;
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
  ruleVersion: string | null; action: ItemSendRuleAction; effect: ItemSendRuleEffectKind; assemblyId: string | null };

type SnakeIdentity = { unit: string; basis: string | null; network: string | null; material: string | null; diameter: string | null };

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
    /** A new line goes after the section's existing children, in `order` among the send's new lines of that section. */
    line: { kind: "dpgf_line" | "earlier_line"; estimate_item_id: string; expected_updated_at: string; expected_quantity: number }
      | { kind: "new_line"; section_key: string; section_id: string | null; title: string; unit_code: string; order: number };
    unit_code: string;
    quantity_after: number;
    quantity: { reference: number | null; entered: number | null; earlier: number; added: number; measured: number; retained: number;
      rounded_from: number | null; gap: { absolute: number; percent: number | null; requires_review: boolean } | null; kept_entry: boolean };
    rule: { rule_id: string | null; rule_version: string | null; action: ItemSendRuleAction; effect: ItemSendRuleEffectKind;
      category_id: string | null; assembly_id: string | null } | null;
    contributions: Array<{ answer_id: string; answer_revision: string; kind: "measured" | "entered"; observation_ids: string[];
      quantity: number; unit: string; pages: number[]; identity: SnakeIdentity }>;
  }>;
  page_contributions: Array<{ page: number; item_ids: string[]; target_keys: string[]; observation_ids: string[] }>;
  left_out: Array<{ item_id: string; reason: ItemSendNotSentReason; rule_id: string | null; rule_version: string | null }>;
  parts_not_sent: Array<{ item_id: string; kind: "measured" | "entered"; observation_ids: string[]; pages: number[]; quantity: number;
    unit: string | null; reason: ItemSendPartNotSent["reason"] }>;
  /** What the plan was computed from: the writer reads each again under its locks and refuses the plan when one moved. */
  dependencies: {
    answers: Array<{ item_id: string; answer_id: string; revision: string; decision_revision: number | null; entry_revision: number | null }>;
    affaire_entries: Array<{ item_id: string; revision: number }>;
    rules: Array<{ item_id: string; rule_id: string; rule_version: string | null; action: ItemSendRuleAction; effect: ItemSendRuleEffectKind }>;
    location_generation: number | null;
    earlier_targets: Array<{ estimate_item_id: string; item_id: string; compartment_key: string; breakdown: ItemSendBreakdown;
      parts: Array<{ job_id: string; answer_id: string | null; observation_ids: string[]; quantity: number; pages: number[];
        plan_key: string | null; identity: SnakeIdentity }> }>;
    lines: Array<{ estimate_item_id: string; updated_at: string; quantity: number; dpgf: { import_id: string | null; raw_row_id: string | null;
      reference: number | null } | null }>;
    pages_in_estimate: Array<{ page: number | null; earlier_job_ids: string[]; estimate_item_ids: string[] }>;
    stamps: { job: string | null; peers: string | null; context: { peers: string; locations: string } | null;
      dpgf: Array<{ import_id: string; updated_at: string; status: string; row_count: number }>;
      first_draft_settings: Readonly<Record<string, unknown>> | null };
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
  partsNotSent: ItemSendPartNotSent[];
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
/** A basis or a qualifier as the reading compares them: without case, accents or punctuation (poste-exchange-merge.ts). */
const folded = (value: string | null | undefined) => {
  const text = (value ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return text.length > 0 ? text : null;
};
const byText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const KNOWN = new Set(["confirmed", "corrected"]);

/** Whether engine 3 can hold this quantity as it is shown: three decimals at most, within its ceiling. */
export function itemSendQuantityWritable(value: number) {
  const scaled = value * 10 ** ITEM_SEND_QUANTITY_LIMITS.decimals;
  return Number.isFinite(value) && value >= 0 && value <= ITEM_SEND_QUANTITY_LIMITS.max && Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

type Located = { known: true; value: string; key: string } | { known: false; reason: ItemSendUnallocatedReason };

/** A location field an operator confirmed or set, within lot 3's bound: else why it places nothing. */
function locatedField(field: ItemSendLocationField | undefined): Located {
  const value = field?.value?.trim() ?? "";
  if (field && KNOWN.has(field.state) && value.length > 0 && [...value].length <= PLAN_LOCATION_LABEL_MAX) {
    return { known: true, value, key: fold(value) };
  }
  if (field?.state === "multiple") return { known: false, reason: "location_multiple" };
  if (field?.state === "proposed") return { known: false, reason: "location_to_confirm" };
  return { known: false, reason: "location_unknown" };
}

const unallocated = (reason: ItemSendUnallocatedReason): ItemSendCompartment => ({ key: "unallocated", label: ITEM_SEND_UNALLOCATED_LABEL, reason });

/**
 * The compartment of the parts of one plan: « Ensemble »; by level, the plan's building and level; by building, its
 * building. A field unknown, several or only proposed → « Non réparti ». A level without a building is a compartment
 * only while no confirmed location of the affaire names a building. The key encodes the folded values as a JSON array:
 * no two locations share it, and each value is bounded by lot 3's 40 characters.
 */
export function itemSendCompartment(breakdown: ItemSendBreakdown, location: ItemSendPlanLocation | null,
  affaireNamesBuilding: boolean): ItemSendCompartment {
  if (breakdown === "together") return { key: "together", label: ITEM_SEND_BREAKDOWN_LABELS.together, reason: null };
  if (!location) return unallocated("location_unknown");
  const building = locatedField(location.building);
  if (breakdown === "by_building") {
    return building.known ? { key: `building:${JSON.stringify([building.key])}`, label: building.value, reason: null }
      : unallocated(building.reason);
  }
  const level = locatedField(location.level);
  if (!level.known) return unallocated(level.reason);
  if (!building.known && (building.reason !== "location_unknown" || affaireNamesBuilding)) return unallocated(building.reason);
  return building.known
    ? { key: `level:${JSON.stringify([building.key, level.key])}`, label: `${building.value} · ${level.value}`, reason: null }
    : { key: `level:${JSON.stringify([null, level.key])}`, label: level.value, reason: null };
}

type Part = {
  kind: "measured" | "entered";
  answer: ItemSendAnswer;
  observationIds: string[];
  quantity: number;
  unit: string | null;
  basis: string | null;
  pages: number[];
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

/** What a DPGF line holds of earlier takeoffs of the first format (its stored composition), other than this job's. */
function storedParts(stored: StoredDpgfComposition, jobId: string): DpgfContribution[] {
  if (stored.version === 2) return stored.contributions.filter((part) => part.job_id !== jobId);
  if (stored.version === 1) return stored.job_id === jobId ? [] : upgradeDpgfComposition(stored, []).contributions;
  return [];
}

/** The policy's gap (composeDpgfTarget): the cumulative gap, printed gaps included, judged against 1 % of the reference. */
function gapOf(reference: number | null, composed: ReturnType<typeof composeDpgfTarget>): ItemSendGap | null {
  if (reference === null || composed.absolute_gap === null) return null;
  const absolute = composed.absolute_gap;
  return { absolute, percent: reference > 0 ? round4(absolute / reference * 100) : null,
    requiresReview: absolute > reference * QUANTITY_REVIEW_PERCENT / 100 + 1e-9 };
}

const identityOf = (unit: string, basis: string | null, qualifiers: Pick<PosteQualifiers, "network" | "material" | "diameter">)
  : ItemSendIdentity => ({ unit, basis: folded(basis), network: folded(qualifiers.network), material: folded(qualifiers.material),
  diameter: folded(qualifiers.diameter) });
const sameIdentity = (left: ItemSendIdentity, right: ItemSendIdentity) => left.unit === right.unit && left.basis === right.basis
  && left.network === right.network && left.material === right.material && left.diameter === right.diameter;
const snakeIdentity = (identity: ItemSendIdentity): SnakeIdentity => ({ ...identity });

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
      ruleVersion: rule.ruleVersion, action: rule.action, effect: rule.effect, assemblyId: rule.assemblyId }] : [];
  });
  const draftLines = destination.kind === "existing_draft" ? destination.lines : [];
  const withDpgf = draftLines.some((line) => line.dpgf !== null);
  // Decided on the whole sealed list: a plan asked about its complement only still needs the DPGF in the draft.
  const listHoldsDpgf = input.items.some((item) => item.origin.kind === "dpgf");

  const blockerReason: ItemSendBlockerReason | null = input.job.sent ? "already_sent"
    : input.job.status !== "completed" ? "not_completed"
      : !input.job.canEdit ? "read_only"
        : destination.kind === "unresolved" ? destination.reason
          : !itemSendEngineFits(engine) ? (destination.kind === "first_draft" ? "engine_policy_v2" : "engine_not_v3")
            : listHoldsDpgf && !withDpgf ? "dpgf_import_required" : null;
  const result: ItemSendPlan = { blocker: blockerReason ? { reason: blockerReason, engine } : null, breakdown: input.breakdown, engine,
    sections: [], targets: [], notSent: [], partsNotSent: [], toResolve: [], pageContributions: [], notAdded: [], rules, confirmable: false,
    writePlan: null };
  if (result.blocker || destination.kind === "unresolved") return result;

  const resolutions = new Map(input.resolutions.map((resolution) => [resolution.key, resolution.choice]));
  /** The resolutions applied: the plan records them among its dependencies. */
  const resolved = new Set<string>();
  const ask = (entry: Omit<ItemSendToResolve, "page" | "heldItemIds" | "earlierLines" | "facts"> & Partial<Pick<ItemSendToResolve, "facts">>) =>
    result.toResolve.push({ page: null, heldItemIds: [], earlierLines: [], facts: null, ...entry });
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
  const partOut = (item: ItemSendListItem, part: Part, reason: ItemSendPartNotSent["reason"]) => result.partsNotSent.push({ itemId: item.id,
    kind: part.kind, observationIds: [...part.observationIds], pages: [...part.pages], quantity: part.quantity, unit: part.unit, reason });
  const notSent = (item: ItemSendListItem, reason: ItemSendNotSentReason, parts: readonly Part[] = []) => {
    result.notSent.push({ itemId: item.id, label: item.label, reason,
      ruleName: reason === "rule_skip" ? input.rules.get(item.id)?.ruleName ?? null : null });
    for (const part of parts) partOut(item, part, reason);
  };
  const held = new Map<string, { page: number | null; itemIds: Set<string>; lineIds: Set<string> }>();
  const earlierSections = new Map(input.earlier.sections.filter((section) => destination.kind === "existing_draft"
    && destination.sections.some(({ id }) => id === section.estimateItemId)).map((section) => [section.key, section.estimateItemId]));
  const createdSections = new Map<string, ItemSendSection>();

  // A line feeds one item at most: a line live for an item in this draft (an earlier send), proven for an item of this
  // plan, or chosen for one, is neither another item's target nor offered to it.
  const claims = new Map<string, Set<string>>();
  const claim = (lineId: string, itemId: string) => claims.set(lineId, new Set([...(claims.get(lineId) ?? []), itemId]));
  for (const target of input.earlier.targets) claim(target.estimateItemId, target.itemId);
  // Free for an item when nothing else holds it: a line live for two items (never written so) is free for neither.
  const free = (lineId: string, itemId: string) => [...(claims.get(lineId) ?? [])].every((holder) => holder === itemId);
  const dpgfCandidates = (item: ItemSendListItem) => {
    if (item.origin.kind !== "dpgf") return [];
    const origin = item.origin;
    // Proven only: a line whose provenance names the item's raw row of its import. Matching metadata alone proves nothing.
    return draftLines.filter((line) => line.dpgf && line.dpgf.rawRowId !== null && line.dpgf.importId === origin.importId
      && line.dpgf.rawRowId === origin.rawRowId && free(line.id, item.id));
  };
  if (withDpgf) {
    for (const item of scoped) {
      const proven = dpgfCandidates(item);
      if (proven.length === 1) claim(proven[0].id, item.id);
    }
  }

  for (const item of scoped) {
    const answer = answers.get(item.id);
    const rule = input.rules.get(item.id) ?? null;
    if (!answer) { notSent(item, "no_answer"); continue; }
    const measuredParts = (): Part[] => answer.observations.filter((observation) => observation.role === "contribution"
      && observation.quantity !== null && Number.isFinite(observation.quantity) && observation.quantity > 0).map((observation) => ({
      kind: "measured", answer, observationIds: [observation.observationId], quantity: observation.quantity!, unit: observation.unit,
      basis: observation.measurementBasis, pages: observation.page === null ? [] : [observation.page] }));
    if (rule?.effect === "skipped") { notSent(item, "rule_skip", measuredParts()); continue; }
    if (input.affaireEntries.some((entry) => entry.itemId === item.id)) { notSent(item, "affaire_entry", measuredParts()); continue; }
    if (answer.decision?.kind === "set_aside") { notSent(item, "set_aside", measuredParts()); continue; }

    let parts: Part[];
    if (answer.entry) {
      // An entry is this plan's part for the item: it stands on the plan's pages, as any part of this plan does.
      const entered: Part = { kind: "entered", answer, observationIds: [], quantity: answer.entry.quantity, unit: answer.entry.unit, basis: null,
        pages: [...new Set(answer.pages)].sort((left, right) => left - right) };
      if (!answer.entry.included) { notSent(item, "hypothesis_not_included", [entered]); continue; }
      parts = [entered];
    } else if (answer.outcome === "not_found") {
      notSent(item, "not_found"); continue;
    } else if (answer.outcome === "uncertain") {
      notSent(item, "uncertain"); continue;
    } else {
      for (const observation of answer.observations) {
        if (observation.role !== "contribution") {
          result.notAdded.push({ itemId: item.id, observationId: observation.observationId, role: observation.role,
            quantity: observation.quantity, unit: observation.unit, page: observation.page });
        }
      }
      parts = measuredParts();
      // Only what was retained is sent: a measure nobody accepted waits for its acceptance in the table of items.
      if (answer.decision?.kind !== "accepted") { notSent(item, "not_accepted", parts); continue; }
      if (parts.length === 0) { notSent(item, "empty"); continue; }
    }

    // One quantitative identity: one normalised unit (the item's expected one when it has one) and one basis, both
    // compared as the reading compares them.
    const units = new Set(parts.map((part) => unitCode(part.unit)));
    const unit = units.size === 1 ? [...units][0] : null;
    const bases = new Set(parts.flatMap((part) => (folded(part.basis) ? [folded(part.basis)!] : [])));
    const itemBasis = folded(item.measurementBasis);
    if (!unit || (item.expectedUnit && unitCode(item.expectedUnit) !== unit) || bases.size > 1
      || (itemBasis && [...bases].some((basis) => basis !== itemBasis))) {
      notSent(item, "unit_incompatible", parts); continue;
    }
    const identity = identityOf(unit, [...bases][0] ?? item.measurementBasis, item.qualifiers);

    // A page another analysis brought into the estimate: its parts wait for the page decision, never counted twice.
    const sendable = parts.filter((part) => {
      const overlap = input.pagesInEstimate.filter((known) => known.page === null || part.pages.length === 0 || part.pages.includes(known.page));
      if (overlap.length === 0) return true;
      const keys = overlap.map((known) => `page:${known.page ?? "all"}`);
      const waiting = keys.filter((key) => !offered(key, [{ kind: "leave_out" }]));
      if (waiting.length === 0) { partOut(item, part, "left_out"); return false; }
      for (const [index, key] of keys.entries()) {
        if (!waiting.includes(key)) continue;
        const entry = held.get(key) ?? { page: overlap[index].page, itemIds: new Set<string>(), lineIds: new Set<string>() };
        entry.itemIds.add(item.id);
        for (const id of overlap[index].estimateItemIds) entry.lineIds.add(id);
        held.set(key, entry);
      }
      partOut(item, part, "page_held");
      return false;
    });
    if (sendable.length === 0) {
      if (result.partsNotSent.filter((entry) => entry.itemId === item.id).every((entry) => entry.reason === "left_out")) {
        result.notSent.push({ itemId: item.id, label: item.label, reason: "left_out", ruleName: null });
      }
      continue;
    }
    const added = round4(sendable.reduce((sum, part) => sum + part.quantity, 0));
    const contributions: ItemSendContribution[] = sendable.map((part) => ({ answerId: answer.answerId, answerRevision: answer.revision,
      kind: part.kind, observationIds: part.observationIds, quantity: part.quantity, unit, pages: part.pages, identity }));
    const leaveOut = () => notSent(item, "left_out", sendable);
    const position = positions.get(item.id)!;
    const dpgfItem = item.origin.kind === "dpgf" && withDpgf;
    const compartment: ItemSendCompartment = dpgfItem ? { key: "dpgf", label: ITEM_SEND_DPGF_COMPARTMENT_LABEL, reason: null }
      : itemSendCompartment(input.breakdown, input.plan.location, input.affaireNamesBuilding);
    const targetKey = `${item.id}|${compartment.key}`;
    const base = { key: targetKey, itemId: item.id, label: item.label, position, compartment, unit, contributions, rule };

    /** A quantity engine 3 cannot write as shown is to resolve, never rounded silently after the preview. */
    const writable = (after: number, facts: NonNullable<ItemSendToResolve["facts"]>) => {
      if (itemSendQuantityWritable(after)) return true;
      const key = `quantity:${targetKey}`;
      if (offered(key, [{ kind: "leave_out" }])) { leaveOut(); return false; }
      ask({ key, kind: "quantity_unwritable", itemId: item.id, label: item.label, compartmentKey: compartment.key,
        options: [{ kind: "leave_out" }], facts });
      return false;
    };
    const identityConflict = () => {
      const key = `identity:${targetKey}`;
      if (offered(key, [{ kind: "leave_out" }])) { leaveOut(); return; }
      ask({ key, kind: "identity_conflict", itemId: item.id, label: item.label, compartmentKey: compartment.key, options: [{ kind: "leave_out" }] });
    };

    /** A line that already exists: its quantity typed by hand is protected, the rest is the policy's. */
    const feedExisting = (line: ItemSendDraftLine, kind: "dpgf_line" | "earlier_line", resolution: ItemSendChoice["kind"] | null,
      earlier: DpgfContribution[], reference: number | null) => {
      if (unitCode(line.unitCode) !== unit) { identityConflict(); return; }
      const factor = lengthFactor({ unit_code: line.unitCode, description: null });
      const composed = (all: DpgfContribution[]) => composeDpgfTarget(reference, all);
      const expectedBefore = earlier.length > 0 ? roundedMeasure(composed(earlier).priced, factor) : reference;
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
        if (picked.kind === "leave_out") { leaveOut(); return; }
        if (picked.kind === "keep_entry") {
          // Keeping an entry below what the policy retains would break the protective maximum: the line is not written.
          if (reference !== null && line.quantity + 1e-9 < retained) { notSent(item, "entry_suspended", sendable); return; }
          after = line.quantity;
          keptEntry = true;
        }
        choice = picked.kind;
      }
      if (!writable(after, { reference, entered: typed ? line.quantity : null, measured: total.measured, retained })) return;
      result.targets.push({ ...base, resolution: choice,
        line: { kind, estimateItemId: line.id, title: line.title, expectedUpdatedAt: line.updatedAt, expectedQuantity: line.quantity },
        quantity: { before: line.quantity, reference, entered: typed ? line.quantity : null,
          earlier: round4(earlier.reduce((sum, part) => sum + part.quantity, 0)), added, measured: total.measured, retained, after,
          roundedFrom: retained !== retainedRaw ? retainedRaw : null, gap: gapOf(reference, total), keptEntry } });
    };

    /** A new line in the sections of the list (or the complementary section), each section by its identity. */
    const createLine = (resolution: ItemSendChoice["kind"] | null) => {
      const path = sectionPath(item, compartment, withDpgf);
      if (path.length > destination.maxSectionDepth) {
        const key = `depth:${targetKey}`;
        if (offered(key, [{ kind: "leave_out" }])) { leaveOut(); return; }
        ask({ key, kind: "section_depth", itemId: item.id, label: item.label, compartmentKey: compartment.key, options: [{ kind: "leave_out" }] });
        return;
      }
      const factor = lengthFactor({ unit_code: unit, description: null });
      const after = round4(roundedMeasure(added, factor));
      if (!writable(after, { reference: null, entered: null, measured: added, retained: after })) return;
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
      result.targets.push({ ...base, resolution,
        line: { kind: "new_line", sectionKey, sectionId: earlierSections.get(sectionKey) ?? null, title: rule?.designation ?? item.label },
        quantity: { before: null, reference: null, entered: null, earlier: 0, added, measured: added, retained: after, after,
          roundedFrom: after !== added ? added : null, gap: null, keptEntry: false } });
    };

    /** This item's earlier parts on a line, refused (null) when one has another quantitative identity. */
    const earlierOf = (target: ItemSendEarlierTarget): DpgfContribution[] | null => {
      const identities = target.parts.map((part) => identityOf(unitCode(part.unit) ?? "", part.basis, part.qualifiers));
      if (!identities.every((other) => sameIdentity(other, identity))) return null;
      return target.parts.map((part) => ({ job_id: part.jobId, item_ids: [part.answerId ?? part.jobId], quantity: part.quantity, protective: 0,
        printed_gap: 0 }));
    };

    if (dpgfItem) {
      const candidates = dpgfCandidates(item);
      let line = candidates.length === 1 ? candidates[0] : null;
      let resolution: ItemSendChoice["kind"] | null = null;
      if (!line) {
        const key = `target:${targetKey}`;
        const pool = (candidates.length > 1 ? candidates : draftLines.filter((candidate) => candidate.dpgf && unitCode(candidate.unitCode) === unit))
          .filter((candidate) => free(candidate.id, item.id));
        const options: ItemSendOption[] = [...pool.map((candidate) => ({ kind: "line" as const, estimateItemId: candidate.id, title: candidate.title })),
          { kind: "leave_out" }];
        const picked = offered(key, options);
        if (picked?.kind === "leave_out") { leaveOut(); continue; }
        if (picked?.kind !== "line") {
          ask({ key, kind: candidates.length > 1 ? "target_multiple" : "target_missing", itemId: item.id, label: item.label,
            compartmentKey: compartment.key, options });
          continue;
        }
        line = draftLines.find((candidate) => candidate.id.toLowerCase() === picked.estimateItemId.toLowerCase())!;
        claim(line.id, item.id);
        resolution = "line";
      }
      const targetLine = line;
      // Only this item's earlier parts accumulate (the claims already keep a line of another item out of reach).
      const own = input.earlier.targets.filter((target) => target.estimateItemId === targetLine.id && target.itemId === item.id).map(earlierOf);
      if (own.some((entry) => entry === null)) { identityConflict(); continue; }
      feedExisting(targetLine, "dpgf_line", resolution, [...storedParts(targetLine.dpgf!.composition, input.job.id),
        ...own.flatMap((entry) => entry ?? [])], targetLine.dpgf!.reference);
      continue;
    }

    const ofItem = input.earlier.targets.filter((target) => target.itemId === item.id);
    if (ofItem.some((target) => target.breakdown !== input.breakdown)) {
      const key = `breakdown:${item.id}`;
      if (offered(key, [{ kind: "leave_out" }])) { leaveOut(); continue; }
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
      if (picked?.kind === "leave_out") { leaveOut(); continue; }
      if (picked?.kind === "new_line") { createLine("new_line"); continue; }
      ask({ key, kind: "target_missing", itemId: item.id, label: item.label, compartmentKey: compartment.key, options });
      continue;
    }
    const earlierParts = earlierOf(earlier);
    if (!earlierParts) { identityConflict(); continue; }
    feedExisting(line, "earlier_line", null, earlierParts, null);
  }

  // A page already in the estimate: replacing its earlier parts or keeping both is decided with the confirmation; here
  // its parts are held, or left out by the member's choice. The preview names the estimate's lines already on it.
  for (const [key, entry] of [...held.entries()].sort(([left], [right]) => byText(left, right))) {
    result.toResolve.push({ key, kind: "page_decision", itemId: null, label: null, compartmentKey: null, page: entry.page,
      heldItemIds: [...entry.itemIds].sort((left, right) => positions.get(left)! - positions.get(right)!),
      earlierLines: [...entry.lineIds].sort(byText).flatMap((id) => {
        const line = draftLines.find((candidate) => candidate.id === id);
        return line ? [{ estimateItemId: line.id, title: line.title, quantity: line.quantity }] : [];
      }),
      options: [{ kind: "leave_out" }], facts: null });
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
  const orderInSection = new Map<string, number>();
  const lines = destination.kind === "existing_draft" ? destination.lines : [];
  const usedLines = new Set([...plan.targets.flatMap((target) => (target.line.kind === "new_line" ? [] : [target.line.estimateItemId])),
    ...input.earlier.targets.map((target) => target.estimateItemId), ...input.pagesInEstimate.flatMap((page) => page.estimateItemIds)]);
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
        const order = (orderInSection.get(line.sectionKey) ?? 0) + 1;
        orderInSection.set(line.sectionKey, order);
        return { kind: "new_line" as const, section_key: line.sectionKey, section_id: line.sectionId, title: line.title, unit_code: target.unit,
          order };
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
          rounded_from: target.quantity.roundedFrom,
          gap: target.quantity.gap ? { absolute: target.quantity.gap.absolute, percent: target.quantity.gap.percent,
            requires_review: target.quantity.gap.requiresReview } : null,
          kept_entry: target.quantity.keptEntry },
        rule: target.rule && target.rule.effect !== "none" ? { rule_id: target.rule.ruleId, rule_version: target.rule.ruleVersion,
          action: target.rule.action, effect: target.rule.effect, category_id: line.kind === "new_line" ? target.rule.categoryId : null,
          assembly_id: target.rule.assemblyId } : null,
        contributions: target.contributions.map((contribution) => ({ answer_id: contribution.answerId, answer_revision: contribution.answerRevision,
          kind: contribution.kind, observation_ids: [...contribution.observationIds].sort(byText), quantity: contribution.quantity,
          unit: contribution.unit, pages: contribution.pages, identity: snakeIdentity(contribution.identity) })),
      };
    }),
    page_contributions: plan.pageContributions.map((page) => ({ page: page.page, item_ids: page.itemIds, target_keys: page.targetKeys,
      observation_ids: [...page.observationIds].sort(byText) })),
    left_out: plan.notSent.map((entry) => {
      const rule = entry.reason === "rule_skip" ? input.rules.get(entry.itemId) ?? null : null;
      return { item_id: entry.itemId, reason: entry.reason, rule_id: rule?.ruleId ?? null, rule_version: rule?.ruleVersion ?? null };
    }),
    parts_not_sent: plan.partsNotSent.map((part) => ({ item_id: part.itemId, kind: part.kind, observation_ids: part.observationIds,
      pages: part.pages, quantity: part.quantity, unit: part.unit, reason: part.reason })),
    dependencies: {
      answers: [...input.answers].sort((left, right) => byText(left.itemId, right.itemId)).map((answer) => ({ item_id: answer.itemId,
        answer_id: answer.answerId, revision: answer.revision, decision_revision: answer.decision?.revision ?? null,
        entry_revision: answer.entry?.revision ?? null })),
      affaire_entries: [...input.affaireEntries].sort((left, right) => byText(left.itemId, right.itemId))
        .map((entry) => ({ item_id: entry.itemId, revision: entry.revision })),
      rules: [...input.scope].sort(byText).flatMap((itemId) => {
        const rule = input.rules.get(itemId);
        return rule?.ruleId ? [{ item_id: itemId, rule_id: rule.ruleId, rule_version: rule.ruleVersion, action: rule.action,
          effect: rule.effect }] : [];
      }),
      location_generation: input.plan.location?.generation ?? null,
      earlier_targets: [...input.earlier.targets].sort((left, right) => byText(left.estimateItemId, right.estimateItemId)
        || byText(left.itemId, right.itemId) || byText(left.compartmentKey, right.compartmentKey)).map((target) => ({
        estimate_item_id: target.estimateItemId, item_id: target.itemId, compartment_key: target.compartmentKey, breakdown: target.breakdown,
        parts: target.parts.map((part) => ({ job_id: part.jobId, answer_id: part.answerId, observation_ids: [...part.observationIds].sort(byText),
          quantity: part.quantity, pages: [...part.pages].sort((left, right) => left - right), plan_key: part.planKey,
          identity: snakeIdentity(identityOf(unitCode(part.unit) ?? part.unit, part.basis, part.qualifiers)) }))
          .sort((left, right) => byText(JSON.stringify([left.job_id, left.answer_id, left.observation_ids]),
            JSON.stringify([right.job_id, right.answer_id, right.observation_ids]))),
      })),
      lines: lines.filter((line) => usedLines.has(line.id)).sort((left, right) => byText(left.id, right.id)).map((line) => ({
        estimate_item_id: line.id, updated_at: line.updatedAt, quantity: line.quantity,
        dpgf: line.dpgf ? { import_id: line.dpgf.importId, raw_row_id: line.dpgf.rawRowId, reference: line.dpgf.reference } : null })),
      pages_in_estimate: [...input.pagesInEstimate].sort((left, right) => (left.page ?? 0) - (right.page ?? 0)).map((page) => ({
        page: page.page, earlier_job_ids: [...page.earlierJobIds].sort(byText), estimate_item_ids: [...page.estimateItemIds].sort(byText) })),
      stamps: { job: input.stamps.job, peers: input.stamps.peers, context: input.stamps.context,
        dpgf: [...input.stamps.dpgf].sort((left, right) => byText(left.importId, right.importId)).map((entry) => ({ import_id: entry.importId,
          updated_at: entry.updatedAt, status: entry.status, row_count: entry.rowCount })),
        first_draft_settings: input.stamps.firstDraftSettings },
      resolutions: input.resolutions.filter((resolution) => resolved.has(resolution.key))
        .sort((left, right) => byText(left.key, right.key)),
    },
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "number") return Object.is(value, -0) ? "0" : JSON.stringify(value);
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => byText(left, right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The write plan in one spelling: keys sorted, sets in a stable order (fixed when the plan is built), one spelling per
 * number. Its digest is what a confirmation sends back; the writer recomputes the plan under its locks and compares.
 */
export function itemSendPlanCanonical(plan: ItemSendWritePlan): string {
  return canonical(plan);
}
