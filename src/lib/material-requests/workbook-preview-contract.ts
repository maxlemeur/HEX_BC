import { z } from "zod";

import { MATERIAL_REQUEST_MAX_LINES, materialRequestLineInputSchema } from "./contracts";

export const materialRequestWorkbookPreviewSchema = z.object({
  sheet_name: z.string(),
  sheet_names: z.array(z.string()),
  rows: z.array(z.object({
    row_number: z.number().int().positive(),
    line: materialRequestLineInputSchema,
  })).max(MATERIAL_REQUEST_MAX_LINES),
  issues: z.array(z.object({ row_number: z.number().int().positive(), message: z.string() })),
  omitted_rows: z.number().int().nonnegative(),
});

export type MaterialRequestWorkbookPreview = z.output<typeof materialRequestWorkbookPreviewSchema>;
