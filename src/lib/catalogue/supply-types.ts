import { z } from "zod";

import { foldText } from "@/lib/text/fold";

/**
 * Supply types ("types de fourniture") classify estimate lines and, since TI-690, catalogue articles.
 * A tenant created after the historical seed has none, and validating an article needs one: this is the
 * only place the application creates them.
 */

/**
 * Mirrors the code the database derives (public.create_supply_type): only used here to refuse, before the
 * request, a name with no letter or digit. Duplicates are decided by the database, under a lock.
 */
export function supplyTypeCodeFromName(name: string): string | null {
  const code = foldText(name)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return code.length > 0 ? code : null;
}

export const createSupplyTypeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Le nom du type de fourniture est requis.")
    .max(80, "Le nom du type de fourniture ne peut pas dépasser 80 caractères.")
    .refine((name) => supplyTypeCodeFromName(name) !== null, {
      message: "Le nom du type de fourniture doit contenir une lettre ou un chiffre.",
    }),
});

export type CreateSupplyTypeInput = z.infer<typeof createSupplyTypeSchema>;

export type SupplyTypeRecord = { id: string; code: string; name: string };

/**
 * A supply type as the list answers it (TI-691): with the supplier proposed for the material request lines whose
 * article is of this type, unless the article names its own exception.
 */
export type SupplyTypeListItem = SupplyTypeRecord & {
  preferred_supplier_id: string | null;
  preferred_supplier_name: string | null;
};
