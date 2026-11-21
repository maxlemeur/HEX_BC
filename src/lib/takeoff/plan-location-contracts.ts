import { z } from "zod";

import { PLAN_LOCATION_RULE_VERSION } from "@/lib/takeoff/plan-location";

/**
 * Contracts of the location of a plan revision (lot 3, « Localisation canonique »). What later consumers read:
 * `revision` names the revision (its source and the SHA-256 of its bytes) and `annotation.revision` the generation of
 * the operator's correction; a write names the generation it saw (`expected_revision`, 0 before the first one).
 */

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const page = z.number().int().positive();

export const planLocationCandidateSchema = z.object({
  value: z.string().min(1),
  source: z.enum(["title_block", "file_name"]),
  pages: z.array(page),
}).strict();

export const planLocationReadingSchema = z.object({
  rule_version: z.literal(PLAN_LOCATION_RULE_VERSION),
  pages_total: page.nullable(),
  pages_read: z.array(page),
  unreadable_pages: z.array(page),
  title_block_read: z.boolean(),
  building: z.array(planLocationCandidateSchema),
  level: z.array(planLocationCandidateSchema),
}).strict();

export const planLocationFieldViewSchema = z.object({
  value: z.string().nullable(),
  state: z.enum(["proposed", "confirmed", "corrected", "unknown", "multiple"]),
  origin: z.enum(["title_block", "file_name", "previous_revision", "operator"]).nullable(),
  pages: z.array(page),
  candidates: z.array(planLocationCandidateSchema),
  title_block_read: z.boolean(),
}).strict();

export const planLocationViewSchema = z.object({
  building: planLocationFieldViewSchema,
  level: planLocationFieldViewSchema,
}).strict();

export const planRevisionIdentitySchema = z.object({
  source_kind: z.enum(["intake_document", "plan_file"]),
  source_id: uuid,
  content_hash: sha256,
}).strict();

const fieldAuthorSchema = z.object({ by: uuid, by_name: z.string().nullable(), at: z.string() }).strict();

export const planLocationAnnotationSchema = z.object({
  id: uuid,
  revision: z.number().int().positive(),
  /** Null: no correction of this field; the reading of these bytes applies. */
  building: z.string().nullable(),
  level: z.string().nullable(),
  /** Who set each corrected field's current value, and when (from the history of changes). */
  fields: z.object({ building: fieldAuthorSchema.nullable(), level: fieldAuthorSchema.nullable() }).strict(),
  carried_from_id: uuid.nullable(),
  document_name: z.string(),
  updated_by: uuid,
  updated_by_name: z.string().nullable(),
  updated_at: z.string(),
  created_at: z.string(),
}).strict();

/** The correction of an earlier revision of the same plan, offered for these bytes: never applied without a save. */
export const planLocationCarryOverSchema = planLocationAnnotationSchema.extend({
  content_hash: sha256,
  /** The same dossier piece (or plan file) with other bytes; otherwise a piece the preparation says this one replaces. */
  same_source: z.boolean(),
}).strict();

export const takeoffPlanFileLocationSchema = z.object({
  project_id: uuid,
  plan_set_id: uuid,
  plan_file_id: uuid,
  document_name: z.string(),
  revision: planRevisionIdentitySchema,
  /** A correction is written through the current copy of its piece only. */
  current_copy: z.boolean(),
  reading: planLocationReadingSchema.nullable(),
  /** The PDF could not be read: only its name was. */
  reading_issue: z.enum(["unreadable"]).nullable(),
  annotation: planLocationAnnotationSchema.nullable(),
  carry_over: planLocationCarryOverSchema.nullable(),
  location: planLocationViewSchema,
  /** Values of the brief and of the preparation scope, offered as typing aids: never a proposal. */
  suggestions: z.object({ building: z.array(z.string()), level: z.array(z.string()) }).strict(),
  can_edit: z.boolean(),
}).strict();
export type TakeoffPlanFileLocation = z.infer<typeof takeoffPlanFileLocationSchema>;

export const takeoffPlanLocationSaveSchema = z.object({
  content_hash: sha256,
  expected_revision: z.number().int().nonnegative(),
  building: z.string().max(200).nullable(),
  level: z.string().max(200).nullable(),
  carried_from_id: uuid.nullable().default(null),
}).strict();
export type TakeoffPlanLocationSave = z.input<typeof takeoffPlanLocationSaveSchema>;

export const takeoffJobPlanLocationSchema = z.object({
  plan_file_id: uuid,
  plan_set_id: uuid.nullable(),
  document_name: z.string(),
  /** The original pages the analysis read (empty: all). */
  pages: z.array(page),
  /** The revision the analysis read; null when its plan file no longer exists in the affaire. */
  revision: planRevisionIdentitySchema.nullable(),
  /**
   * current: the plan's bytes are still those the analysis read; changed: the plan has other bytes now;
   * unavailable: the plan file or its bytes can no longer be read.
   */
  status: z.enum(["current", "changed", "unavailable"]),
  reading: planLocationReadingSchema.nullable(),
  /**
   * Why the title block of the bytes the analysis read was not read here: they are no longer the plan's (not_current),
   * the reading limit of one review was reached (budget), or the PDF could not be read (unreadable).
   */
  reading_issue: z.enum(["not_current", "budget", "unreadable"]).nullable(),
  annotation: planLocationAnnotationSchema.nullable(),
  carry_over: planLocationCarryOverSchema.nullable(),
  location: planLocationViewSchema,
}).strict();

export const takeoffJobPlanLocationsSchema = z.object({
  job_id: uuid,
  project_id: uuid,
  plans: z.array(takeoffJobPlanLocationSchema),
  /** A historical analysis without a confirmed preparation names no plan revision. */
  without_preparation: z.boolean(),
  can_edit: z.boolean(),
}).strict();
export type TakeoffJobPlanLocations = z.infer<typeof takeoffJobPlanLocationsSchema>;
export type TakeoffJobPlanLocation = z.infer<typeof takeoffJobPlanLocationSchema>;
