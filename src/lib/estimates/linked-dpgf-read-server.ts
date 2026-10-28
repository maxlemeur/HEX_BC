import { readAllRows } from "@/lib/supabase/read-all";
import { mapSupabaseError, notFound } from "@/lib/estimates/errors";
import type { Supabase } from "@/lib/estimates/item-write-types";
import type { AffaireLinkedDpgfSourceResult } from "@/lib/estimates/linked-dpgf-contracts";
import { canAccessOwnerResource, getAuthenticatedContext } from "@/lib/estimates/server-context";
import type { EstimateProjectRow } from "@/lib/estimates/version-list-server";
import type { Database } from "@/types/database";
type DpgfImportRow = Database["public"]["Tables"]["dpgf_imports"]["Row"];
type DpgfMappingRow = Database["public"]["Tables"]["dpgf_mappings"]["Row"];

type AffaireDpgfImportRow = Pick<
  DpgfImportRow,
  | "id"
  | "filename"
  | "source_format"
  | "status"
  | "created_at"
  | "parse_mode"
  | "row_count"
>;

type AffaireDpgfMappingRow = Pick<
  DpgfMappingRow,
  "id" | "status" | "updated_at" | "created_at"
>;

type DpgfMappedRowForEstimateImport = Pick<
  Database["public"]["Tables"]["dpgf_rows_mapped"]["Row"],
  "id" | "payload" | "created_at"
>;

export async function loadLatestLinkedDpgfImportForProject(input: {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("dpgf_imports")
    .select(
      "id, filename, source_format, status, created_at, parse_mode, row_count"
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la source DPGF liée.");
  }

  return (data ?? null) as AffaireDpgfImportRow | null;
}

export async function loadLatestDpgfMappingForImport(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
}) {
  const { data, error } = await input.supabase
    .from("dpgf_mappings")
    .select("id, status, updated_at, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger le statut de mapping DPGF."
    );
  }

  return (data ?? null) as AffaireDpgfMappingRow | null;
}

async function countMappedRowsForImport(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
}) {
  const { count, error } = await input.supabase
    .from("dpgf_rows_mapped")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de compter les lignes DPGF mappées.");
  }

  return count ?? 0;
}

async function loadMappedRowsForImport(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("dpgf_rows_mapped")
    .select("id, payload, created_at", { count: "exact" })
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true }));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes DPGF mappées.");
  }

  return (data ?? []) as DpgfMappedRowForEstimateImport[];
}

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function loadMappedRowsForImportWithRetry(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}) {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 8);
  const retryDelayMs = Math.max(0, input.retryDelayMs ?? 300);
  let lastRows: DpgfMappedRowForEstimateImport[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastRows = await loadMappedRowsForImport({
      supabase: input.supabase,
      tenantId: input.tenantId,
      importId: input.importId,
    });

    if (lastRows.length > 0) {
      return lastRows;
    }

    if (attempt < maxAttempts) {
      await sleep(retryDelayMs * attempt);
    }
  }

  return lastRows;
}

export async function getAffaireLinkedDpgfSource(
  projectId: string
): Promise<AffaireLinkedDpgfSourceResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  const { data: projectData, error: projectError } = await supabase
    .from("estimate_projects")
    .select("id, tenant_id, user_id, is_archived")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (projectError) {
    throw mapSupabaseError(projectError, "Impossible de charger l'affaire.");
  }

  const project = (projectData ??
    null) as Pick<
    EstimateProjectRow,
    "id" | "tenant_id" | "user_id" | "is_archived"
  > | null;

  if (
    !project ||
    project.is_archived ||
    !canAccessOwnerResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Affaire introuvable.");
  }

  const latestImport = await loadLatestLinkedDpgfImportForProject({
    supabase,
    tenantId,
    projectId: project.id,
  });

  if (!latestImport) {
    return null;
  }

  const [latestMapping, mappedRowCount] = await Promise.all([
    loadLatestDpgfMappingForImport({
      supabase,
      tenantId,
      importId: latestImport.id,
    }),
    countMappedRowsForImport({
      supabase,
      tenantId,
      importId: latestImport.id,
    }),
  ]);

  return {
    import_id: latestImport.id,
    filename: latestImport.filename,
    source_format: latestImport.source_format,
    import_status: latestImport.status,
    mapping_status: latestMapping?.status ?? null,
    imported_at: latestImport.created_at,
    mapping_updated_at: latestMapping?.updated_at ?? null,
    parse_mode: latestImport.parse_mode,
    row_count: latestImport.row_count ?? 0,
    mapped_row_count: mappedRowCount,
  };
}
