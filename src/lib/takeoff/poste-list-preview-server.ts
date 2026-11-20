import "server-only";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { mapSupabaseError } from "@/lib/http/api-response";
import { classifyMappedRows, type MappedRowClassification } from "@/lib/imports/mapped-row-structure";
import { IMPORT_ROW_STRUCTURE_KEY, readImportRowStructure } from "@/lib/imports/payload";
import { readAllRows } from "@/lib/supabase/read-all";
import { asRecord, toNonEmptyString } from "@/lib/value-guards";
import { PLUMBING_TEMPLATE, templatePosteDrafts } from "./plumbing-template";
import { projectDpgfPostes, type DpgfPosteProjection } from "./poste-list-dpgf";
import { createPosteRevision, type PosteRevision } from "./poste-list";

export type PosteListPreview =
  | { kind: "template"; revision: PosteRevision }
  | { kind: "dpgf"; filename: string; revision: PosteRevision; projection: DpgfPosteProjection }
  | { kind: "prepare"; projection?: DpgfPosteProjection }
  | { kind: "choose" | "unavailable" };

function sourceInteger(value: unknown, minimum: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function classificationOf(value: unknown): MappedRowClassification | null {
  const classification = asRecord(value);
  switch (classification?.kind) {
    case "section": return classification.level === 1 || classification.level === 2
      ? { kind: "section", level: classification.level }
      : null;
    case "line": case "ignore": case "footer": case "parameters": case "ambiguous": case "empty": case "header":
      return { kind: classification.kind };
    default: return null;
  }
}

export async function loadPosteListPreview(projectId: string): Promise<PosteListPreview> {
  const { project, context } = await requireAffaireAccess(projectId, "read");
  const { supabase, tenantId } = context;
  const scope = { tenantId, projectId: project.id };
  // The ingestion policies grant DPGF reads to owners and administrators. A reader
  // outside that audience cannot tell an unseen DPGF apart from an absent one.
  if (context.userId !== project.user_id && context.tenantRole !== "admin") {
    return { kind: "unavailable" };
  }

  const [imports, documents] = await Promise.all([
    supabase.from("dpgf_imports").select("id, filename, status, row_count")
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
  if (!source) {
    return document ? { kind: "prepare" } : {
      kind: "template", revision: createPosteRevision(scope, templatePosteDrafts(PLUMBING_TEMPLATE)),
    };
  }
  if (source.status !== "completed" || source.row_count === 0) return { kind: "prepare" };

  const recentMappings = () => supabase.from("dpgf_mappings")
    .select("id, status, created_at, updated_at, column_mapping")
    .eq("tenant_id", tenantId).eq("import_id", source.id)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(2)
    .abortSignal(new AbortController().signal);
  const mappings = await recentMappings();
  if (mappings.error) throw mapSupabaseError(mappings.error, "Impossible de charger les correspondances DPGF.");
  const [mapping] = mappings.data;
  if (mapping?.status !== "validated") return { kind: "prepare" };

  // Read only row identity, source location and mapped measurement fields. This uses
  // the existing persisted mapping, including pre-existing payloads with flat fields.
  const [raw, mapped] = await Promise.all([
    readAllRows(() => supabase.from("dpgf_rows_raw")
      .select("id, row_index, structure:payload->_timax_structure, provenance:payload->_timax_provenance", { count: "exact" })
      .eq("tenant_id", tenantId).eq("import_id", source.id).order("row_index")),
    readAllRows(() => supabase.from("dpgf_rows_mapped")
      .select(`id, raw_row_id, stamp:payload->_timax_mapped_structure,
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
    raw.data?.length !== source.row_count || !mapped.data?.length) return { kind: "prepare" };

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
    return { kind: "prepare" };
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
    stamp: asRecord(row.stamp),
  }));

  const isLegacy = mappedRows.every(({ stamp }) => !stamp);
  // Legacy mappings were written in separate requests. Timestamps alone cannot
  // match unstamped rows to a generation when two mappings could have overlapped.
  if (isLegacy && (mappings.data.length !== 1 || currentMappings.data.length !== 1)) return { kind: "prepare" };
  if (!isLegacy && mappedRows.some(({ stamp }) =>
    stamp?.mapping_id !== mapping.id || !classificationOf(stamp.classification))) return { kind: "prepare" };

  // Historic mappings have no record of structural overrides. Reconstruct a read-only
  // preview with the quantitative and structural fields available in that generation.
  const columns = asRecord(mapping.column_mapping) ?? {};
  const legacyByRawId = new Map(raw.data.map((row) => [row.id, row]));
  const legacy = isLegacy ? classifyMappedRows(mappedRows.flatMap((mappedRow) => {
    const row = legacyByRawId.get(mappedRow.rawRowId ?? "");
    if (!row) return [];
    const rawRow = Object.fromEntries(Object.entries(columns).flatMap(([source, target]) =>
      target === "designation" || target === "reference" || target === "hex_code"
        ? [[source, mappedRow[target]]]
        : []));
    // A historic titled row with a quantity is a better line candidate than a bold heading.
    if (mappedRow.quantity == null || mappedRow.quantity === "") rawRow[IMPORT_ROW_STRUCTURE_KEY] = row.structure;
    return [{ id: mappedRow.id, rowIndex: row.row_index, rawRow, mappedRow }];
  }), [], columns) : null;

  const projection = projectDpgfPostes({
    importId: source.id, mappingId: mapping.id, rawRows,
    mappedRows: mappedRows.map((row) => ({
      ...row, classification: legacy?.get(row.id) ?? classificationOf(row.stamp?.classification),
    })),
  });
  if (mappedRows.length !== rawRows.length || projection.counts.missing || projection.counts.orphaned ||
    !projection.items.length) {
    return { kind: "prepare", projection };
  }
  return { kind: "dpgf", filename: source.filename, revision: createPosteRevision(scope, projection.items), projection };
}
