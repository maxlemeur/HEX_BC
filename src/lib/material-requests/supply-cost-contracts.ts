import { z } from "zod";

/**
 * The supply cost of an affaire (TI-691, lot 2 « l'achat », delivery 4), as public.affaire_supply_cost answers it:
 * per supply type, the supply budget of the version the client accepted, face to what the affaire's orders cost.
 * Amounts are integer cents. budget_cents is null when no version is accepted: there is no budget then.
 */

export const AFFAIRE_SUPPLY_COST_ROW_KINDS = ["supply_type", "unclassified", "shipping_discount"] as const;
export type AffaireSupplyCostRowKind = (typeof AFFAIRE_SUPPLY_COST_ROW_KINDS)[number];

export type AffaireSupplyCostRow = {
  kind: AffaireSupplyCostRowKind;
  supply_type_id: string | null;
  code: string | null;
  name: string | null;
  /** The accepted version's supply cost of these lines; null without accepted version. */
  budget_cents: number | null;
  /** Confirmed and received orders, at their real price. */
  ordered_cents: number;
  /** Drafts and sent orders, at their retained quote's price. */
  pending_cents: number;
};

export type AffaireSupplyCostBudgetVersion = {
  id: string;
  version_number: number;
  variant_label: string | null;
  title: string | null;
  /** How many versions of the affaire are accepted; the highest number makes the budget. */
  accepted_count: number;
};

export type AffaireSupplyCost = {
  budget_version: AffaireSupplyCostBudgetVersion | null;
  rows: AffaireSupplyCostRow[];
  totals: { budget_cents: number | null; ordered_cents: number; pending_cents: number };
  /** Drafts made from an estimate of the affaire before delivery 3a: they carry no affaire and are not counted. */
  not_counted: { estimate_orders: number };
};

const cents = z.number().int();

export const affaireSupplyCostSchema: z.ZodType<AffaireSupplyCost> = z.object({
  budget_version: z.object({
    id: z.string().uuid(),
    version_number: z.number().int().min(1),
    variant_label: z.string().nullable(),
    title: z.string().nullable(),
    accepted_count: z.number().int().min(1),
  }).nullable(),
  rows: z.array(z.object({
    kind: z.enum(AFFAIRE_SUPPLY_COST_ROW_KINDS),
    supply_type_id: z.string().uuid().nullable(),
    code: z.string().nullable(),
    name: z.string().nullable(),
    budget_cents: cents.nullable(),
    ordered_cents: cents,
    pending_cents: cents,
  })),
  totals: z.object({ budget_cents: cents.nullable(), ordered_cents: cents, pending_cents: cents }),
  not_counted: z.object({ estimate_orders: z.number().int().min(0) }),
});
