import { z } from "zod";

/**
 * The supply cost of an affaire (TI-691, lot 2 « l'achat », delivery 4), as public.affaire_supply_cost answers it:
 * per supply type, the supply budget of the version the client accepted, face to what the affaire's orders cost.
 * Amounts are integer cents. budget_cents is null when no version is accepted: there is no budget then.
 */

const ROW_KINDS = ["supply_type", "unclassified", "shipping_discount"] as const;

/** The three amounts of a row, and of the totals. */
export type AffaireSupplyCostAmounts = {
  /** The accepted version's supply cost of these lines; null without accepted version. */
  budget_cents: number | null;
  /** Confirmed and received orders, at their real price. */
  ordered_cents: number;
  /** Drafts and sent orders, at their retained quote's price. */
  pending_cents: number;
};

export type AffaireSupplyCostRow = AffaireSupplyCostAmounts & {
  kind: (typeof ROW_KINDS)[number];
  supply_type_id: string | null;
  code: string | null;
  name: string | null;
};

export type AffaireSupplyCost = {
  budget_version: {
    id: string;
    version_number: number;
    variant_label: string | null;
    title: string | null;
    /** How many versions of the affaire are accepted; the highest number makes the budget. */
    accepted_count: number;
  } | null;
  rows: AffaireSupplyCostRow[];
  totals: AffaireSupplyCostAmounts;
  /** Orders made from an estimate of the affaire, canceled ones excepted: they carry no affaire and are not counted. */
  not_counted: { estimate_orders: number };
};

/** Integer cents, refused beyond the safe integers rather than rounded silently. */
const cents = z.number().int().refine(Number.isSafeInteger, "montant hors des entiers sûrs");
const amounts = { budget_cents: cents.nullable(), ordered_cents: cents, pending_cents: cents };

export const affaireSupplyCostSchema: z.ZodType<AffaireSupplyCost> = z.object({
  budget_version: z.object({
    id: z.string().uuid(),
    version_number: z.number().int().min(1),
    variant_label: z.string().nullable(),
    title: z.string().nullable(),
    accepted_count: z.number().int().min(1),
  }).nullable(),
  rows: z.array(z.object({
    kind: z.enum(ROW_KINDS),
    supply_type_id: z.string().uuid().nullable(),
    code: z.string().nullable(),
    name: z.string().nullable(),
    ...amounts,
  })),
  totals: z.object(amounts),
  not_counted: z.object({ estimate_orders: z.number().int().min(0) }),
});
