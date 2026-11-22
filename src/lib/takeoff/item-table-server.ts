import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAffaireAccess, type AffaireAccess } from "@/lib/affaires/access-server";
import { mapSupabaseError, unprocessableEntity } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { asFiniteNumber, asRecord } from "@/lib/value-guards";
import type { Database } from "@/types/database";
import { ITEM_AGGREGATE_STATES, type ItemAggregateState } from "./item-answer-aggregation";
import { parseTakeoffItemAnswer, type TakeoffItemAnswer } from "./item-answers";
import { getTakeoffLowConfidenceThresholdForTenant } from "./feature-flags";
import {
  buildItemLines,
  freezeItemSelection,
  ITEM_LINE_DECISIONS,
  ITEM_REVIEW_LIMITS,
  ITEM_SELECTION_TOO_LARGE,
  ITEM_SET_ASIDE_REASONS,
  itemAnswerAnomalies,
  type ItemAnswerDecision,
  type ItemAnswerView,
  type ItemContributionRow,
  type ItemEntryView,
  type ItemLineDecision,
  type ItemReadingInput,
  type ItemSetAsideReason,
  type ItemTableFacets,
  type ItemTableFilter,
  type ItemTableLine,
  type ItemTablePlan,
  type ItemTableRow,
  type ItemTableScope,
} from "./item-table";
import type { ItemSelectionResponse, ItemTableLineResponse, ItemTableResponse } from "./item-table-contracts";
import { QUANTITY_ENTRY_CATEGORIES, type QuantityEntryCategory } from "./quantity-entry";
import { isTakeoffUnitState } from "./launch-request-coverage";

/**
 * The one reader of the table of items (lot 4). The database pages, filters, orders and counts the table under the
 * affaire's read rule (public.read_takeoff_item_table and public.count_takeoff_item_table, migration
 * …_takeoff_item_review_decisions.sql), and decides each line's state and decision; this module reads the positive rows
 * of the page's answers for their anomalies and builds the lines. Every screen, frozen selection and review command reads
 * the table through it, with the member's session.
 *
 * Statements for a page: the affaire's access, the table, its facets, the list's revision, the tenant's confidence
 * threshold, the positive rows of the page's answers (one per 500), the operator's right and the authors' names.
 */

type Client = SupabaseClient<Database>;
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;

const READ_FAILURE = "Impossible de lire les postes du métré.";
const ROWS_PER_READ = 500;

type TableRow = {
  item_id: string; item_position: number; label: string; expected_unit: string | null; sections: unknown;
  reference_quantity: number | string | null; origin_kind: string; dpgf_reference: string | null; family: string | null;
  state: string; expected: number; answered: number; in_flight: number; ended: number; decision: string;
  matching_items: number; page_offset: number; focus_found: boolean; readings: unknown; entry: unknown;
};
type FacetRow = { facet: string; value: string; label: string | null; items: number };

export type ItemTableQuery = {
  scope: ItemTableScope;
  filter: ItemTableFilter;
  offset: number;
  limit: number;
  focusItemId: string | null;
};

function rpc(client: Client): Rpc {
  return (client.rpc as unknown as Rpc).bind(client);
}

function readFailure(error: { message?: string }): never {
  throw mapSupabaseError(error as Parameters<typeof mapSupabaseError>[0], READ_FAILURE);
}

const isState = (value: unknown): value is ItemAggregateState => (ITEM_AGGREGATE_STATES as readonly unknown[]).includes(value);
const isDecision = (value: unknown): value is ItemLineDecision => (ITEM_LINE_DECISIONS as readonly unknown[]).includes(value);
const text = (value: unknown) => typeof value === "string" && value.length ? value : null;

function sectionTitles(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((section) => text(asRecord(section)?.title) ?? []) : [];
}

function decisionOf(value: unknown): ItemAnswerDecision | null {
  const row = asRecord(value);
  if (!row) return null;
  const base = { revision: asFiniteNumber(row.revision) ?? 0, actorId: String(row.actor_id), at: String(row.decided_at) };
  if (row.kind === "accepted") return { kind: "accepted", ...base };
  if (row.kind === "set_aside" && (ITEM_SET_ASIDE_REASONS as readonly unknown[]).includes(row.reason)) {
    return { kind: "set_aside", ...base, reason: row.reason as ItemSetAsideReason, note: text(row.note) };
  }
  return null;
}

function entryOf(value: unknown): ItemEntryView | null {
  const row = asRecord(value);
  if (!row) return null;
  const category = row.category as QuantityEntryCategory;
  if (!(category in QUANTITY_ENTRY_CATEGORIES)) throw new TypeError("Saisie de poste illisible.");
  const previousQuantity = asFiniteNumber(row.previous_quantity);
  return {
    itemId: String(row.item_id),
    scope: row.plan_logical_id ? "plan" : "affaire",
    planKey: text(row.plan_logical_id),
    revision: asFiniteNumber(row.revision) ?? 0,
    quantity: asFiniteNumber(row.quantity) ?? 0,
    unit: String(row.unit),
    category,
    note: text(row.note),
    included: row.included === true,
    actorId: String(row.actor_id),
    at: String(row.entered_at),
    previous: previousQuantity !== null && text(row.previous_unit) ? { quantity: previousQuantity, unit: String(row.previous_unit) } : null,
  };
}

function answerView(answer: TakeoffItemAnswer, rows: ReadonlyMap<string, ItemContributionRow>, context: {
  expectedUnit: string | null; lowConfidenceThreshold: number;
}): ItemAnswerView {
  const observations = answer.observations.flatMap((observation) => observation.quantity !== null && observation.unit ? [{
    observationId: observation.observationId,
    role: observation.role,
    quantity: observation.quantity,
    unit: observation.unit,
    page: observation.page,
    evidence: observation.evidence,
    confidence: observation.confidence,
    method: observation.method,
    takeoffItemId: observation.takeoffItemId,
  }] : []);
  const view: Omit<ItemAnswerView, "anomalies"> = {
    answerId: answer.answerId,
    revision: answer.revision,
    jobId: answer.jobId,
    outcome: answer.outcome,
    quantity: answer.quantity ? { quantity: answer.quantity.value, unit: answer.quantity.unit } : null,
    reasonCode: answer.reasonCode,
    reasonText: answer.reasonText,
    searchedPages: answer.searchedPages,
    unreadablePages: answer.unreadablePages,
    observations,
    candidate: answer.candidate ? { quantity: answer.candidate.value, unit: answer.candidate.unit } : null,
    readAt: answer.publishedAt,
  };
  return { ...view, anomalies: itemAnswerAnomalies({ ...view, observations }, rows, context) };
}

/** The positive rows the page's measured answers count (takeoff_items), read with the member's session. */
async function contributionRows(client: Client, tenantId: string, ids: readonly string[]) {
  const rows = new Map<string, ItemContributionRow>();
  for (let start = 0; start < ids.length; start += ROWS_PER_READ) {
    const { data, error } = await client.from("takeoff_items")
      .select("id, is_excluded, rules_stale, rule_results, confidence, evidence, source_page, metadata, quantity_entry_category")
      .eq("tenant_id", tenantId).in("id", ids.slice(start, start + ROWS_PER_READ));
    if (error) readFailure(error);
    for (const row of data ?? []) {
      rows.set(row.id, { id: row.id, isExcluded: row.is_excluded, rulesStale: row.rules_stale === true,
        ruleResults: row.rule_results, confidence: row.confidence === null ? null : Number(row.confidence),
        evidence: row.evidence, sourcePage: row.source_page, metadata: row.metadata,
        quantityEntryCategory: row.quantity_entry_category });
    }
  }
  return rows;
}

function rawReadings(row: TableRow) {
  return Array.isArray(row.readings) ? row.readings.map((entry) => asRecord(entry) ?? {}) : [];
}

/** The rows of the database as the model reads them, with each answer's anomalies. */
async function tableRows(access: AffaireAccess, rows: readonly TableRow[]): Promise<ItemTableRow[]> {
  const client = access.context.supabase as unknown as Client;
  const answers = new Map<string, TakeoffItemAnswer>();
  for (const row of rows) {
    for (const reading of rawReadings(row)) {
      if (reading.answer) {
        const answer = parseTakeoffItemAnswer(reading.answer);
        answers.set(answer.answerId, answer);
      }
    }
  }
  const contributionIds = [...answers.values()].flatMap((answer) => answer.observations
    .flatMap((observation) => observation.role === "contribution" && observation.takeoffItemId ? [observation.takeoffItemId] : []));
  const [contributions, lowConfidenceThreshold] = await Promise.all([
    contributionIds.length ? contributionRows(client, access.context.tenantId, contributionIds) : new Map<string, ItemContributionRow>(),
    answers.size ? getTakeoffLowConfidenceThresholdForTenant(access.context.tenantId) : Promise.resolve(0),
  ]);
  return rows.map((row): ItemTableRow => {
    if (!isState(row.state) || !isDecision(row.decision)) throw new TypeError("Poste illisible.");
    const readings = rawReadings(row).map((reading): ItemReadingInput => {
      const answer = reading.answer ? answers.get(String(asRecord(reading.answer)?.answer_id)) ?? null : null;
      const unit = reading.unit_state;
      if (!isTakeoffUnitState(unit)) throw new TypeError("Lecture de poste illisible.");
      return {
        itemId: row.item_id,
        planKey: String(reading.plan_logical_id),
        planName: text(reading.plan_name) ?? "Plan",
        location: text(reading.location_label),
        unit,
        reading: reading.reading === "answered" || reading.reading === "in_flight" ? reading.reading : "ended",
        answer: answer ? answerView(answer, contributions, { expectedUnit: row.expected_unit, lowConfidenceThreshold }) : null,
        decision: decisionOf(reading.decision),
        decisionRevision: asFiniteNumber(reading.decision_revision) ?? 0,
        entry: entryOf(reading.entry),
      };
    });
    return {
      item: {
        id: row.item_id,
        position: row.item_position,
        label: row.label,
        expectedUnit: row.expected_unit,
        sectionPath: sectionTitles(row.sections),
        referenceQuantity: row.reference_quantity === null ? null : Number(row.reference_quantity),
        dpgfReference: row.dpgf_reference,
        origin: row.origin_kind === "dpgf" || row.origin_kind === "template" ? row.origin_kind : "manual",
      },
      state: row.state,
      coverage: { expected: row.expected, answered: row.answered, inFlight: row.in_flight, ended: row.ended },
      decision: row.decision,
      readings,
      entry: entryOf(row.entry),
    };
  });
}

function emptyFacets(): ItemTableFacets {
  return {
    states: Object.fromEntries(ITEM_AGGREGATE_STATES.map((state) => [state, 0])) as ItemTableFacets["states"],
    decisions: Object.fromEntries(ITEM_LINE_DECISIONS.map((decision) => [decision, 0])) as ItemTableFacets["decisions"],
    families: [], locations: [], plans: [],
  };
}

async function readFacets(access: AffaireAccess, scope: ItemTableScope): Promise<ItemTableFacets> {
  const { data, error } = await rpc(access.context.supabase as unknown as Client)("count_takeoff_item_table", {
    p_tenant_id: access.context.tenantId, p_project_id: access.project.id,
    ...(scope.kind === "plan" ? { p_plan_logical_id: scope.planKey } : {}),
  });
  if (error) readFailure(error);
  const facets = emptyFacets();
  for (const row of (data ?? []) as FacetRow[]) {
    if (row.facet === "state" && isState(row.value)) facets.states[row.value] = row.items;
    else if (row.facet === "decision" && isDecision(row.value)) facets.decisions[row.value] = row.items;
    else if (row.facet === "family") facets.families.push({ value: row.value, count: row.items });
    else if (row.facet === "location") facets.locations.push({ value: row.value, label: row.label ?? row.value, count: row.items });
    else if (row.facet === "plan") facets.plans.push({ key: row.value, name: row.label ?? "Plan", count: row.items });
  }
  const byLabel = new Intl.Collator("fr", { numeric: true });
  facets.families.sort((left, right) => byLabel.compare(left.value, right.value));
  facets.locations.sort((left, right) => byLabel.compare(left.label, right.label));
  facets.plans.sort((left, right) => byLabel.compare(left.name, right.name));
  return facets;
}

async function readRows(access: AffaireAccess, input: { scope: ItemTableScope; filter?: ItemTableFilter; itemIds?: readonly string[];
  focusItemId?: string | null; offset: number; limit: number }) {
  const filter = input.filter ?? {};
  const { data, error } = await rpc(access.context.supabase as unknown as Client)("read_takeoff_item_table", {
    p_tenant_id: access.context.tenantId, p_project_id: access.project.id,
    ...(input.scope.kind === "plan" ? { p_plan_logical_id: input.scope.planKey } : {}),
    ...(filter.states?.length ? { p_states: filter.states } : {}),
    ...(filter.families?.length ? { p_families: filter.families } : {}),
    ...(filter.locations?.length ? { p_locations: filter.locations } : {}),
    ...(filter.decisions?.length ? { p_decisions: filter.decisions } : {}),
    ...(input.itemIds ? { p_item_ids: [...input.itemIds] } : {}),
    ...(input.focusItemId ? { p_focus_item_id: input.focusItemId } : {}),
    p_offset: input.offset, p_limit: input.limit,
  });
  if (error) readFailure(error);
  return (data ?? []) as TableRow[];
}

async function latestList(access: AffaireAccess) {
  const { data, error } = await access.context.supabase.from("takeoff_list_revisions").select("id, revision, item_count")
    .eq("tenant_id", access.context.tenantId).eq("project_id", access.project.id).order("revision", { ascending: false }).limit(1);
  if (error) readFailure(error);
  const [row] = (data ?? []) as Array<{ id: string; revision: number; item_count: number }>;
  return row ? { revisionId: row.id, revision: row.revision, itemCount: row.item_count } : null;
}

async function reviewerRight(access: AffaireAccess) {
  const { context, project } = access;
  const { data, error } = await createServiceRoleClient().rpc("takeoff_item_list_may_write", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_actor: context.userId,
  });
  if (error) throw mapSupabaseError(error, "Impossible de vérifier les droits sur les postes.");
  return data === true;
}

async function memberNames(client: Client, lines: readonly ItemTableLine[]) {
  const people = [...new Set(lines.flatMap((line) => [
    ...(line.entry ? [line.entry.actorId] : []),
    ...line.readings.flatMap(({ decision, entry }) => [...(decision ? [decision.actorId] : []), ...(entry ? [entry.actorId] : [])]),
  ]))].filter(Boolean);
  const names: Record<string, string> = {};
  if (!people.length) return names;
  const { data, error } = await client.from("profiles").select("id, full_name").in("id", people);
  if (error) throw mapSupabaseError(error, "Impossible de lire les auteurs des décisions sur les postes.");
  for (const profile of data ?? []) if (profile.full_name?.trim()) names[profile.id] = profile.full_name.trim();
  return names;
}

const plansOf = (facets: ItemTableFacets): ItemTablePlan[] => facets.plans.map(({ key, name }) => ({ key, name, location: null }));

/**
 * The lines of the items a command or a preview names, in a scope, built from what is stored now (outside any filter):
 * what the server decides a gesture on. `plans`: the plans the list was read on, for a new measure.
 */
export async function loadItemLines(access: AffaireAccess, input: { scope: ItemTableScope; itemIds: readonly string[];
  withPlans?: boolean }) {
  const [rows, facets] = await Promise.all([
    readRows(access, { scope: input.scope, itemIds: input.itemIds, offset: 0, limit: ITEM_REVIEW_LIMITS.items }),
    input.withPlans ? readFacets(access, { kind: "affaire" }) : Promise.resolve(emptyFacets()),
  ]);
  const plans = plansOf(facets);
  return { lines: buildItemLines(await tableRows(access, rows), { plans, scope: input.scope }), plans };
}

/** A page of the table for any reader of the affaire; the gestures it offers are for its takeoff operators. */
export async function readAffaireItemTable(projectId: string, query: ItemTableQuery): Promise<ItemTableResponse> {
  const access = await requireAffaireAccess(projectId, "read");
  const [list, facets, canReview] = await Promise.all([latestList(access), readFacets(access, query.scope), reviewerRight(access)]);
  let rows = list ? await readRows(access, { ...query, offset: query.offset, limit: query.limit }) : [];
  // A page past the end (the filter shrank since the address was written) reads the first page.
  if (list && !rows.length && query.offset > 0) rows = await readRows(access, { ...query, offset: 0, limit: query.limit });
  const plans = plansOf(facets);
  const lines = buildItemLines(await tableRows(access, rows), { plans, scope: query.scope });
  return {
    projectId: access.project.id,
    canReview,
    list,
    scope: query.scope,
    filter: query.filter,
    plans,
    facets,
    page: { lines, total: rows[0]?.matching_items ?? 0, offset: rows[0]?.page_offset ?? 0, limit: query.limit,
      focusFound: rows[0]?.focus_found ?? false },
    names: await memberNames(access.context.supabase as unknown as Client, lines),
    observedAt: new Date().toISOString(),
  };
}

/** One item of the list on its own, outside any filter (a link of the radar, the detail of an item); null when absent. */
export async function readAffaireItemLine(projectId: string, itemId: string): Promise<ItemTableLineResponse | null> {
  const access = await requireAffaireAccess(projectId, "read");
  const [{ lines, plans }, canReview] = await Promise.all([
    loadItemLines(access, { scope: { kind: "affaire" }, itemIds: [itemId], withPlans: true }),
    reviewerRight(access),
  ]);
  const [line] = lines;
  if (!line) return null;
  return { projectId: access.project.id, canReview, line, plans,
    names: await memberNames(access.context.supabase as unknown as Client, lines) };
}

/**
 * The frozen selection of a filter (every result, beyond the page shown) or of the items a member ticked: each item with
 * the revisions its command will name, the count and what each gesture may do with it. Above its bound it is refused.
 */
export async function freezeAffaireItemSelection(projectId: string, input: {
  scope: ItemTableScope;
  selection: { kind: "filter"; filter: ItemTableFilter } | { kind: "items"; itemIds: string[] };
}): Promise<ItemSelectionResponse> {
  const access = await requireAffaireAccess(projectId, "read");
  const rows = await readRows(access, { scope: input.scope, offset: 0, limit: ITEM_REVIEW_LIMITS.items + 1,
    ...(input.selection.kind === "filter" ? { filter: input.selection.filter } : { itemIds: input.selection.itemIds }) });
  try {
    if (rows.length > ITEM_REVIEW_LIMITS.items) throw new RangeError(ITEM_SELECTION_TOO_LARGE);
    const lines = buildItemLines(await tableRows(access, rows), { plans: [], scope: input.scope });
    return freezeItemSelection(lines, input.selection.kind === "items" ? input.selection.itemIds : null);
  } catch (error) {
    if (error instanceof RangeError) throw unprocessableEntity(error.message, undefined, "TAKEOFF_ITEM_SELECTION_TOO_LARGE");
    throw error;
  }
}

export { reviewerRight as itemReviewerRight };
