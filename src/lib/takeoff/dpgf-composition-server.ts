import "server-only";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { readAllRowsInChunks } from "@/lib/supabase/read-all";
import { normalizeTakeoffComparisonItems } from "@/lib/takeoff/dpgf-comparison-preparation";
import {
  readStoredDpgfComposition,
  upgradeDpgfComposition,
  type DpgfContribution,
} from "@/lib/takeoff/dpgf-composition";
import type { DpgfApplyComposition } from "@/lib/takeoff/dpgf-apply-quantities";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import type { AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

// TI-682 lot D4: what each DPGF target of a version holds, read from the target itself (its policy) and the frozen
// takeoff lines it names, with the user's session (RLS). A version 1 policy (one takeoff, written before D4) is read as a
// composition from its lines; the application receives that reading in its permit and binds it to the target.

type Context = Pick<AuthenticatedTakeoffContext, "supabase" | "tenantId">;

/** A frozen takeoff line a composition names: where it was read, and what it brings. */
export type DpgfComposedLine = {
  item_id: string;
  job_id: string;
  designation: string;
  source_file_name: string | null;
  source_page: number | null;
};

export type DpgfComposedJob = { id: string; created_at: string; level: string | null };

export type DpgfTargetComposition = {
  target_id: string;
  updated_at: string;
  /** 0: no policy fed it; 1: a version 1 policy (one takeoff); 2: a composition. */
  version: 0 | 1 | 2;
  /** A version 1 policy read as one block (its lines no longer give back what it wrote). */
  unsplit: boolean;
  contributions: DpgfContribution[];
  /** For a version 1 policy, its takeoff and lines, as the permit binds them. */
  version_one: { job_id: string; item_ids: string[] } | null;
};

export type DpgfCompositions = {
  targets: Map<string, DpgfTargetComposition>;
  lines: Map<string, DpgfComposedLine>;
  jobs: Map<string, DpgfComposedJob>;
};

type ItemRow = Pick<TakeoffJobItem, "id" | "designation" | "quantity" | "unit" | "source_file_name" | "source_page"
  | "metadata" | "is_excluded" | "confidence" | "evidence"> & { job_id: string };

function readFailed(error: unknown, message: string): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
}

async function readItems(context: Context, ids: readonly string[]): Promise<ItemRow[]> {
  if (!ids.length) return [];
  const { data, error } = await readAllRowsInChunks(ids, (chunk) => context.supabase.from("takeoff_items" as never)
    .select("id,job_id,designation,quantity,unit,source_file_name,source_page,metadata,is_excluded,confidence,evidence" as never,
      { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).in("id" as never, chunk as never) as never);
  if (error) readFailed(error, "Impossible de lire les métrés qui alimentent les lignes DPGF.");
  return (data ?? []) as unknown as ItemRow[];
}

async function readJobs(context: Context, ids: readonly string[]): Promise<DpgfComposedJob[]> {
  if (!ids.length) return [];
  const { data, error } = await readAllRowsInChunks(ids, (chunk) => context.supabase.from("takeoff_jobs" as never)
    .select("id,created_at,level" as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).in("id" as never, chunk as never) as never);
  if (error) readFailed(error, "Impossible de lire les métrés qui alimentent les lignes DPGF.");
  return (data ?? []) as unknown as DpgfComposedJob[];
}

/** The compositions of the given DPGF targets (the version's DPGF lines, as read for the reconciliation). */
export async function loadDpgfTargetCompositions(context: Context,
  targets: ReadonlyArray<{ id: string; updated_at: string; source_metadata: Record<string, unknown> | null }>): Promise<DpgfCompositions> {
  const stored = targets.map((target) => ({ target, stored: readStoredDpgfComposition(target.source_metadata) }));
  const ids = [...new Set(stored.flatMap(({ stored: entry }) => entry.version === 2 ? entry.contributions.flatMap((part) => part.item_ids)
    : entry.version === 1 ? entry.item_ids : []))];
  const rows = await readItems(context, ids);
  const lines = new Map(rows.map((row) => [row.id, { item_id: row.id, job_id: row.job_id, designation: row.designation,
    source_file_name: row.source_file_name, source_page: row.source_page }]));
  // What a frozen line brings is read as the reconciliation reads it (a vector surface by its model quantity).
  const contributing = new Map(normalizeTakeoffComparisonItems(rows.map((row) => ({ ...row, is_excluded: false }) as unknown as TakeoffJobItem))
    .map((line) => [line.item_id, { item_id: line.item_id, quantity: line.quantity, metadata: line.metadata }]));
  const compositions = new Map<string, DpgfTargetComposition>(stored.map(({ target, stored: entry }): [string, DpgfTargetComposition] => {
    if (entry.version === 2) {
      return [target.id, { target_id: target.id, updated_at: target.updated_at, version: 2 as const, unsplit: false,
        contributions: entry.contributions, version_one: null }];
    }
    if (entry.version === 1) {
      const upgraded = upgradeDpgfComposition(entry, entry.item_ids.flatMap((id) => contributing.get(id) ?? []));
      return [target.id, { target_id: target.id, updated_at: target.updated_at, version: 1 as const, unsplit: !upgraded.split,
        contributions: upgraded.contributions, version_one: { job_id: entry.job_id, item_ids: entry.item_ids } }];
    }
    return [target.id, { target_id: target.id, updated_at: target.updated_at, version: 0 as const, unsplit: false,
      contributions: [], version_one: null }];
  }));
  const jobIds = [...new Set([...compositions.values()].flatMap((entry) => entry.contributions.map((part) => part.job_id)))];
  const jobs = new Map((await readJobs(context, jobIds)).map((job) => [job.id, job]));
  return { targets: compositions, lines, jobs };
}

/** What the permit carries for the version 1 policies: the composition the application keeps, bound to each target. */
export function dpgfApplyCompositions(compositions: DpgfCompositions): DpgfApplyComposition[] {
  return [...compositions.targets.values()].flatMap((entry) => entry.version === 1 && entry.version_one
    ? [{ target_id: entry.target_id, expected_updated_at: entry.updated_at, job_id: entry.version_one.job_id,
      item_ids: entry.version_one.item_ids, contributions: entry.contributions }] : []);
}
