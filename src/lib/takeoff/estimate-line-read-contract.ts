import { z } from "zod";

export const ESTIMATE_DPGF_COMPARE_SELECT = [
  "id",
  "version_id",
  "position",
  "title",
  "description",
  "quantity",
  "unit_code",
  "selected_supplier_price_id",
  "source_file_name",
  "source_metadata",
  "source_page",
  "source_provider",
  "item_type",
  "category_id",
  "unit_price_ht_cents",
  "updated_at",
].join(", ");

export const takeoffDpgfCompareEstimateItemRowSchema = z.object({
  id: z.string().uuid(),
  version_id: z.string().uuid(),
  position: z.number().int().nonnegative(),
  title: z.string(),
  description: z.string().nullable(),
  quantity: z.number().nonnegative().nullable(),
  /** TI-696: the line's own unit, which the application rounds a length with (finalize_takeoff_lengths). */
  unit_code: z.string().nullable().optional(),
  selected_supplier_price_id: z.string().uuid().nullable().optional(),
  source_file_name: z.string().nullable(),
  source_metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  source_page: z.number().int().nullable(),
  source_provider: z.string().nullable().optional(),
  item_type: z.enum(["section", "line"]),
  unit: z.string().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  unit_price_ht_cents: z.number().int().nonnegative().nullable().optional(),
  updated_at: z.string(),
});
