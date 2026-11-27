import { z } from "zod";

import { foldText } from "@/lib/text/fold";

/**
 * Supply types classify estimate lines and, since TI-690, catalogue articles, whose « Famille » they are.
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

const UNACCENT_LETTERS: Record<string, string> = {
  œ: "oe", Œ: "OE", æ: "ae", Æ: "AE", ß: "ss", ø: "o", Ø: "O", ł: "l", Ł: "L", đ: "d", Đ: "D",
};

/**
 * The key two names of the same supply type share: folded, punctuation as one underscore, a final « s » dropped
 * (« Tubes » is « Tube »). Mirrors private.supply_type_name_key, which keeps two such names from coexisting; an
 * import matches the family it reads with it.
 */
export function supplyTypeNameKey(name: string): string {
  // PostgreSQL's unaccent spells out the letters Unicode does not decompose: « Œillets » is « Oeillets ».
  const key = supplyTypeCodeFromName(name.replace(/[œŒæÆßøØłŁđĐ]/g, (letter) => UNACCENT_LETTERS[letter])) ?? "";
  return key.length > 1 && key.endsWith("s") ? key.slice(0, -1) : key;
}

export type SupplyTypeNameMatch =
  | { status: "found"; id: string; name: string }
  | { status: "unknown" }
  | { status: "ambiguous" };

/** Finds the supply type a typed family names. Historical types may share a key: such a name is ambiguous. */
export function matchSupplyTypeByName(
  supplyTypes: ReadonlyArray<{ id: string; name: string }>,
  name: string,
): SupplyTypeNameMatch {
  const key = supplyTypeNameKey(name);
  if (!key) return { status: "unknown" };
  const matches = supplyTypes.filter((supplyType) => supplyTypeNameKey(supplyType.name) === key);
  if (matches.length === 0) return { status: "unknown" };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "found", id: matches[0].id, name: matches[0].name };
}

export const createSupplyTypeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Le nom de la famille est requis.")
    .max(80, "Le nom de la famille ne peut pas dépasser 80 caractères.")
    .refine((name) => supplyTypeCodeFromName(name) !== null, {
      message: "Le nom de la famille doit contenir une lettre ou un chiffre.",
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
