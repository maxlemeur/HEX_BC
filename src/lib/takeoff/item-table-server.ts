import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAffaireAccess, type AffaireAccess } from "@/lib/affaires/access-server";
import { mapSupabaseError, unprocessableEntity } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { asFiniteNumber, asRecord } from "@/lib/value-guards";
import type { Database } from "@/types/database";
import { ITEM_AGGREGATE_STATES, type ItemAggregateState } from "./item-answer-aggregation";
import { readCountMarkSummariesForAccess } from "./count-marks-server";
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
import {
  ITEM_HISTORY_EVENTS,
  type ItemHistoryResponse,
  type ItemSelectionResponse,
  type ItemTableLineResponse,
  type ItemTableResponse,
} from "./item-table-contracts";
import { QUANTITY_ENTRY_CATEGORIES, type QuantityEntryCategory } from "./quantity-entry";
import { isTakeoffUnitState, type TakeoffUnitState } from "./launch-request-coverage";
import { toPublicFailureCode } from "./request-activity";
import { describeTakeoffJobFailure } from "./visible-status";

/**
 * The one reader of the table of items (lot 4). The database pages, filters, orders and counts the table under the
 * affaire's read rule (public.read_takeoff_item_table and public.count_takeoff_item_table, migration
 * …_takeoff_item_review_decisions.sql), and decides each line's state and decision; this module reads the positive rows
 * of the page's answers for their anomalies and builds the lines. Every screen, frozen selection and review command reads
 * the table through it, with the member's session.
 *
 * Statements for a page, whatever the length of the list: the session's tenant membership and the affaire (its access),
 * the list's revision, the facets, the operator's right, the page itself (twice for an address past the end: the first
 * page is read instead), the positive rows of the page's answers (one statement per 500 rows), the tenant's confidence
 * threshold (when the page holds an answer) and the authors' names (when a decision or an entry is shown): 9, plus one
 * per 500 positive rows beyond the first 500, plus one past the end. The session's user is read from Auth, not SQL.
 */

type Client = SupabaseClient<Database>;

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
    row: (() => {
      const reviewed = observation.role === "contribution" && observation.takeoffItemId ? rows.get(observation.takeoffItemId) : undefined;
      return reviewed ? { quantity: reviewed.quantity, unit: reviewed.unit, isVerified: reviewed.isVerified,
        isExcluded: reviewed.isExcluded } : null;
    })(),
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
      .select("id, quantity, unit, is_verified, is_excluded, rules_stale, rule_results, confidence, evidence, source_page, metadata, quantity_entry_category")
      .eq("tenant_id", tenantId).in("id", ids.slice(start, start + ROWS_PER_READ));
    if (error) readFailure(error);
    for (const row of data ?? []) {
      rows.set(row.id, { id: row.id, quantity: Number(row.quantity), unit: row.unit, isVerified: row.is_verified === true,
        isExcluded: row.is_excluded, rulesStale: row.rules_stale === true,
        ruleResults: row.rule_results, confidence: row.confidence === null ? null : Number(row.confidence),
        evidence: row.evidence, sourcePage: row.source_page, metadata: row.metadata,
        quantityEntryCategory: row.quantity_entry_category });
    }
  }
  return rows;
}

/**
 * The counted marks revision of each answer (lot 5), as the member reads it: a selection carries it and an acceptance
 * compares it (an answer without marks is at 0).
 */
async function countMarksRevisions(client: Client, answerIds: readonly string[]) {
  const revisions = new Map<string, number>();
  for (let start = 0; start < answerIds.length; start += 500) {
    const { data, error } = await client.from("takeoff_count_answer_states").select("answer_id, revision")
      .in("answer_id", answerIds.slice(start, start + 500));
    if (error) throw mapSupabaseError(error, "Impossible de lire les repères des postes.");
    for (const row of data ?? []) revisions.set(row.answer_id, row.revision);
  }
  return revisions;
}

async function markedQuantities(access: AffaireAccess, revisions: ReadonlyMap<string, number>, answers: ReadonlyMap<string, TakeoffItemAnswer>) {
  const client = access.context.supabase as unknown as Client;
  const marks = new Map<string, NonNullable<ItemReadingInput["verifiedMarks"]>>();
  const decisions = new Map<string, NonNullable<ItemReadingInput["quantityDecision"]>>();
  const whole = new Map<string, NonNullable<ItemTableRow["wholeEntry"]>>();
  const marked = [...revisions].filter(([, revision]) => revision > 0).map(([answerId]) => answerId);
  // A PostgREST IN filter carries these UUIDs in the URL.
  const batchSize = 100;
  for (let start = 0; start < marked.length; start += batchSize) {
    const ids = marked.slice(start, start + batchSize);
    const items = [...new Set(ids.flatMap((id) => answers.get(id)?.itemId ?? []))];
    const [summaries, choices, totals] = await Promise.all([
      readCountMarkSummariesForAccess(access, ids),
      client.from("takeoff_item_answer_decisions").select("answer_id,quantity_source,marks_revision,chosen_entry_revision")
        .eq("tenant_id", access.context.tenantId).eq("project_id", access.project.id).eq("kind", "accepted").in("answer_id", ids),
      client.from("takeoff_item_entries").select("item_id,quantity,unit,included").eq("tenant_id", access.context.tenantId)
        .eq("project_id", access.project.id).is("plan_logical_id", null).in("item_id", items),
    ]);
    if (choices.error) readFailure(choices.error);
    if (totals.error) readFailure(totals.error);
    for (const [id, summary] of Object.entries(summaries)) marks.set(id, { revision: summary.revision, counted: summary.counted,
      unit: summary.unit, verified: summary.state === "verified", quantity: summary.quantity,
      pages: summary.pages.filter((page) => page.retained > 0).map((page) => page.page) });
    for (const row of choices.data ?? []) {
      const source = row.quantity_source;
      if ((source === "verified_count" || source === "entered" || source === "measured") && row.marks_revision !== null) {
        decisions.set(row.answer_id, { source, marksRevision: row.marks_revision, entryRevision: row.chosen_entry_revision });
      }
    }
    for (const row of totals.data ?? []) whole.set(row.item_id, { quantity: row.quantity, unit: row.unit, included: row.included });
  }
  return { marks, decisions, whole };
}

function rawReadings(row: TableRow) {
  return Array.isArray(row.readings) ? row.readings.map((entry) => asRecord(entry) ?? {}) : [];
}

/**
 * The reasons, in French, of the later readings that ended without an answer (a new measure that failed or was stopped),
 * read under the member's own rights: the public reason of a plan's analysis, never its code.
 */
async function endedAttemptReasons(client: Client, tenantId: string, jobIds: readonly string[]) {
  const reasons = new Map<string, string>();
  for (let start = 0; start < jobIds.length; start += ROWS_PER_READ) {
    const { data, error } = await client.from("takeoff_jobs").select("id, error_code")
      .eq("tenant_id", tenantId).in("id", jobIds.slice(start, start + ROWS_PER_READ));
    if (error) readFailure(error);
    for (const row of data ?? []) reasons.set(row.id, describeTakeoffJobFailure(toPublicFailureCode(row.error_code, true)));
  }
  return reasons;
}

/** A later reading asked of the plan than its current answer's: in flight, or ended without an answer. */
function laterAttempt(reading: Record<string, unknown>, answerJobId: string | null, unit: TakeoffUnitState) {
  const jobId = typeof reading.job_id === "string" ? reading.job_id : null;
  if (!answerJobId || !jobId || jobId.toLowerCase() === answerJobId.toLowerCase() || unit === "succeeded") return null;
  return { jobId, unit: unit === "not_started" ? "canceled" as const : unit };
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
  const endedAttempts = rows.flatMap((row) => rawReadings(row).flatMap((reading) => {
    const answerJobId = reading.answer ? answers.get(String(asRecord(reading.answer)?.answer_id))?.jobId ?? null : null;
    const attempt = isTakeoffUnitState(reading.unit_state) ? laterAttempt(reading, answerJobId, reading.unit_state) : null;
    return attempt && (attempt.unit === "failed" || attempt.unit === "canceled") ? [attempt.jobId] : [];
  }));
  const [contributions, lowConfidenceThreshold, marksRevisions, attemptReasons] = await Promise.all([
    contributionIds.length ? contributionRows(client, access.context.tenantId, contributionIds) : new Map<string, ItemContributionRow>(),
    answers.size ? getTakeoffLowConfidenceThresholdForTenant(access.context.tenantId) : Promise.resolve(0),
    answers.size ? countMarksRevisions(client, [...answers.keys()]) : new Map<string, number>(),
    endedAttempts.length ? endedAttemptReasons(client, access.context.tenantId, [...new Set(endedAttempts)]) : new Map<string, string>(),
  ]);
  const sources = await markedQuantities(access, marksRevisions, answers);
  return rows.map((row): ItemTableRow => {
    if (!isState(row.state) || !isDecision(row.decision)) throw new TypeError("Poste illisible.");
    const readings = rawReadings(row).map((reading): ItemReadingInput => {
      const answer = reading.answer ? answers.get(String(asRecord(reading.answer)?.answer_id)) ?? null : null;
      const unit = reading.unit_state;
      if (!isTakeoffUnitState(unit)) throw new TypeError("Lecture de poste illisible.");
      const attempt = laterAttempt(reading, answer?.jobId ?? null, unit);
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
        marksRevision: answer ? sources.marks.get(answer.answerId)?.revision ?? marksRevisions.get(answer.answerId) ?? 0 : 0,
        ...(answer && sources.marks.has(answer.answerId) ? { verifiedMarks: sources.marks.get(answer.answerId) } : {}),
        ...(answer && sources.decisions.has(answer.answerId) ? { quantityDecision: sources.decisions.get(answer.answerId) } : {}),
        entry: entryOf(reading.entry),
        sent: reading.sent === true,
        attempt: attempt ? { unit: attempt.unit, reason: attempt.unit === "failed" || attempt.unit === "canceled"
          ? attemptReasons.get(attempt.jobId) ?? describeTakeoffJobFailure(null) : null } : null,
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
      ...(sources.whole.has(row.item_id) ? { wholeEntry: sources.whole.get(row.item_id) } : {}),
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
  const { data, error } = await (access.context.supabase as unknown as Client).rpc("count_takeoff_item_table", {
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
  const { data, error } = await (access.context.supabase as unknown as Client).rpc("read_takeoff_item_table", {
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
  const [rows, facets, list] = await Promise.all([
    readRows(access, { scope: input.scope, itemIds: input.itemIds, offset: 0, limit: ITEM_REVIEW_LIMITS.items }),
    input.withPlans ? readFacets(access, { kind: "affaire" }) : Promise.resolve(emptyFacets()),
    input.withPlans ? latestList(access) : Promise.resolve(null),
  ]);
  const plans = plansOf(facets);
  return { lines: buildItemLines(await tableRows(access, rows), { plans, scope: input.scope }), plans, list };
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
    // The count SQL gives, never the rows returned: a page of the Data API holds 1 000 rows at most, so 1 001 items
    // matching would arrive as 1 000. Above the bound the selection is refused before anything is built.
    if (Math.max(rows.length, rows[0]?.matching_items ?? 0) > ITEM_REVIEW_LIMITS.items) throw new RangeError(ITEM_SELECTION_TOO_LARGE);
    const lines = buildItemLines(await tableRows(access, rows), { plans: [], scope: input.scope });
    return freezeItemSelection(lines, input.selection.kind === "items" ? input.selection.itemIds : null);
  } catch (error) {
    if (error instanceof RangeError) throw unprocessableEntity(error.message, undefined, "TAKEOFF_ITEM_SELECTION_TOO_LARGE");
    throw error;
  }
}

/**
 * The review history of one item: the journal's events of the line (takeoff_item_review_events), newest first, by pages,
 * read with the member's session under the affaire's read rule (the journal's own policy), with the authors' names.
 */
export async function readAffaireItemHistory(projectId: string, itemId: string, page: { offset: number; limit: number }):
  Promise<ItemHistoryResponse> {
  const access = await requireAffaireAccess(projectId, "read");
  const client = access.context.supabase as unknown as Client;
  const { data, error } = await client.from("takeoff_item_review_events")
    .select("id, event, plan_logical_id, takeoff_item_id, before, after, actor_id, at")
    .eq("tenant_id", access.context.tenantId).eq("project_id", access.project.id).eq("item_id", itemId)
    .order("id", { ascending: false }).range(page.offset, page.offset + page.limit);
  if (error) readFailure(error);
  const rows = data ?? [];
  const isEvent = (value: string): value is (typeof ITEM_HISTORY_EVENTS)[number] =>
    (ITEM_HISTORY_EVENTS as readonly string[]).includes(value);
  const events = rows.slice(0, page.limit).flatMap((row) => isEvent(row.event) ? [{
    id: Number(row.id), event: row.event, planKey: row.plan_logical_id, takeoffItemId: row.takeoff_item_id,
    before: asRecord(row.before) ?? null, after: asRecord(row.after) ?? null, actorId: row.actor_id, at: row.at,
  }] : []);
  const people = [...new Set(events.map(({ actorId }) => actorId))];
  const names: Record<string, string> = {};
  if (people.length) {
    const { data: profiles, error: namesError } = await client.from("profiles").select("id, full_name").in("id", people);
    if (namesError) throw mapSupabaseError(namesError, "Impossible de lire les auteurs des décisions sur les postes.");
    for (const profile of profiles ?? []) if (profile.full_name?.trim()) names[profile.id] = profile.full_name.trim();
  }
  return { projectId: access.project.id, itemId, events, offset: page.offset, limit: page.limit, hasMore: rows.length > page.limit,
    names };
}

export { reviewerRight as itemReviewerRight };
