import { createHash } from "node:crypto";

import { reconcileTakeoffPageTriageStatuses } from "@/lib/takeoff/page-triage";
import type { TakeoffPreparation, TakeoffPreparationSource } from "@/lib/takeoff/preparation";
import { getPlanFileDisplayName } from "@/lib/takeoff/plan-file-display-name";

export type PreparationPlanFile = {
  id: string;
  plan_set_id: string;
  file_path: string;
  file_name: string;
  file_size_bytes: number;
  file_hash?: string | null;
  page_count: number | null;
  updated_at?: string;
  metadata?: Record<string, unknown> | null;
};

export type PreparationIntakeDocument = {
  id: string; file_name: string; storage_path: string | null; size_bytes: number;
  mime_type: string | null; document_kind: string; updated_at: string;
  extracted_metadata?: Record<string, unknown> | null;
};

export function getPreparationIntakeSourceVersion(document: PreparationIntakeDocument): string {
  return createHash("sha256").update(JSON.stringify([
    document.id, document.storage_path, document.file_name, document.mime_type, document.size_bytes, document.document_kind, document.updated_at,
  ])).digest("hex");
}

export function toPreparationIntakeSource(document: PreparationIntakeDocument): TakeoffPreparationSource {
  return {
    document_id: document.id, document_name: document.file_name,
    kind: document.document_kind === "dpgf" || document.document_kind === "cctp" ? document.document_kind : "other",
    revision: typeof document.extracted_metadata?.revision === "string" ? document.extracted_metadata.revision : null,
    source_version: getPreparationIntakeSourceVersion(document), pages: [], active: false, confirmed: false,
    plan_set_id: null, file_path: document.storage_path, page_count: null, logical_document_id: null,
    content_hash: null, source_updated_at: document.updated_at,
    mime_type: document.mime_type, page_triage: null,
  };
}

/** Content hash where present, otherwise immutable object path plus DB identity. */
export function getPreparationPlanSourceVersion(file: PreparationPlanFile): string {
  return createHash("sha256").update(JSON.stringify([
    file.id, file.plan_set_id, file.file_path, file.file_hash ?? null,
    file.file_size_bytes, file.page_count, file.updated_at ?? null,
  ])).digest("hex");
}

export function toPreparationPlanSource(file: PreparationPlanFile): TakeoffPreparationSource {
  return {
    document_id: file.id,
    document_name: getPlanFileDisplayName({ file_name: file.file_name, metadata: file.metadata ?? null }),
    kind: "plan",
    revision: typeof file.metadata?.revision === "string" ? file.metadata.revision : null,
    source_version: getPreparationPlanSourceVersion(file),
    pages: [],
    active: false,
    confirmed: false,
    plan_set_id: file.plan_set_id,
    file_path: file.file_path,
    page_count: file.page_count,
    logical_document_id: typeof file.metadata?.logical_document_id === "string" ? file.metadata.logical_document_id : null,
    content_hash: null,
    source_updated_at: file.updated_at ?? null,
    mime_type: "application/pdf",
    page_triage: null,
  };
}

export function getPreparationSourcesFingerprint(sources: TakeoffPreparationSource[]): string {
  return createHash("sha256").update(JSON.stringify(sources.map((source) => [
    source.document_id, source.source_version,
  ]).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}

/** Keep decisions; a changed or disappeared reference has to be confirmed again. */
export function reconcilePreparationSources(
  preparation: TakeoffPreparation,
  availableSources: TakeoffPreparationSource[]
): { draft: TakeoffPreparation; changedSourceIds: string[] } {
  const available = new Map(availableSources.map((source) => [source.document_id, source]));
  const changedSourceIds: string[] = [];
  const activePlanSets = new Set(preparation.sources.filter((source) => source.active).map((source) => source.plan_set_id));
  const sources = preparation.sources.map((source) => {
    // An upload is never triaged: it has no stored file to render server-side.
    if (source.document_id.startsWith("upload:")) return source.page_triage ? { ...source, page_triage: null } : source;
    const current = available.get(source.document_id);
    available.delete(source.document_id);
    // A triage describes one file version; pages and active stay as the user chose.
    if (!current) {
      changedSourceIds.push(source.document_id);
      return { ...source, confirmed: false, source_version: "", page_triage: null };
    }
    if (current.source_version !== source.source_version) {
      changedSourceIds.push(source.document_id);
      return { ...source, ...current, active: source.active, pages: source.pages, revision: source.revision, confirmed: false, page_triage: null };
    }
    const triage = source.page_triage;
    const staleTriage = triage && (triage.source_version !== source.source_version || (current.page_count !== null && triage.page_count !== current.page_count));
    return reconcileTakeoffPageTriageStatuses({
      ...source, file_path: current.file_path, plan_set_id: current.plan_set_id, page_count: current.page_count, source_updated_at: current.source_updated_at, mime_type: current.mime_type, kind: current.kind,
      page_triage: staleTriage || current.kind !== "plan" ? null : triage,
    });
  });
  for (const source of available.values()) {
    if (source.plan_set_id && activePlanSets.has(source.plan_set_id)) changedSourceIds.push(source.document_id);
  }
  const activeChanged = preparation.sources.some((source) => source.active && changedSourceIds.includes(source.document_id));
  const calibrationChanged = preparation.conventions.calibration?.document_id && changedSourceIds.includes(preparation.conventions.calibration.document_id);
  return { draft: {
    ...preparation, sources: [...sources, ...available.values()],
    conventions: activeChanged ? { ...preparation.conventions, confirmed: false, ...(calibrationChanged ? { calibration: null } : {}) } : preparation.conventions,
  }, changedSourceIds };
}
