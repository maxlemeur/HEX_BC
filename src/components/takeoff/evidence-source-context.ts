import {
  readPlanDocumentMetadata,
  type PlanDocumentMetadata,
} from "@/components/takeoff/plan-document-metadata";

type EvidenceSourceItem = {
  source_file_name: string | null;
  source_page: number | null;
  metadata: Record<string, unknown>;
};

export type EvidenceSourceContext = {
  documentUrl: string | null;
  documentPageUrl: string | null;
  previewUrl: string | null;
  zoneLabel: string | null;
  hasZoneCoordinates: boolean;
  sourceDocumentId: string | null;
  extractionProvider: string | null;
  extractionModel: string | null;
  revision: PlanDocumentMetadata;
  isPdfSource: boolean;
};

const DOCUMENT_URL_KEYS = [
  "signed_document_url",
  "source_signed_url",
  "source_document_url",
  "source_file_signed_url",
  "download_url",
  "signed_url",
] as const;

const PREVIEW_URL_KEYS = [
  "evidence_preview_url",
  "source_preview_url",
  "page_preview_url",
  "preview_url",
  "thumbnail_url",
] as const;

const URL_CONTAINER_KEYS = [
  "source",
  "document",
  "signed_document",
  "source_document",
  "preview",
] as const;

const NESTED_URL_KEYS = [
  "signed_url",
  "signedUrl",
  "download_url",
  "downloadUrl",
  "preview_url",
  "previewUrl",
  "url",
] as const;

const ZONE_KEYS = [
  "source_zone",
  "sourceZone",
  "page_zone",
  "pageZone",
  "zone",
  "zone_label",
  "zoneLabel",
  "location",
  "location_label",
  "locationLabel",
] as const;

const ZONE_CONTAINER_KEYS = ["source_zone", "sourceZone", "zone", "location"] as const;

const ZONE_COORDINATE_KEYS = [
  "bounding_box",
  "boundingBox",
  "bbox",
  "coordinates",
  "polygon",
] as const;

const SOURCE_DOCUMENT_ID_KEYS = [
  "sourceDocumentId",
  "source_document_id",
  "plan_file_id",
  "planFileId",
  "document_id",
  "documentId",
] as const;

const PROVENANCE_CONTAINER_KEYS = [
  "_timax_provenance",
  "provenance",
  "provider_meta",
  "extraction",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSafeHttpUrl(value: unknown): string | null {
  const normalized = toNonEmptyString(value);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return normalized;
  } catch {
    return null;
  }
}

function readFirstString(
  metadata: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = toNonEmptyString(metadata[key]);
    if (value) return value;
  }
  return null;
}

function readUrl(
  metadata: Record<string, unknown>,
  directKeys: readonly string[]
): string | null {
  for (const key of directKeys) {
    const url = toSafeHttpUrl(metadata[key]);
    if (url) return url;
  }

  for (const containerKey of URL_CONTAINER_KEYS) {
    const container = metadata[containerKey];
    if (!isRecord(container)) continue;
    for (const nestedKey of NESTED_URL_KEYS) {
      const url = toSafeHttpUrl(container[nestedKey]);
      if (url) return url;
    }
  }
  return null;
}

function addPageAnchor(url: string, sourcePage: number | null): string {
  if (!sourcePage || sourcePage < 1 || url.includes("#")) return url;

  try {
    const parsed = new URL(url);
    parsed.hash = `page=${sourcePage}`;
    return parsed.toString();
  } catch {
    return `${url}#page=${sourcePage}`;
  }
}

function readZoneLabel(metadata: Record<string, unknown>): string | null {
  const directLabel = readFirstString(metadata, ZONE_KEYS);
  if (directLabel) return directLabel;

  for (const containerKey of ZONE_CONTAINER_KEYS) {
    const container = metadata[containerKey];
    if (!isRecord(container)) continue;
    const nestedLabel = readFirstString(container, ["label", "name", "title", "text"]);
    if (nestedLabel) return nestedLabel;
  }
  return null;
}

function hasZoneCoordinates(metadata: Record<string, unknown>): boolean {
  const containers: Record<string, unknown>[] = [metadata];
  for (const containerKey of ZONE_CONTAINER_KEYS) {
    const container = metadata[containerKey];
    if (isRecord(container)) containers.push(container);
  }

  return containers.some((container) =>
    ZONE_COORDINATE_KEYS.some((key) => {
      const value = container[key];
      if (Array.isArray(value)) return value.length > 0;
      return isRecord(value) && Object.keys(value).length > 0;
    })
  );
}

function readProvenanceValue(
  metadata: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  const directValue = readFirstString(metadata, keys);
  if (directValue) return directValue;

  for (const containerKey of PROVENANCE_CONTAINER_KEYS) {
    const container = metadata[containerKey];
    if (!isRecord(container)) continue;
    const nestedValue = readFirstString(container, keys);
    if (nestedValue) return nestedValue;
  }
  return null;
}

export function resolveEvidenceSourceContext(
  item: EvidenceSourceItem
): EvidenceSourceContext {
  const documentUrl = readUrl(item.metadata, DOCUMENT_URL_KEYS);
  const specificPreviewUrl = readUrl(item.metadata, PREVIEW_URL_KEYS);
  const zoneLabel = readZoneLabel(item.metadata);
  const sourceFileName = item.source_file_name?.trim().toLocaleLowerCase("fr") ?? "";
  const documentType = readProvenanceValue(item.metadata, [
    "document_type",
    "documentType",
    "source_type",
    "sourceType",
  ])?.toLocaleLowerCase("fr");
  const isPdfSource =
    sourceFileName.endsWith(".pdf") ||
    documentType === "pdf" ||
    documentType === "plan" ||
    (documentUrl?.toLocaleLowerCase("fr").includes(".pdf") ?? false);

  return {
    documentUrl,
    documentPageUrl: documentUrl
      ? addPageAnchor(documentUrl, item.source_page)
      : null,
    previewUrl: specificPreviewUrl
      ? addPageAnchor(specificPreviewUrl, item.source_page)
      : documentUrl
        ? addPageAnchor(documentUrl, item.source_page)
        : null,
    zoneLabel,
    hasZoneCoordinates: hasZoneCoordinates(item.metadata),
    sourceDocumentId: readProvenanceValue(
      item.metadata,
      SOURCE_DOCUMENT_ID_KEYS
    ),
    extractionProvider: readProvenanceValue(item.metadata, [
      "provider",
      "extraction_provider",
      "extractionProvider",
    ]),
    extractionModel: readProvenanceValue(item.metadata, [
      "model",
      "model_name",
      "modelName",
    ]),
    revision: readPlanDocumentMetadata(item.metadata),
    isPdfSource,
  };
}

export function hasMissingEvidenceSourceContext(item: EvidenceSourceItem): boolean {
  const context = resolveEvidenceSourceContext(item);
  const hasDocument = Boolean(item.source_file_name || context.documentUrl);
  if (!hasDocument) return true;
  if (!context.isPdfSource) return false;

  return (
    item.source_page === null &&
    !context.zoneLabel &&
    !context.hasZoneCoordinates
  );
}
