import "server-only";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { mapSupabaseError } from "@/lib/http/api-response";
import { readConfirmedMappedStructure } from "@/lib/imports/confirmed-mapped-structure";
import { IMPORT_ROW_STRUCTURE_KEY, readImportRowStructure } from "@/lib/imports/payload";
import { readAllRows } from "@/lib/supabase/read-all";
import { asRecord, toNonEmptyString } from "@/lib/value-guards";
import { PLUMBING_TEMPLATE, templatePosteDrafts } from "./plumbing-template";
import { projectDpgfPostes, type DpgfPosteProjection } from "./poste-list-dpgf";
import { createPosteRevision, type PosteRevision } from "./poste-list";

export type PosteListPreview =
  | { kind: "template"; revision: PosteRevision }
  | { kind: "dpgf"; filename: string; sourceFormat: string; revision: PosteRevision; projection: DpgfPosteProjection; limitedVisibility?: true }
  | { kind: "prepare"; projection?: DpgfPosteProjection; sourceFormat?: string; limitedVisibility?: true }
  | { kind: "choose" | "limited" | "unavailable" };

function sourceInteger(value: unknown, minimum: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : null;
}

export async function loadPosteListPreview(projectId: string): Promise<PosteListPreview> {
  const { project, context } = await requireAffaireAccess(projectId, "read");
  const { supabase, tenantId } = context;
  const scope = { tenantId, projectId: project.id };
  // RLS lets administrators see every linked import. An affaire owner with
  // another role can see only their own imports, even on their own affaire.
  const visibility = context.tenantRole === "admin" ? {} : { limitedVisibility: true as const };
  if (context.userId !== project.user_id && visibility.limitedVisibility) return { kind: "limited" };

  const [imports, documents] = await Promise.all([
    supabase.from("dpgf_imports").select("id, filename, source_format, status, row_count")
      .eq("tenant_id", tenantId).eq("project_id", project.id).order("id").limit(2),
    supabase.from("affaire_intake_documents").select("id")
      .eq("tenant_id", tenantId).eq("project_id", project.id)
      .eq("document_kind", "dpgf").eq("classification_status", "classified").eq("upload_status", "uploaded")
      .is("deleted_at", null).is("deletion_token", null).order("id").limit(2),
  ]);
  if (imports.error) throw mapSupabaseError(imports.error, "Impossible de charger les imports DPGF liés.");
  if (documents.error) throw mapSupabaseError(documents.error, "Impossible de charger les DPGF du dossier.");
  if (imports.data.length > 1 || documents.data.length > 1) return { kind: "choose" };

  const source = imports.data[0];
  const document = documents.data[0];
  const prepare = (projection?: DpgfPosteProjection): PosteListPreview => ({
    kind: "prepare", ...visibility, ...(projection ? { projection, sourceFormat: source?.source_format } : {}),
  });
  if (!source) {
    if (document) return prepare();
    if (visibility.limitedVisibility) return { kind: "limited" };
    return {
      kind: "template", revision: createPosteRevision(scope, templatePosteDrafts(PLUMBING_TEMPLATE)),
    };
  }
  if (source.status !== "completed" || source.row_count === 0) return prepare();

  const recentMappings = () => supabase.from("dpgf_mappings")
    .select("id, status, created_at, updated_at")
    .eq("tenant_id", tenantId).eq("import_id", source.id)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(2)
    .abortSignal(new AbortController().signal);
  const mappings = await recentMappings();
  if (mappings.error) throw mapSupabaseError(mappings.error, "Impossible de charger les correspondances DPGF.");
  const [mapping] = mappings.data;
  if (mapping?.status !== "validated") return prepare();

  // Read only row identity, source location and mapped measurement fields. This uses
  // the existing persisted mapping, including pre-existing payloads with flat fields.
  const [raw, mapped] = await Promise.all([
    readAllRows(() => supabase.from("dpgf_rows_raw")
      .select("id, row_index, structure:payload->_timax_structure, provenance:payload->_timax_provenance", { count: "exact" })
      .eq("tenant_id", tenantId).eq("import_id", source.id).order("row_index")),
    readAllRows(() => supabase.from("dpgf_rows_mapped")
      .select(`id, raw_row_id, receipt:payload->_timax_confirmed_structure,
        designation:payload->mapped_row->designation, reference:payload->mapped_row->reference,
        hex_code:payload->mapped_row->hex_code, unit:payload->mapped_row->unit,
        quantity:payload->mapped_row->quantity, notes:payload->mapped_row->notes,
        flat_designation:payload->designation, flat_reference:payload->reference,
        flat_hex_code:payload->hex_code, flat_unit:payload->unit,
        flat_quantity:payload->quantity, flat_notes:payload->notes`, { count: "exact" })
      .eq("tenant_id", tenantId).eq("import_id", source.id).eq("status", "mapped")
      .gte("created_at", mapping.created_at)),
  ]);
  if (raw.error) throw mapSupabaseError(raw.error, "Impossible de vérifier les lignes sources DPGF.");
  if (mapped.error) throw mapSupabaseError(mapped.error, "Impossible de lire les lignes DPGF mappées.");

  const currentMappings = await recentMappings();
  if (currentMappings.error) throw mapSupabaseError(currentMappings.error, "Impossible de vérifier la génération DPGF.");
  const [currentMapping] = currentMappings.data;
  if (currentMapping?.id !== mapping.id || currentMapping.updated_at !== mapping.updated_at ||
    raw.data?.length !== source.row_count || !mapped.data?.length) return prepare();

  const rawRows = raw.data.map((row) => {
    const structure = readImportRowStructure({ [IMPORT_ROW_STRUCTURE_KEY]: row.structure });
    const provenance = asRecord(row.provenance);
    return {
      id: row.id,
      rowIndex: row.row_index,
      sheetName: structure?.sheet_name ?? null,
      sourceRowNumber: structure?.source_row_number ?? null,
      sourcePage: sourceInteger(provenance?.source_page, 1),
      tableIndex: sourceInteger(provenance?.table_index, 0),
      documentId: toNonEmptyString(provenance?.source_document_id),
    };
  });
  if (rawRows.some(({ documentId }) => documentId !== (document?.id ?? null))) {
    return prepare();
  }

  const mappedRows = mapped.data.map((row) => ({
    id: row.id,
    rawRowId: row.raw_row_id,
    designation: row.designation ?? row.flat_designation,
    reference: row.reference ?? row.flat_reference,
    hex_code: row.hex_code ?? row.flat_hex_code,
    unit: row.unit ?? row.flat_unit,
    quantity: row.quantity ?? row.flat_quantity,
    notes: row.notes ?? row.flat_notes,
    receipt: row.receipt,
  }));

  const classifications = readConfirmedMappedStructure(mappedRows, mapping.id);
  if (!classifications) return prepare();

  const projection = projectDpgfPostes({
    importId: source.id, mappingId: mapping.id, rawRows,
    mappedRows: mappedRows.map((row) => ({
      ...row, classification: classifications.get(row.id) ?? null,
    })),
  });
  if (mappedRows.length !== rawRows.length || projection.counts.missing || projection.counts.orphaned ||
    !projection.items.length) {
    return prepare(projection);
  }
  return {
    kind: "dpgf", filename: source.filename, sourceFormat: source.source_format,
    revision: createPosteRevision(scope, projection.items), projection, ...visibility,
  };
}
