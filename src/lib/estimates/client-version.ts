import { copyVersionSchema } from "@/lib/estimates/copy-response-contract";
import { extractEntity, hasOwnProperty } from "@/lib/estimates/client-json";
import type { Database } from "@/types/database";
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];

export type EstimateVersionToken = Pick<EstimateVersionRow, "id" | "updated_at"> & { content_revision?: number };

export type BulkUpdateEstimateVersionPatch = Pick<
  EstimateVersionRow,
  "total_ht_cents" | "total_tax_cents" | "total_ttc_cents"
>;

export function parseVersionToken(payload: unknown): EstimateVersionToken | null {
  const entity = extractEntity(payload, [
    "version", "estimateVersion", "version_token", "versionToken",
  ]);
  if (!entity) return null;

  // Legacy endpoints may return only the token. Keep their field aliases,
  // but never enrich or publish a revision from an invalid timestamp or UUID.
  const parsed = copyVersionSchema.safeParse({
    ...entity,
    updated_at: hasOwnProperty(entity, "updated_at") ? entity.updated_at : entity.updatedAt,
    content_revision: hasOwnProperty(entity, "content_revision") ? entity.content_revision : entity.contentRevision,
  });
  return parsed.success ? parsed.data : null;
}
