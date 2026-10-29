import { z } from "zod";

import { copyCountSchema, copyTimestampSchema, copyUuidSchema, copyVersionSchema, sameCopyIdentity } from "@/lib/estimates/copy-response-contract";
import { estimateEditorItemSchema, estimateEditorProjectSchema, estimateEditorVersionSchema } from "@/lib/estimates/editor-read-contracts";
import type { EstimateStatus } from "@/lib/estimates/status";

const cents = copyCountSchema;
export const estimateWriteTotalsSchema = z.object({
  total_ht_cents: cents, total_tax_cents: cents, total_ttc_cents: cents,
}).refine((value) => value.total_ht_cents + value.total_tax_cents === value.total_ttc_cents,
  "Les totaux confirmés sont incohérents.");

// Mutation RPCs return the persisted row, without the GET-only project join.
export const estimatePersistedVersionSchema = estimateEditorVersionSchema.omit({ estimate_projects: true })
  .superRefine((value, context) => {
    if (!estimateWriteTotalsSchema.safeParse(value).success) {
      context.addIssue({ code: "custom", path: ["total_ttc_cents"], message: "Les totaux de la version sont invalides." });
    }
  });
export const estimatePersistedItemSchema = estimateEditorItemSchema.superRefine((value, context) => {
  const totals = [value.line_total_ht_cents, value.line_tax_cents, value.line_total_ttc_cents];
  if (totals.some((total) => total !== null && total < 0) ||
    (value.line_total_ht_cents !== null && value.line_tax_cents !== null && value.line_total_ttc_cents !== null &&
      value.line_total_ht_cents + value.line_tax_cents !== value.line_total_ttc_cents)) {
    context.addIssue({ code: "custom", path: ["line_total_ttc_cents"], message: "Les totaux de la ligne sont invalides." });
  }
});

export const estimateSettingsResponseSchema = z.object({
  version: estimatePersistedVersionSchema,
  items: z.array(estimatePersistedItemSchema),
}).superRefine((value, context) => {
  const ids = new Set<string>();
  value.items.forEach((item, index) => {
    if (!sameCopyIdentity(item.version_id, value.version.id) || !sameCopyIdentity(item.tenant_id, value.version.tenant_id) || ids.has(item.id.toLowerCase())) {
      context.addIssue({ code: "custom", path: ["items", index], message: "Ligne étrangère ou dupliquée." });
    }
    ids.add(item.id.toLowerCase());
  });
});
export const estimateItemWriteResponseSchema = z.object({
  item: estimatePersistedItemSchema,
  version: copyVersionSchema,
  converted_from_item_type: z.enum(["section", "line"]).optional(),
}).refine((value) => sameCopyIdentity(value.item.version_id, value.version.id), "La ligne appartient à un autre devis.");
export const estimateBulkUpdateResponseSchema = z.object({
  updated_count: copyCountSchema,
  version: copyVersionSchema,
  totals: estimateWriteTotalsSchema.optional(),
});
export const estimateStatusResponseSchema = z.object({ version: estimatePersistedVersionSchema });
export const estimateCreateResponseSchema = z.object({
  project: estimateEditorProjectSchema.extend({ id: copyUuidSchema, tenant_id: copyUuidSchema }),
  version: estimatePersistedVersionSchema,
}).refine((value) => sameCopyIdentity(value.project.id, value.version.project_id) &&
  sameCopyIdentity(value.project.tenant_id, value.version.tenant_id) && value.version.status === "draft",
  "La nouvelle version ne correspond pas à l'affaire.");
export const estimateVersionIdResponseSchema = z.object({ version_id: copyUuidSchema });
export const estimatePromoteVariantResponseSchema = estimateStatusResponseSchema.refine((value) =>
  value.version.status === "draft" && value.version.parent_version_id === null && value.version.variant_label === null,
  "La variante promue doit être une version brouillon autonome.");

export const estimateVersionEventSchema = z.object({
  id: copyUuidSchema, estimateVersionId: copyUuidSchema, eventType: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()), createdBy: copyUuidSchema.nullable(),
  actorName: z.string().nullable(), occurredAt: copyTimestampSchema, createdAt: copyTimestampSchema,
});
export type EstimateVersionEvent = z.infer<typeof estimateVersionEventSchema>;
export const estimateEventsResponseSchema = z.object({ events: z.array(estimateVersionEventSchema) })
  .refine((value) => new Set(value.events.map((event) => event.id.toLowerCase())).size === value.events.length,
    "Événement dupliqué.");
const hash = z.string().regex(/^[0-9a-f]{64}$/i);
export const estimateVerifySealResponseSchema = z.object({
  valid: z.boolean(), computed_hash: hash, stored_hash: z.string().nullable(),
  seal_payload_version: copyCountSchema.nullable(),
  client_contract_version: copyCountSchema.nullable().optional(),
  calc_payload_version: copyCountSchema.nullable().optional(),
}).refine((value) => !value.valid || (value.stored_hash !== null && value.computed_hash.toLowerCase() === value.stored_hash.toLowerCase()),
  "Un sceau valide doit confirmer la même empreinte.");

function record(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(value);
}
function aliases(value: unknown, names: Record<string, string[]>): Record<string, unknown> {
  const source = record(value);
  const result = { ...source };
  for (const [canonical, candidates] of Object.entries(names)) {
    if (!(canonical in result)) {
      const alias = candidates.find((key) => key in source);
      if (alias) result[canonical] = source[alias];
    }
  }
  return result;
}
function normalized(value: unknown) {
  const root = aliases(value, { version: ["estimateVersion", "versionToken", "version_token"], item: ["estimateItem"], items: ["estimateItems", "estimate_items"], updated_count: ["updatedCount"] });
  if (root.version !== undefined) root.version = aliases(root.version, { updated_at: ["updatedAt"], content_revision: ["contentRevision"] });
  return root;
}
function matches(condition: boolean) {
  if (!condition) throw new Error("La confirmation ne correspond pas à l'action demandée. Relisez le devis.");
}
export function parseSaveEstimateVersionResponse(value: unknown, versionId: string) {
  const result = estimateSettingsResponseSchema.parse(normalized(value));
  matches(sameCopyIdentity(result.version.id, versionId));
  return result;
}
export function parseEstimateItemWriteResponse(value: unknown, versionId: string, itemId?: string) {
  const result = estimateItemWriteResponseSchema.parse(normalized(value));
  matches(sameCopyIdentity(result.version.id, versionId) && (!itemId || sameCopyIdentity(result.item.id, itemId)));
  return result;
}
export function parseBulkUpdateEstimateItemsResponse(value: unknown, versionId: string) {
  const result = estimateBulkUpdateResponseSchema.parse(normalized(value));
  matches(sameCopyIdentity(result.version.id, versionId));
  return result;
}
export function parseEstimateStatusResponse(value: unknown, versionId: string, status: EstimateStatus) {
  const result = estimateStatusResponseSchema.parse(normalized(value));
  matches(sameCopyIdentity(result.version.id, versionId) && result.version.status === status);
  return result;
}
export function parseCreateEstimateResponse(value: unknown, projectId?: string) {
  const result = estimateCreateResponseSchema.parse(normalized(value));
  matches(!projectId || sameCopyIdentity(result.project.id, projectId));
  return result;
}
export function parseEstimateVersionIdResponse(value: unknown, sourceVersionId?: string) {
  const result = estimateVersionIdResponseSchema.parse(aliases(value, {
    version_id: ["versionId", "duplicatedVersionId", "duplicated_version_id", "variantVersionId", "variant_version_id", "id"],
  }));
  matches(!sourceVersionId || !sameCopyIdentity(result.version_id, sourceVersionId));
  return result;
}
export function parsePromoteEstimateVariantResponse(value: unknown, versionId: string) {
  const result = estimatePromoteVariantResponseSchema.parse(normalized(value));
  matches(sameCopyIdentity(result.version.id, versionId));
  return result;
}
export function parseEstimateEventsResponse(value: unknown, versionId: string) {
  const root = aliases(value, { events: ["items"] });
  if (Array.isArray(root.events)) root.events = root.events.map((event) => aliases(event, {
    estimateVersionId: ["estimate_version_id"], eventType: ["event_type"], createdBy: ["created_by"],
    actorName: ["actor_name"], occurredAt: ["occurred_at"], createdAt: ["created_at"],
  }));
  const result = estimateEventsResponseSchema.parse(root);
  matches(result.events.every((event) => sameCopyIdentity(event.estimateVersionId, versionId)));
  return result;
}
export function parseVerifyEstimateSealResponse(value: unknown) {
  return estimateVerifySealResponseSchema.parse(value);
}
