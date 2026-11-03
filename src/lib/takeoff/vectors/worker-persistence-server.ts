import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { VECTOR_PERSISTENCE_SCHEMA_VERSION } from "@/lib/takeoff/vectors/persistence";
import type { VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";

// Writes a job's vector reading with the worker's service role (TI-662): one
// takeoff_vector_pages row per page read, then its measured items in
// takeoff_items (same columns as the level C items, metadata.vector naming
// their kind) and one takeoff_item_geometries row per item. Called inside the
// result persistence of the job, after its result row. Clearing the job's
// results deletes these rows too. A failure never fails the job: the processor
// calls discardTakeoffVectorReading, which removes the rows already written.
// Until TI-664 decides between both readings, a vector item is excluded by
// default (with its reason): applying the level C reading never counts a
// network twice; the user includes a vector item in the review.

type ServiceClient = SupabaseClient<Database>;

export const VECTOR_ITEM_EXCLUSION_REASON = "Lecture vectorielle : à comparer à la lecture du plan, non appliquée par défaut.";

function failed(message: string, error: unknown): never {
  throw Object.assign(new Error(`${message} (${(error as { message?: string } | null)?.message ?? "erreur inconnue"})`), { cause: error });
}

export async function persistTakeoffVectorReading(input: {
  supabase: ServiceClient;
  job: { id: string; tenant_id: string };
  resultId: string;
  outcomes: readonly VectorPageOutcome[];
}): Promise<{ pages: number; items: number }> {
  let pages = 0, items = 0;
  for (const outcome of input.outcomes) {
    if (!outcome.record) continue;
    const planFileId = outcome.document.kind === "plan_file" ? outcome.document.plan_file_id : null;
    const { data: page, error: pageError } = await input.supabase.from("takeoff_vector_pages" as never).insert({
      tenant_id: input.job.tenant_id, job_id: input.job.id, result_id: input.resultId, plan_file_id: planFileId,
      source_file_name: outcome.fileName.slice(0, 255), source_page: outcome.page, reading: outcome.record,
      schema_version: VECTOR_PERSISTENCE_SCHEMA_VERSION,
    } as never).select("id" as never).single();
    if (pageError || !page) failed("Impossible d’enregistrer la lecture vectorielle d’une page.", pageError);
    pages += 1;
    if (outcome.items.length === 0) continue;
    const keyed = outcome.items.map((record) => ({ key: randomUUID(), record }));
    const { data: inserted, error: itemsError } = await input.supabase.from("takeoff_items" as never).insert(keyed.map(({ key, record }) => ({
      tenant_id: input.job.tenant_id, job_id: input.job.id, result_id: input.resultId,
      designation: record.item.designation, quantity: record.item.quantity, unit: record.item.unit, confidence: record.item.confidence,
      evidence: record.item.evidence, source_file_name: outcome.fileName, source_page: outcome.page,
      is_excluded: true, exclusion_reason: VECTOR_ITEM_EXCLUSION_REASON,
      metadata: { category: record.item.category, source_document: outcome.document,
        vector: { schema_version: VECTOR_PERSISTENCE_SCHEMA_VERSION, kind: record.geometry.kind, key } },
    })) as never).select("id,metadata" as never);
    if (itemsError || !inserted) failed("Impossible d’enregistrer les items de la lecture vectorielle.", itemsError);
    const ids = new Map((inserted as unknown as Array<{ id: string; metadata: { vector?: { key?: string } } }>)
      .map((row) => [row.metadata.vector?.key, row.id]));
    const rows = keyed.map(({ key, record }) => {
      const id = ids.get(key);
      if (!id) failed("Un item de la lecture vectorielle n’a pas été retrouvé après insertion.", null);
      return { takeoff_item_id: id, tenant_id: input.job.tenant_id, job_id: input.job.id, vector_page_id: (page as unknown as { id: string }).id,
        geometry: record.geometry, schema_version: VECTOR_PERSISTENCE_SCHEMA_VERSION };
    });
    const { error: geometryError } = await input.supabase.from("takeoff_item_geometries" as never).insert(rows as never);
    if (geometryError) failed("Impossible d’enregistrer la géométrie de la lecture vectorielle.", geometryError);
    items += rows.length;
  }
  return { pages, items };
}

/** Removes what a failed persistence of the vector reading wrote for this result, then logs the failure. */
export async function discardTakeoffVectorReading(input: {
  supabase: ServiceClient;
  job: { id: string; tenant_id: string };
  resultId: string;
  error: unknown;
}) {
  // Geometries go with their page (on delete cascade); vector items are the result's items with metadata.vector.
  const pages = await input.supabase.from("takeoff_vector_pages" as never).delete()
    .eq("tenant_id" as never, input.job.tenant_id as never).eq("job_id" as never, input.job.id as never).eq("result_id" as never, input.resultId as never);
  const items = await input.supabase.from("takeoff_items" as never).delete()
    .eq("tenant_id" as never, input.job.tenant_id as never).eq("job_id" as never, input.job.id as never).eq("result_id" as never, input.resultId as never)
    .not("metadata->vector" as never, "is", null);
  console.error("takeoff.vector.persistence_failed", {
    job_id: input.job.id, tenant_id: input.job.tenant_id, result_id: input.resultId,
    message: (input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 500),
    cleanup: { pages: pages.error?.message ?? "ok", items: items.error?.message ?? "ok" },
  });
}
