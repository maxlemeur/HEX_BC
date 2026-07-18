import type {
  PlanFileListItem,
  PlanSetListItem,
} from "@/lib/takeoff/types";

export const PLAN_REVISION_STATUSES = [
  "unknown",
  "active",
  "draft",
  "obsolete",
] as const;

export type PlanRevisionStatus = (typeof PLAN_REVISION_STATUSES)[number];

export type PlanDocumentMetadata = {
  revision: string | null;
  revisionDate: string | null;
  lot: string | null;
  zone: string | null;
  status: PlanRevisionStatus;
};

export type PlanDuplicateState = {
  kind: "exact" | "possible";
  matchingFileNames: string[];
};

const REVISION_KEYS = [
  "revision",
  "revision_index",
  "revisionIndex",
  "indice",
] as const;

const REVISION_DATE_KEYS = [
  "revision_date",
  "revisionDate",
  "document_date",
  "documentDate",
  "plan_date",
  "planDate",
] as const;

const LOT_KEYS = [
  "lot",
  "lot_label",
  "lotLabel",
  "lot_name",
  "lotName",
  "trade_label",
  "tradeLabel",
] as const;

const ZONE_KEYS = [
  "zone",
  "zone_label",
  "zoneLabel",
  "area",
  "area_label",
  "areaLabel",
] as const;

const REVISION_STATUS_KEYS = [
  "revision_status",
  "revisionStatus",
  "document_status",
  "documentStatus",
] as const;

const ACTIVE_STATUS_VALUES = new Set([
  "active",
  "actif",
  "actif pour metre",
  "current",
  "latest",
  "valide",
  "validé",
]);

const DRAFT_STATUS_VALUES = new Set([
  "draft",
  "brouillon",
  "provisional",
  "provisoire",
]);

const OBSOLETE_STATUS_VALUES = new Set([
  "obsolete",
  "obsolète",
  "superseded",
  "archive",
  "archivé",
  "inactive",
]);

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readFirstString(
  metadata: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = toTrimmedString(metadata[key]);
    if (value) return value;
  }
  return null;
}

function normalizeRevisionDate(value: string | null): string | null {
  if (!value) return null;
  const isoDate = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? null;
  if (!isoDate) return null;

  const timestamp = Date.parse(`${isoDate}T00:00:00.000Z`);
  return Number.isNaN(timestamp) ? null : isoDate;
}

function normalizeRevisionStatus(value: string | null): PlanRevisionStatus {
  if (!value) return "unknown";
  const normalized = value.trim().toLocaleLowerCase("fr");
  if (ACTIVE_STATUS_VALUES.has(normalized)) return "active";
  if (DRAFT_STATUS_VALUES.has(normalized)) return "draft";
  if (OBSOLETE_STATUS_VALUES.has(normalized)) return "obsolete";
  return "unknown";
}

export function readPlanDocumentMetadata(
  metadata: Record<string, unknown>
): PlanDocumentMetadata {
  return {
    revision: readFirstString(metadata, REVISION_KEYS),
    revisionDate: normalizeRevisionDate(
      readFirstString(metadata, REVISION_DATE_KEYS)
    ),
    lot: readFirstString(metadata, LOT_KEYS),
    zone: readFirstString(metadata, ZONE_KEYS),
    status: normalizeRevisionStatus(
      readFirstString(metadata, REVISION_STATUS_KEYS)
    ),
  };
}

function clearKeys(
  metadata: Record<string, unknown>,
  keys: readonly string[]
) {
  for (const key of keys) {
    delete metadata[key];
  }
}

export function mergePlanDocumentMetadata(
  currentMetadata: Record<string, unknown>,
  input: PlanDocumentMetadata
): Record<string, unknown> {
  const nextMetadata = { ...currentMetadata };

  clearKeys(nextMetadata, REVISION_KEYS);
  clearKeys(nextMetadata, REVISION_DATE_KEYS);
  clearKeys(nextMetadata, LOT_KEYS);
  clearKeys(nextMetadata, ZONE_KEYS);
  clearKeys(nextMetadata, REVISION_STATUS_KEYS);

  if (input.revision) nextMetadata.revision = input.revision.trim();
  if (input.revisionDate) nextMetadata.revision_date = input.revisionDate;
  if (input.lot) nextMetadata.lot = input.lot.trim();
  if (input.zone) nextMetadata.zone = input.zone.trim();
  nextMetadata.revision_status = input.status;

  return nextMetadata;
}

function toRevisionScopeKey(planSet: PlanSetListItem): string | null {
  const metadata = readPlanDocumentMetadata(planSet.metadata);
  if (!metadata.lot && !metadata.zone) return null;
  return [metadata.lot ?? "", metadata.zone ?? ""]
    .map((value) => value.trim().toLocaleLowerCase("fr"))
    .join("::");
}

export function findConflictingActivePlanSetIds(
  planSets: PlanSetListItem[]
): Set<string> {
  const idsByScope = new Map<string, string[]>();

  for (const planSet of planSets) {
    if (readPlanDocumentMetadata(planSet.metadata).status !== "active") {
      continue;
    }
    const scopeKey = toRevisionScopeKey(planSet);
    if (!scopeKey) continue;
    const ids = idsByScope.get(scopeKey) ?? [];
    ids.push(planSet.id);
    idsByScope.set(scopeKey, ids);
  }

  const conflictingIds = new Set<string>();
  for (const ids of idsByScope.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) conflictingIds.add(id);
  }
  return conflictingIds;
}

function normalizeFileName(fileName: string): string {
  return fileName.trim().toLocaleLowerCase("fr");
}

export function findPlanFileDuplicates(
  files: PlanFileListItem[]
): Map<string, PlanDuplicateState> {
  const exactIdsByHash = new Map<string, PlanFileListItem[]>();
  const possibleIdsBySignature = new Map<string, PlanFileListItem[]>();

  for (const file of files) {
    const normalizedHash = toTrimmedString(file.file_hash)?.toLocaleLowerCase("en");
    if (normalizedHash) {
      const hashGroup = exactIdsByHash.get(normalizedHash) ?? [];
      hashGroup.push(file);
      exactIdsByHash.set(normalizedHash, hashGroup);
    }

    const signature = `${normalizeFileName(file.file_name)}::${file.file_size_bytes}`;
    const signatureGroup = possibleIdsBySignature.get(signature) ?? [];
    signatureGroup.push(file);
    possibleIdsBySignature.set(signature, signatureGroup);
  }

  const result = new Map<string, PlanDuplicateState>();
  for (const group of exactIdsByHash.values()) {
    if (group.length < 2) continue;
    for (const file of group) {
      result.set(file.id, {
        kind: "exact",
        matchingFileNames: group
          .filter((candidate) => candidate.id !== file.id)
          .map((candidate) => candidate.file_name),
      });
    }
  }

  for (const group of possibleIdsBySignature.values()) {
    if (group.length < 2) continue;
    for (const file of group) {
      if (result.has(file.id)) continue;
      result.set(file.id, {
        kind: "possible",
        matchingFileNames: group
          .filter((candidate) => candidate.id !== file.id)
          .map((candidate) => candidate.file_name),
      });
    }
  }

  return result;
}
