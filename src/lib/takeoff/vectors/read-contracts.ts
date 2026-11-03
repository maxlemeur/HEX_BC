import { z } from "zod";

import { VectorItemGeometrySchema, VectorPageRecordSchema } from "@/lib/takeoff/vectors/persistence";

// Response of GET /api/takeoff/jobs/{jobId}/vector-pages (TI-662): the pages a
// job read from its vectors and the geometry of their measured items, for the
// review viewer. Shared by the route, its client and the OpenAPI registry.

/** Pages and geometries a job shows at most, and centreline segments (or room polygon edges) across them (a response of a few MB). */
export const TAKEOFF_VECTOR_READ_LIMITS = { pages: 200, geometries: 5000, segments: 200_000 } as const;

export const takeoffVectorReadingResponseSchema = z.object({
  job_id: z.string().uuid(),
  /**
   * Signed URL (10 min) of the PDF the job was created with, for its pages read
   * without a plan file (plan_file_id null). Null for a plan-set job, whose
   * pages go through their plan files, or when the file is unavailable.
   */
  source_download_url: z.string().url().nullable(),
  pages: z.array(z.object({
    id: z.string().uuid(),
    plan_file_id: z.string().uuid().nullable(),
    source_file_name: z.string().nullable(),
    source_page: z.number().int().positive(),
    reading: VectorPageRecordSchema,
    items: z.array(z.object({ takeoff_item_id: z.string().uuid(), geometry: VectorItemGeometrySchema }).strict()),
  }).strict()).max(TAKEOFF_VECTOR_READ_LIMITS.pages),
}).strict();

export type TakeoffVectorReadingResponse = z.infer<typeof takeoffVectorReadingResponseSchema>;
