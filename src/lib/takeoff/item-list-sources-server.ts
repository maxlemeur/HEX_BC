import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapSupabaseError } from "@/lib/http/api-response";
import { IMPORT_ROW_STRUCTURE_KEY, readImportRowStructure } from "@/lib/imports/payload";
import type { ImportStructureDecision } from "@/lib/imports/structure";
import { readAllRows } from "@/lib/supabase/read-all";
import { asRecord, toNonEmptyString } from "@/lib/value-guards";
import type { Database } from "@/types/database";
import { readPublishedItemTemplate, type PublishedItemTemplate } from "./item-template-server";
import { projectDpgfPostes, type DpgfPosteProjection, type DpgfStructuralExclusion } from "./poste-list-dpgf";
import type { PosteDraft, PosteListScope } from "./poste-list";
import { templatePosteDrafts } from "./plumbing-template";

type Service = SupabaseClient<Database>;

/**
 * Whether the structure decisions of the import's confirmation apply: recorded with a proof that still matches what
 * the import holds (applied); recorded for an earlier confirmation or for rows since changed (stale); never recorded,
 * the import was confirmed before they were stored (unrecorded).
 */
export type ItemListDecisionsState =
  | { status: "applied"; confirmationId: string; confirmedAt: string; count: number;
      decisions: ImportStructureDecision[]; exclusions: DpgfStructuralExclusion[] }
  | { status: "stale"; confirmedAt: string }
  /** An estimate was created from the import after the record by a path that records nothing (an older version). */
  | { status: "superseded"; confirmedAt: string }
  | { status: "unrecorded" };

/** Why the DPGF of the affaire does not give a list yet: the action it waits for is an import's or a mapping's. */
export type ItemListPrepareReason =
  | "document_without_import" | "import_in_progress" | "import_failed" | "mapping_missing" | "mapping_draft"
  | "rows_incomplete" | "rows_unattested" | "document_mismatch";

export type ItemListSourceState =
  | {
      kind: "dpgf"; importId: string; mappingId: string; filename: string; sourceFormat: string;
      decisions: ItemListDecisionsState; projection: DpgfPosteProjection; drafts: PosteDraft[];
    }
  | { kind: "template"; template: PublishedItemTemplate; drafts: PosteDraft[] }
  | { kind: "prepare"; reason: ItemListPrepareReason; filename: string | null; sourceFormat: string | null;
      projection: DpgfPosteProjection | null }
  | { kind: "choose"; imports: number; documents: number };

function sourceInteger(value: unknown, minimum: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function readFailure(error: unknown, message: string): never {
  throw mapSupabaseError(error as Parameters<typeof mapSupabaseError>[0], message);
}

const DECISION_KINDS = new Set(["section", "line", "ignore"]);
function storedDecisions(value: unknown): ImportStructureDecision[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ImportStructureDecision[] => {
    const record = asRecord(entry);
    const rowIndex = record?.rowIndex;
    if (!record || typeof rowIndex !== "number" || !Number.isSafeInteger(rowIndex) || !DECISION_KINDS.has(String(record.kind))) {
      return [];
    }
    return record.kind === "section"
      ? [{ rowIndex, kind: "section" as const, level: record.level === 2 ? 2 as const : 1 as const }]
      : [{ rowIndex, kind: record.kind as "line" | "ignore", level: null }];
  });
}

const EXCLUSION_REASONS = new Set(["footer", "user_ignored", "parameters"]);
function storedExclusions(value: unknown): DpgfStructuralExclusion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): DpgfStructuralExclusion[] => {
    const record = asRecord(entry);
    const rowIndex = record?.rowIndex;
    return record && typeof rowIndex === "number" && Number.isSafeInteger(rowIndex) && EXCLUSION_REASONS.has(String(record.reason))
      ? [{ rowIndex, reason: record.reason as DpgfStructuralExclusion["reason"] }] : [];
  });
}

/**
 * The sources of an affaire's list, resolved on the server under the affaire's own rule: the caller has checked that
 * the member may read the affaire; every import linked to it is then read whoever uploaded it, so that an import the
 * member's own session cannot see is still known to exist and gives the same list to every reader. The DPGF of the
 * dossier gives the list once its import is complete, mapped and its rows attested; without one, the tenant's
 * published template (or the definition shipped with the application). Nothing here reads a price.
 */
export async function resolveItemListSources(scope: PosteListScope, service: Service): Promise<ItemListSourceState> {
  const { tenantId, projectId } = scope;
  const [imports, documents] = await Promise.all([
    service.from("dpgf_imports").select("id, filename, source_format, status, row_count, sheet_first_row")
      .eq("tenant_id", tenantId).eq("project_id", projectId).order("id").limit(2),
    service.from("affaire_intake_documents").select("id")
      .eq("tenant_id", tenantId).eq("project_id", projectId)
      .eq("document_kind", "dpgf").eq("classification_status", "classified").eq("upload_status", "uploaded")
      .is("deleted_at", null).is("deletion_token", null).order("id").limit(2),
  ]);
  if (imports.error) readFailure(imports.error, "Impossible de charger les imports DPGF de l’affaire.");
  if (documents.error) readFailure(documents.error, "Impossible de charger les DPGF du dossier.");
  if (imports.data.length > 1 || documents.data.length > 1) {
    return { kind: "choose", imports: imports.data.length, documents: documents.data.length };
  }

  const source = imports.data[0];
  const document = documents.data[0];
  const prepare = (reason: ItemListPrepareReason, projection: DpgfPosteProjection | null = null): ItemListSourceState => ({
    kind: "prepare", reason, filename: source?.filename ?? null, sourceFormat: source?.source_format ?? null, projection,
  });
  if (!source) {
    if (document) return prepare("document_without_import");
    const template = await readPublishedItemTemplate(service, tenantId, "plomberie");
    return { kind: "template", template, drafts: templatePosteDrafts(template.template) };
  }
  if (source.status === "failed") return prepare("import_failed");
  if (source.status !== "completed" || source.row_count === 0) return prepare("import_in_progress");

  const latestMapping = () => service.from("dpgf_mappings")
    .select("id, status, column_mapping, created_at, updated_at")
    .eq("tenant_id", tenantId).eq("import_id", source.id)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  const mappings = await latestMapping();
  if (mappings.error) readFailure(mappings.error, "Impossible de charger les correspondances DPGF.");
  const [mapping] = mappings.data;
  if (!mapping) return prepare("mapping_missing");
  if (mapping.status !== "validated") return prepare("mapping_draft");

  // Row identity, source location and the mapped measured fields only, including the flat fields of older payloads.
  const [raw, mapped, confirmation, notesKey] = await Promise.all([
    readAllRows(() => service.from("dpgf_rows_raw")
      .select("id, row_index, structure:payload->_timax_structure, provenance:payload->_timax_provenance", { count: "exact" })
      .eq("tenant_id", tenantId).eq("import_id", source.id).order("row_index")),
    readAllRows(() => service.from("dpgf_rows_mapped")
      .select(`id, raw_row_id,
        designation:payload->mapped_row->designation, reference:payload->mapped_row->reference,
        hex_code:payload->mapped_row->hex_code, unit:payload->mapped_row->unit,
        quantity:payload->mapped_row->quantity, notes:payload->mapped_row->notes,
        flat_designation:payload->designation, flat_reference:payload->reference,
        flat_hex_code:payload->hex_code, flat_unit:payload->unit,
        flat_quantity:payload->quantity, flat_notes:payload->notes`, { count: "exact" })
      .eq("tenant_id", tenantId).eq("import_id", source.id).eq("status", "mapped")
      .gte("created_at", mapping.created_at)),
    service.rpc("read_dpgf_import_confirmation", { p_tenant_id: tenantId, p_import_id: source.id }),
    // The tenant's key of the notes digests, never sent to a reader.
    service.rpc("takeoff_item_list_notes_key", { p_tenant_id: tenantId }),
  ]);
  if (raw.error) readFailure(raw.error, "Impossible de vérifier les lignes sources DPGF.");
  if (mapped.error) readFailure(mapped.error, "Impossible de lire les lignes DPGF mappées.");
  if (confirmation.error) readFailure(confirmation.error, "Impossible de lire la confirmation de l’import.");
  if (notesKey.error || typeof notesKey.data !== "string") {
    readFailure(notesKey.error ?? {}, "Impossible de préparer la lecture des notes de l’import.");
  }

  // The rows read belong to the mapping read first: a mapping replaced meanwhile gives « à préparer », never a mix.
  const current = await latestMapping();
  if (current.error) readFailure(current.error, "Impossible de vérifier la génération DPGF.");
  if (current.data[0]?.id !== mapping.id || current.data[0]?.updated_at !== mapping.updated_at) return prepare("mapping_draft");
  if (raw.data?.length !== source.row_count || !mapped.data?.length) return prepare("rows_incomplete");

  const firstRow = sourceInteger(source.sheet_first_row, 1);
  const rawRows = raw.data.map((row) => {
    const structure = readImportRowStructure({ [IMPORT_ROW_STRUCTURE_KEY]: row.structure });
    const provenance = asRecord(row.provenance);
    const tableRow = structure?.source_row_number ?? null;
    return {
      id: row.id, rowIndex: row.row_index,
      sheetName: structure?.sheet_name ?? null, sourceRowNumber: tableRow,
      // The worksheet's own row, for an import that recorded where its table starts (new imports only).
      sheetRowNumber: firstRow !== null && tableRow !== null ? firstRow + tableRow - 1 : null,
      sourcePage: sourceInteger(provenance?.source_page, 1), tableIndex: sourceInteger(provenance?.table_index, 0),
      documentId: toNonEmptyString(provenance?.source_document_id), structure,
    };
  });
  if (rawRows.some(({ documentId }) => documentId !== (document?.id ?? null))) return prepare("document_mismatch");

  const recorded = (confirmation.data ?? [])[0] as {
    confirmation_id: string; mapping_id: string; decisions: unknown; exclusions: unknown; confirmed_at: string;
    proof_current: boolean; superseded: boolean;
  } | undefined;
  const decisions: ItemListDecisionsState = !recorded ? { status: "unrecorded" }
    : recorded.superseded ? { status: "superseded", confirmedAt: recorded.confirmed_at }
      : recorded.proof_current && recorded.mapping_id === mapping.id
        ? { status: "applied", confirmationId: recorded.confirmation_id, confirmedAt: recorded.confirmed_at,
          count: storedDecisions(recorded.decisions).length, decisions: storedDecisions(recorded.decisions),
          exclusions: storedExclusions(recorded.exclusions) }
        : { status: "stale", confirmedAt: recorded.confirmed_at };

  const projection = projectDpgfPostes({
    importId: source.id, mappingId: mapping.id, rawRows,
    mappedRows: mapped.data.map((row) => ({
      id: row.id, rawRowId: row.raw_row_id,
      designation: row.designation ?? row.flat_designation, reference: row.reference ?? row.flat_reference,
      hex_code: row.hex_code ?? row.flat_hex_code, unit: row.unit ?? row.flat_unit,
      quantity: row.quantity ?? row.flat_quantity, notes: row.notes ?? row.flat_notes,
    })),
    columnMapping: asRecord(mapping.column_mapping) ?? {},
    notesKey: notesKey.data as string,
    decisions: decisions.status === "applied" ? decisions.decisions : undefined,
    exclusions: decisions.status === "applied" ? decisions.exclusions : undefined,
  });
  if (mapped.data.length !== rawRows.length || projection.counts.missing || projection.counts.orphaned) {
    return prepare("rows_unattested", projection);
  }
  return {
    kind: "dpgf", importId: source.id, mappingId: mapping.id, filename: source.filename, sourceFormat: source.source_format,
    decisions, projection, drafts: projection.items,
  };
}
