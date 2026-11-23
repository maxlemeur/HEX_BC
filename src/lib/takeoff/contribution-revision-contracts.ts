import { z } from "zod";

import { countMarksEditRequestSchema, countMarksEditResultSchema } from "@/lib/takeoff/count-marks-contracts";
import {
  itemSendPageDecisionSchema,
  itemSendPreviewRequestSchema,
  itemSendPreviewResponseSchema,
} from "@/lib/takeoff/item-send-contracts";
import { quantityEntrySchema } from "@/lib/takeoff/quantity-entry";

const id = z.string().uuid();
const revision = z.number().int().nonnegative();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const source = z.enum(["entered", "measured", "verified_count", "withdraw"]);
const scope = { version_id: id, receipt_id: id };
const expected = z
  .object({
    work_revision: revision,
    marks_revision: revision,
    answer_revision: digest,
    plan_entry_revision: revision.nullable(),
  })
  .strict();
const selection = z.union([
  z.object({ source: z.enum(["entered", "measured", "verified_count"]) }).strict(),
  z
    .object({
      source: z.literal("withdraw"),
      reason: z.enum(["out_of_scope", "duplicate", "reading_error", "other"]),
      note: z.string().max(500).optional(),
    })
    .strict(),
]);
export const revisionChoicesSchema = z
  .object({
    lines: z.record(id, z.enum(["keep_entry", "use_retained"])).optional(),
    leave_out: z.array(id).max(1000).optional(),
    page_decisions: z.array(itemSendPageDecisionSchema).max(1000).optional(),
    additions: itemSendPreviewRequestSchema.omit({ destination: true }).optional(),
  })
  .strict();
export type RevisionChoices = z.infer<typeof revisionChoicesSchema>;
export const revisionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), items: z.array(id).min(1).max(1000) }).strict(),
  z
    .object({
      action: z.literal("entry"),
      ...scope,
      answer_id: id,
      intent_id: id,
      expected_revision: revision,
      entry: z.union([
        quantityEntrySchema.extend({
          quantity: z.number().positive().max(999999999.999),
          unit: z.string().min(1).max(16),
        }),
        z.object({ action: z.literal("include_entry") }).strict(),
      ]),
    })
    .strict(),
  z
    .object({ action: z.literal("choose"), ...scope, answer_id: id, intent_id: id, expected, choice: selection })
    .strict(),
  z.object({ action: z.literal("marks"), ...scope, command: countMarksEditRequestSchema }).strict(),
  z.object({ action: z.literal("preview"), ...scope, choices: revisionChoicesSchema }).strict(),
  z
    .object({ action: z.literal("confirm"), ...scope, choices: revisionChoicesSchema, intent_id: id, digest })
    .strict(),
]);
export type RevisionRequest = z.infer<typeof revisionRequestSchema>;
const pages = z.array(z.number().int());
const sentPart = z.object({
  id,
  kind: source,
  quantity: z.number(),
  unit: z.string(),
  pages,
  marks_revision: revision.nullable(),
  entry_revision: revision.nullable(),
  line_title: z.string().nullable(),
  estimate_item_id: id.nullable(),
});
const correction = z.object({
  quantity: z.number().nullable(),
  source: source.nullable(),
  ready: z.boolean().nullable(),
  marks_revision: revision,
});
export const revisionItemSchema = z.object({
  item_id: id,
  answer_id: id,
  answer_revision: digest,
  work_revision: revision,
  current: z.boolean(),
  sent: z.array(sentPart),
  correction: correction.nullable(),
  sources: z.object({
    marks_revision: revision,
    plan_entry_revision: revision.nullable(),
    unit: z.string().nullable(),
    measured: z.number().nullable(),
    measured_unit: z.string().nullable(),
    whole_entry: z.boolean(),
    reference: z.number().nullable(),
    anomaly: z.boolean(),
    mixed_units: z.boolean(),
    entry: z
      .object({
        id,
        quantity: z.number(),
        unit: z.string(),
        category: z.string(),
        included: z.boolean(),
        note: z.string().nullable(),
      })
      .nullable(),
    verified: z.object({ quantity: z.number().nullable(), unit: z.string().nullable(), pages }).nullable(),
  }),
});
export const revisionReadSchema = z.object({
  version_id: id,
  receipt_id: id.nullable(),
  job_id: id,
  editable: z.boolean(),
  items: z.array(revisionItemSchema),
});
const version = revisionReadSchema.extend({ version_number: z.number().int(), status: z.string() });
export type RevisionVersion = z.infer<typeof version>;
export type RevisionItem = z.infer<typeof revisionItemSchema>;
export const revisionPartSchema = z.object({
  kind: source,
  quantity: z.number(),
  unit: z.string(),
  pages,
  basis: z.string().nullable(),
  observation_id: id.nullable(),
  marks_revision: revision.nullable(),
  entry_revision: revision.nullable(),
});
export const revisionChangeSchema = correction.extend({
  item_id: id,
  answer_id: id,
  action: z.enum(["add", "withdraw", "replace"]),
  label: z.string(),
  before_parts: z.array(
    sentPart.pick({
      id: true,
      quantity: true,
      unit: true,
      kind: true,
      pages: true,
      marks_revision: true,
      entry_revision: true,
    }),
  ),
  parts: z.array(revisionPartSchema),
});
export type RevisionChange = z.infer<typeof revisionChangeSchema>;
const blocker = z.object({
  send_code: z.string().optional(),
  reason: z.string(),
  item_id: id.optional(),
  item_ids: z.array(id).optional(),
  line_id: id.optional(),
  message: z.string().optional(),
  title: z.string().nullable().optional(),
  entered: z.number().optional(),
  retained: z.number().nullable().optional(),
  reference: z.number().nullable().optional(),
  current_reading_revision: revision.nullable().optional(),
  document: z.string().nullable().optional(),
  earlier: z
    .array(
      z.object({
        job_id: id,
        document: z.string().nullable(),
        reading_revision: revision.nullable(),
        quantity: z.number(),
        unit: z.string(),
        pages,
      }),
    )
    .optional(),
  line: z.object({ title: z.string().nullable().optional(), line_id: id, reason: z.string() }).optional(),
  pages: z
    .array(
      z.object({
        page: z.number().int().nullable(),
        today_estimate_item_ids: z.array(id).optional(),
        parts: z
          .array(z.object({ estimate_item_id: id.nullable(), plan_key: id.nullable(), item_id: id }))
          .optional(),
      }),
    )
    .optional(),
});
export const revisionPreviewSchema = z.object({
  currency: z.string(),
  digest,
  changes: z.array(revisionChangeSchema),
  blockers: z.array(blocker),
  additions: z.array(id),
  actions: z.array(
    z.object({
      action: z.string(),
      item_id: id,
      estimate_item_id: id,
      title: z.string().nullable(),
      quantity_before: z.number(),
      quantity_after: z.number().nullable(),
      unit_code: z.string().nullable(),
      kept_quantity: z.number(),
      price_cents: z.number().nullable(),
      compartment: z.string(),
    }),
  ),
  left_out: z.array(z.object({ item_id: id })),
  addition_preview: itemSendPreviewResponseSchema.optional(),
});
export type RevisionPreview = z.infer<typeof revisionPreviewSchema>;
export const revisionResponseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), versions: z.array(version) }),
  z.object({ action: z.literal("preview"), preview: revisionPreviewSchema }),
  z.object({ action: z.literal("confirm"), receipt_id: id, replayed: z.boolean() }),
  z.object({ action: z.literal("marks"), result: countMarksEditResultSchema }),
  z.object({ action: z.enum(["entry", "choose"]), replayed: z.boolean() }),
]);
