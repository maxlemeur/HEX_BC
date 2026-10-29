import { z } from "zod";

import { copiedIdsSchema, copyCountSchema, copyUuidSchema, copyVersionSchema, sameCopyIdentity } from "@/lib/estimates/copy-response-contract";


export const estimateItemsReorderResponseSchema = z.object({
  parent_id: copyUuidSchema.nullable(),
  ordered_ids: copiedIdsSchema.min(1),
  updated_count: copyCountSchema,
  version: copyVersionSchema,
}).refine((value) => value.updated_count === value.ordered_ids.length,
  "Le nombre de lignes réordonnées est incohérent.");

export const estimateItemsMoveResponseSchema = z.object({
  item_id: copyUuidSchema,
  from_parent_id: copyUuidSchema.nullable(),
  to_parent_id: copyUuidSchema.nullable(),
  ordered_source_ids: copiedIdsSchema,
  ordered_target_ids: copiedIdsSchema.min(1),
  updated_count: copyCountSchema,
  version: copyVersionSchema,
}).refine((value) => value.updated_count === value.ordered_source_ids.length + value.ordered_target_ids.length,
  "Le nombre de lignes déplacées est incohérent.").refine((value) =>
  !sameParent(value.from_parent_id, value.to_parent_id)
  && !value.ordered_source_ids.some((id) => sameCopyIdentity(id, value.item_id))
  && value.ordered_target_ids.some((id) => sameCopyIdentity(id, value.item_id))
  && !value.ordered_source_ids.some((id) => value.ordered_target_ids.some((target) => sameCopyIdentity(id, target))),
  "Les parents ou les lignes du déplacement sont incohérents.");

export const estimateItemDeleteResponseSchema = z.object({
  deleted_id: copyUuidSchema,
  deleted_ids: copiedIdsSchema.min(1),
  version: copyVersionSchema,
}).refine((value) => value.deleted_ids.some((id) => sameCopyIdentity(id, value.deleted_id)),
  "La suppression ne confirme pas la ligne demandée.");

function parseReceipt<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error("La confirmation de modification est invalide. Relisez le devis avant de poursuivre.");
  return parsed.data;
}
function sameParent(left: string | null, right: string | null) {
  return left === null || right === null ? left === right : sameCopyIdentity(left, right);
}
function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => sameCopyIdentity(id, right[index]));
}
function assertReceiptMatches(matches: boolean) {
  if (!matches) throw new Error("La confirmation ne correspond pas à la modification demandée. Relisez le devis avant de poursuivre.");
}

export function parseEstimateItemsReorderResponse(data: unknown, expected: {
  versionId: string; parentId: string | null; orderedIds: string[];
}) {
  const result = parseReceipt(estimateItemsReorderResponseSchema, data);
  assertReceiptMatches(sameCopyIdentity(result.version.id, expected.versionId)
    && sameParent(result.parent_id, expected.parentId) && sameOrder(result.ordered_ids, expected.orderedIds));
  return result;
}

export function parseEstimateItemsMoveResponse(data: unknown, versionId: string,
  expected: Omit<z.infer<typeof estimateItemsMoveResponseSchema>, "version" | "updated_count">) {
  const result = parseReceipt(estimateItemsMoveResponseSchema, data);
  assertReceiptMatches(sameCopyIdentity(result.version.id, versionId)
    && sameCopyIdentity(result.item_id, expected.item_id)
    && sameParent(result.from_parent_id, expected.from_parent_id)
    && sameParent(result.to_parent_id, expected.to_parent_id)
    && sameOrder(result.ordered_source_ids, expected.ordered_source_ids)
    && sameOrder(result.ordered_target_ids, expected.ordered_target_ids));
  return result;
}

export function parseEstimateItemDeleteResponse(data: unknown, versionId: string, itemId: string) {
  const result = parseReceipt(estimateItemDeleteResponseSchema, data);
  assertReceiptMatches(sameCopyIdentity(result.version.id, versionId) && sameCopyIdentity(result.deleted_id, itemId));
  return result;
}
