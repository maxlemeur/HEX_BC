import { z } from "zod";

import { foldText } from "@/lib/text/fold";

/**
 * Supply types ("types de fourniture") classify estimate lines and, since TI-690, catalogue articles.
 * A tenant created after the historical seed has none, and validating an article needs one: this is the
 * only place the application creates them.
 */

/** The code is the name, folded: the unique key (tenant, code) then refuses a near-duplicate name. */
export function supplyTypeCodeFromName(name: string): string | null {
  const code = foldText(name)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return code.length > 0 ? code : null;
}

/**
 * Two names are the same supply type when they differ only by case, accents, punctuation or a final "s".
 * The estimate engine matches an article's type to a supply type the same way and gives up when two match
 * (private.derive_estimate_item_fo_provision), so "Tube" beside "Tubes" would silently lose the line's type.
 * Historical types carry a code unrelated to their name (cat_<md5>): the name is compared, not the code.
 */
export function supplyTypeNameKey(name: string): string | null {
  const code = supplyTypeCodeFromName(name);
  if (!code) return null;
  return code.length > 1 && code.endsWith("s") ? code.slice(0, -1) : code;
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
