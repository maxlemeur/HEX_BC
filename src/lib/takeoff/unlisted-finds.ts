import { z } from "zod";

const uuid = z.string().uuid();
const index = z.number().int().nonnegative();
export const FIND_REASONS = {
  outside_scope: "Hors de mon lot",
  retained_existing: "Existant conservé",
  already_counted: "Déjà compté dans un autre poste",
  other: "Autre",
} as const;
const reason = z.enum(["outside_scope", "retained_existing", "already_counted", "other"]);
const coordinate = z.object({ jobId: uuid, index });
const section = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default") }).strict(),
  z.object({ kind: z.literal("existing"), itemId: uuid }).strict(),
  z.object({ kind: z.literal("new"), title: z.string().trim().min(1).max(120) }).strict(),
]);
export const findCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), intentKey: uuid, expectedRevision: z.number().int().positive(),
    entries: z.array(coordinate.extend({ label: z.string().trim().min(1).max(4000), unit: z.string().trim().min(1).max(32),
      section }).strict()).min(1).max(10000) }).strict(),
  coordinate.extend({ kind: z.literal("dismiss"), intentKey: uuid, reason, detail: z.string().trim().min(1).max(300).optional() }).strict(),
  z.object({ kind: z.literal("undo"), decisionId: uuid }).strict(),
]);
const find = coordinate.extend({ planKey: uuid, fileId: uuid, documentId: uuid.nullable(), planName: z.string(),
  page: z.number().int().positive(), designation: z.string(), evidence: z.string() });
export const findsViewSchema = z.object({
  canWrite: z.boolean(), revisionId: uuid.nullable(), revision: z.number().int(), originLine: z.string().nullable(),
  sections: z.array(z.object({ itemId: uuid, name: z.string() })),
  finds: z.array(find),
  decisions: z.array(find.extend({ id: uuid, itemId: uuid.nullable(), author: z.string(), date: z.string(),
    reason: reason.nullable(), detail: z.string().nullable() })),
  notices: z.array(z.object({ planKey: uuid, planName: z.string(), total: z.number(), missing: z.number(), outside: z.number(),
    truncated: z.boolean() })),
});
export const findReceiptSchema = z.object({ itemIds: z.array(uuid) });
export type FindCommand = z.infer<typeof findCommandSchema>;
export type FindsView = z.infer<typeof findsViewSchema>;
export type UnlistedFind = z.infer<typeof find>;

/** Matches takeoff_find_designation_key, including the fallback for a wholly blank or combining designation. */
export function designationKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase()
    .replace(/\p{White_Space}+/gu, " ").replace(/^ | $/gu, "").normalize("NFC") || value;
}
export const LIST_MISMATCH_FRACTION = 0.5;
export function listMismatchesPlan(facts: FindsView["notices"][number]) {
  return facts.outside > 0 && facts.missing > facts.total * LIST_MISMATCH_FRACTION;
}
