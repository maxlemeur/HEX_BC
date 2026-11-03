import { z } from "zod";

import { VectorItemGeometrySchema, VectorPageRecordSchema } from "@/lib/takeoff/vectors/persistence";

// Response of GET /api/takeoff/jobs/{jobId}/vector-pages (TI-662): the pages a
// job read from its vectors and the geometry of their measured items, for the
// review viewer. Shared by the route, its client and the OpenAPI registry.

export const TAKEOFF_VECTOR_READ_LIMITS = { pages: 200, geometries: 5000 } as const;

export const takeoffVectorReadingResponseSchema = z.object({
  job_id: z.string().uuid(),
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
