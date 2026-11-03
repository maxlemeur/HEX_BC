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
// result persistence of the job, after its result row: a failure fails the
// whole persistence, and clearing the job's results deletes these rows too.

type ServiceClient = SupabaseClient<Database>;

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
