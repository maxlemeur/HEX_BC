import { z } from "zod";

import { ITEM_LIST_LIMITS } from "./item-list";
import { itemTemplateDefinitionSchema, ITEM_TEMPLATE_KEYS } from "./item-template";

/**
 * Contracts of the affaire's item list and of the item templates (lot 4, migration A). A write names what it read:
 * the list revision (0 before the first), the proposal's digest, the template draft's revision and version.
 */

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
  .transform((value) => value ? value : null);
const qualifier = z.string().trim().min(1).max(ITEM_LIST_LIMITS.qualifier).optional();

export const itemListAcceptRequestSchema = z.object({
  expected_revision: z.number().int().min(0),
  proposal_digest: z.string().regex(/^[0-9a-f]{64}$/),
  intent_key: uuid,
  continuities: z.array(z.object({ previous_item_id: uuid, next_item_id: uuid }).strict()).max(ITEM_LIST_LIMITS.items),
}).strict();

export const itemListAddRequestSchema = z.object({
  expected_revision: z.number().int().min(0),
  intent_key: uuid,
  label: z.string().trim().min(1, "Désignation obligatoire.").max(300, "Désignation : 300 caractères au plus."),
  /** Null: « à préciser ». */
  expected_unit: optionalText(16),
  measurement_basis: optionalText(300),
  qualifiers: z.object({ network: qualifier, material: qualifier, diameter: qualifier, convention: qualifier, scope: qualifier })
    .strict().default({}),
  /** An item of the list whose section the new item joins; absent for « Postes ajoutés ». */
  section_of_item_id: uuid.nullable().optional(),
}).strict();

export const itemListRecordedSchema = z.object({
  revisionId: uuid, revision: z.number().int().positive(), contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  replayed: z.boolean(),
}).strict();

export const itemTemplateKeySchema = z.enum(ITEM_TEMPLATE_KEYS);

export const itemTemplateSaveRequestSchema = z.object({
  /** The draft's token as read (null when there was none). */
  expected_token: uuid.nullable(),
  base_version: z.number().int().min(1),
  definition: itemTemplateDefinitionSchema,
}).strict();

export const itemTemplateDiscardRequestSchema = z.object({ expected_token: uuid }).strict();

export const itemTemplatePublishRequestSchema = z.object({
  expected_token: uuid,
  intent_key: uuid,
}).strict();
