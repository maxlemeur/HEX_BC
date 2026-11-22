import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAffaireAccess, type AffaireAccess } from "@/lib/affaires/access-server";
import { mapSupabaseError, unprocessableEntity } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";
import { readStoredItemList } from "./item-list-server";
import {
  buildItemTable,
  freezeItemSelection,
  pageItemTable,
  type ItemEntryView,
  type ItemReadingInput,
  type ItemTableFilter,
  type ItemTablePlan,
  type ItemTablePoste,
  type ItemTableScope,
  type ItemTableView,
} from "./item-table";
import type { ItemSelectionResponse, ItemTableResponse } from "./item-table-contracts";
import type { PosteRevision } from "./poste-list";

/**
 * The one reader of the table of items (lot 4): the affaire's stored list revision, the plans it was read on, each plan's
 * answer to each item with its review decision, and the quantities members entered. Every screen, frozen selection and
 * review command reads the table through this module, under the affaire's own read rule.
 *
 * The answers and their decisions are read in `readItemReviewFacts` alone. Until the stored answers of an item on a plan
 * exist in the database (migration B1 of lot 4) and their decisions (B2), it reads none: every item of the list is
 * « to measure ».
 */

type Client = SupabaseClient<Database>;

export type ItemTableQuery = {
  scope: ItemTableScope;
  filter: ItemTableFilter;
  offset: number;
  limit: number;
  focusItemId: string | null;
};

type ItemReviewFacts = { plans: ItemTablePlan[]; readings: ItemReadingInput[]; entries: ItemEntryView[] };

function tablePostes(revision: PosteRevision): ItemTablePoste[] {
  return revision.items.map((item, position) => ({
    id: item.id,
    position,
    label: item.label,
    expectedUnit: item.expectedUnit,
    sectionPath: item.sections.map(({ title }) => title),
    referenceQuantity: item.referenceQuantity,
    dpgfReference: item.origin.kind === "dpgf" ? item.origin.reference : null,
    origin: item.origin.kind,
  }));
}

/**
 * The plans the list was read on, each plan's answer to each item it was asked about with its decision, and the
 * entered quantities. Read with the member's session, so that each fact follows its own policy.
 */
async function readItemReviewFacts(access: AffaireAccess, list: { revisionId: string }): Promise<ItemReviewFacts> {
  void access;
  void list;
  return { plans: [], readings: [], entries: [] };
}

async function reviewerRight(access: AffaireAccess) {
  const { context, project } = access;
  const { data, error } = await createServiceRoleClient().rpc("takeoff_item_list_may_write", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_actor: context.userId,
  });
  if (error) throw mapSupabaseError(error, "Impossible de vérifier les droits sur les postes.");
  return data === true;
}

async function memberNames(client: Client, ids: Iterable<string>) {
  const people = [...new Set(ids)].filter(Boolean);
  const names: Record<string, string> = {};
  if (!people.length) return names;
  const { data, error } = await client.from("profiles").select("id, full_name").in("id", people);
  if (error) throw mapSupabaseError(error, "Impossible de lire les auteurs des décisions sur les postes.");
  for (const profile of data ?? []) if (profile.full_name?.trim()) names[profile.id] = profile.full_name.trim();
  return names;
}

export type LoadedItemTable = {
  access: AffaireAccess;
  list: { revisionId: string; revision: number; itemCount: number } | null;
  facts: ItemReviewFacts;
  view: ItemTableView;
};

/** The table in a scope, built from what is stored now: what a page shows and what a command checks before it writes. */
export async function loadItemTable(projectId: string, scope: ItemTableScope, filter: ItemTableFilter = {},
  access?: AffaireAccess): Promise<LoadedItemTable> {
  const affaire = access ?? await requireAffaireAccess(projectId, "read");
  const { context, project } = affaire;
  const stored = await readStoredItemList(context.supabase as unknown as Client,
    { tenantId: context.tenantId, projectId: project.id });
  const list = stored ? { revisionId: stored.row.id, revision: stored.row.revision, itemCount: stored.row.item_count } : null;
  const facts = list ? await readItemReviewFacts(affaire, list) : { plans: [], readings: [], entries: [] };
  const view = buildItemTable({ items: stored ? tablePostes(stored.revision) : [], plans: facts.plans, readings: facts.readings,
    entries: facts.entries, scope, filter });
  return { access: affaire, list, facts, view };
}

/** A page of the table for any reader of the affaire; the gestures it offers are for its takeoff operators. */
export async function readAffaireItemTable(projectId: string, query: ItemTableQuery): Promise<ItemTableResponse> {
  const { access, list, facts, view } = await loadItemTable(projectId, query.scope, query.filter);
  const page = pageItemTable(view.lines, { offset: query.offset, limit: query.limit, focusItemId: query.focusItemId });
  const actors = page.lines.flatMap((line) => [
    ...(line.entry ? [line.entry.actorId] : []),
    ...line.readings.flatMap(({ decision, entry }) => [...(decision ? [decision.actorId] : []), ...(entry ? [entry.actorId] : [])]),
  ]);
  const [canReview, names] = await Promise.all([
    reviewerRight(access),
    memberNames(access.context.supabase as unknown as Client, actors),
  ]);
  return {
    projectId: access.project.id,
    canReview,
    list,
    scope: query.scope,
    filter: query.filter,
    plans: facts.plans,
    facets: view.facets,
    page,
    names,
    observedAt: new Date().toISOString(),
  };
}

/**
 * The frozen selection of a filter (every result, beyond the page shown) or of the items a member ticked: each item with
 * the revisions its command will name, the count and what each gesture may do with it.
 */
export async function freezeAffaireItemSelection(projectId: string, input: {
  scope: ItemTableScope;
  selection: { kind: "filter"; filter: ItemTableFilter } | { kind: "items"; itemIds: string[] };
}): Promise<ItemSelectionResponse> {
  const { view } = await loadItemTable(projectId, input.scope, input.selection.kind === "filter" ? input.selection.filter : {});
  try {
    return freezeItemSelection(view, input.selection.kind === "filter" ? { kind: "filter" }
      : { kind: "items", itemIds: input.selection.itemIds });
  } catch (error) {
    if (error instanceof RangeError) throw unprocessableEntity(error.message, undefined, "TAKEOFF_ITEM_SELECTION_TOO_LARGE");
    throw error;
  }
}

export { reviewerRight as itemReviewerRight };
