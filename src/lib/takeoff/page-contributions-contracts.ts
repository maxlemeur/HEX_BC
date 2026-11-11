import { z } from "zod";

// TI-682 lot D, PR 1: the pages a takeoff (or a launch) reads that another takeoff already brought into the estimate
// version (page-contributions.ts). Read only: it warns, it decides nothing.

const uuid = z.string().uuid();

export const takeoffPageContributionsResponseSchema = z.object({
  version_id: uuid,
  pages: z.array(z.object({
    file_name: z.string().nullable(),
    page: z.number().int().positive().nullable(),
    /** This takeoff's lines on the page; the screens show the page while one of them is included. Empty for a launch. */
    item_ids: z.array(uuid),
    earlier: z.array(z.object({
      job_id: uuid,
      line_count: z.number().int().positive(),
      /**
       * That takeoff's own lines on the page that feed the estimate: a Z1/Z2 partner among them is this page read twice.
       * Empty when the estimate lines name no source line (engines 1 and 2).
       */
      takeoff_item_ids: z.array(uuid),
    }).strict()).min(1),
    /** The estimate lines this takeoff itself still has on the page: an applied takeoff counts the page twice only then. */
    own_line_count: z.number().int().nonnegative(),
  }).strict()),
  /** The other takeoffs named above. */
  jobs: z.array(z.object({
    id: uuid,
    estimate_version_id: uuid,
    created_at: z.string(),
    source_file_name: z.string().nullable(),
  }).strict()),
  /** This takeoff's lines that read no known plan nor page: compared to nothing. */
  unidentified_item_ids: z.array(uuid),
  /** Estimate lines another takeoff brought, on any page. */
  other_takeoff_line_count: z.number().int().nonnegative(),
}).strict();

export type TakeoffPageContributionsResponse = z.infer<typeof takeoffPageContributionsResponseSchema>;

export const takeoffLaunchPageContributionsRequestSchema = z.object({
  estimate_version_id: uuid,
  documents: z.array(z.object({
    plan_file_id: uuid.nullable(),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/i).nullable(),
    logical_document_id: z.string().trim().max(4000).nullable(),
    file_name: z.string().trim().min(1).max(4000),
    pages: z.array(z.number().int().positive()).max(2000),
  }).strict()).min(1).max(500)
    // One launch reads at most 2,000 pages in all (the largest plan set), so the comparison stays bounded.
    .refine((documents) => documents.reduce((total, document) => total + Math.max(1, document.pages.length), 0) <= 2000,
      "Trop de pages pour une vérification."),
}).strict();

export type TakeoffLaunchPageContributionsRequest = z.infer<typeof takeoffLaunchPageContributionsRequestSchema>;
