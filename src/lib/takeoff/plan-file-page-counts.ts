import type { Supabase } from "@/lib/takeoff/processing-context";
import type { DownloadedTakeoffFile } from "@/lib/takeoff/source-loader";
import { toNonEmptyString } from "@/lib/value-guards";

async function upsertDetectedPlanFilePageCount(input: {
  supabase: Supabase;
  tenantId: string;
  sourceFilePath: string | null;
  pageCount: number;
}) {
  const sourceFilePath = toNonEmptyString(input.sourceFilePath);
  if (!sourceFilePath) {
    return;
  }

  const { data, error } = await input.supabase
    .from("plan_files" as never)
    .select("id, page_count, metadata" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("file_path" as never, sourceFilePath as never)
    .maybeSingle();

  if (error) {
    console.error("Impossible de lire le metadata plan_files pour page_count.", {
      tenant_id: input.tenantId,
      source_file_path: sourceFilePath,
      error,
    });
    return;
  }

  if (!data || typeof data !== "object") {
    return;
  }

  const row = data as {
    id?: unknown;
    page_count?: unknown;
    metadata?: unknown;
  };
  const planFileId = typeof row.id === "string" ? row.id : null;
  if (!planFileId) {
    return;
  }

  const currentPageCount =
    typeof row.page_count === "number" && Number.isInteger(row.page_count)
      ? row.page_count
      : null;
  const existingMetadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  const updatePayload: Record<string, unknown> = {
    metadata: {
      ...existingMetadata,
      detected_page_count: input.pageCount,
      detected_page_count_at: new Date().toISOString(),
    },
  };

  if (currentPageCount !== input.pageCount) {
    updatePayload.page_count = input.pageCount;
  }

  const { error: updateError } = await input.supabase
    .from("plan_files" as never)
    .update(updatePayload as never)
    .eq("id" as never, planFileId as never)
    .eq("tenant_id" as never, input.tenantId as never);

  if (updateError) {
    console.error("Impossible de persister page_count sur plan_files.", {
      tenant_id: input.tenantId,
      source_file_path: sourceFilePath,
      page_count: input.pageCount,
      error: updateError,
    });
  }
}

export async function persistDetectedPlanFilePageCounts(input: {
  supabase: Supabase;
  tenantId: string;
  sourceFile: DownloadedTakeoffFile;
  fallbackSourceFilePath: string | null;
  fallbackPageCount: number;
}) {
  // A confirmed source identity stays fixed across retries and provider reconciliation.
  if (input.sourceFile.preparationSnapshot) return;
  const sourcePageCounts = input.sourceFile.sourcePlanFilePageCounts;
  if (sourcePageCounts && sourcePageCounts.length > 0) {
    await Promise.all(
      sourcePageCounts.map((source) =>
        upsertDetectedPlanFilePageCount({
          supabase: input.supabase,
          tenantId: input.tenantId,
          sourceFilePath: source.filePath,
          pageCount: source.pageCount,
        })
      )
    );
    return;
  }

  await upsertDetectedPlanFilePageCount({
    supabase: input.supabase,
    tenantId: input.tenantId,
    sourceFilePath: input.fallbackSourceFilePath,
    pageCount: input.fallbackPageCount,
  });
}
