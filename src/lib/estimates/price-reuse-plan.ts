/**
 * Reprise des prix (docs/metier/reprise-des-prix.md) : du choix confirmé aux mises à jour de l'écrivain de lot v3.
 * Seules les saisies de prix de l'article de référence sont copiées ; le métré (quantité), la désignation, l'unité,
 * la TVA et la catégorie de la ligne restent les siens. Les rôles de main-d'œuvre appartiennent au propriétaire de
 * l'affaire : celui de la référence est repris par son nom, ou la reprise est refusée en le nommant.
 */
import { foldText } from "@/lib/text/fold";
import type { Database } from "@/types/database";

type ItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];

export const PRICE_REUSE_COPIED_FIELDS = [
  "line_nature", "pricing_status", "unit_price_ht_cents", "supply_type_id", "k_fo",
  "h_mo_per_unit", "h_mo_atelier_per_unit", "h_mo_chantier_per_unit", "h_mo_majoration",
  "k_mo", "k_mo_atelier", "k_mo_chantier", "labor_role_id", "labor_role_atelier_id", "labor_role_chantier_id",
] as const;

/** Au plus une écriture atomique de l'écrivain v3 (même borne que les copies, v3-section-copy.ts). */
export const PRICE_REUSE_MAX_SELECTIONS = 1000;

type CopiedField = (typeof PRICE_REUSE_COPIED_FIELDS)[number];
export type PriceReuseItem = Pick<ItemRow, "id" | "item_type" | "title" | "unit_code" | "selected_supplier_price_id" | CopiedField>;
export type PriceReuseRole = { id: string; name: string };
export type PriceReuseSelection = { line_id: string; reference_line_id: string };
/** The writer refuses `null` for these inputs: an absent reference value leaves the line's own value. */
const NON_NULL_FIELDS = new Set(["line_nature", "pricing_status", "unit_price_ht_cents", "k_fo", "h_mo_majoration", "k_mo"] as const);
type NonNullField = typeof NON_NULL_FIELDS extends Set<infer T> ? T : never;
export type PriceReuseUpdateData = { [K in NonNullField]?: NonNullable<ItemRow[K]> } &
  { [K in Exclude<CopiedField, NonNullField>]?: ItemRow[K] } & { selected_supplier_price_id?: null };
export type PriceReuseOperation = { op: "update"; id: string; data: PriceReuseUpdateData };

export type PriceReusePlanErrorCode =
  | "PRICE_REUSE_TOO_MANY"
  | "PRICE_REUSE_DUPLICATE_LINE"
  | "PRICE_REUSE_LINE_NOT_FOUND"
  | "PRICE_REUSE_REFERENCE_NOT_FOUND"
  | "PRICE_REUSE_REFERENCE_NOT_PRICED"
  | "PRICE_REUSE_UNIT_MISMATCH"
  | "PRICE_REUSE_LABOR_ROLE_MISSING"
  | "PRICE_REUSE_LABOR_ROLE_AMBIGUOUS";

export class PriceReusePlanError extends Error {
  constructor(readonly code: PriceReusePlanErrorCode, message: string, readonly lineId: string | null = null) {
    super(message);
    this.name = "PriceReusePlanError";
  }
}

const ROLE_FIELDS = ["labor_role_id", "labor_role_atelier_id", "labor_role_chantier_id"] as const;
const roleKey = (name: string) => foldText(name).trim().replace(/\s+/g, " ");
const unitOf = (code: string | null) => code?.trim().toLowerCase() || null;
/** A line « priced » at 0 € without hours is an unfilled line, not a price. */
export const hasPriceReuseInput = (item: Pick<ItemRow, "unit_price_ht_cents" | "h_mo_per_unit" | "h_mo_atelier_per_unit" |
  "h_mo_chantier_per_unit">) => (item.unit_price_ht_cents ?? 0) > 0 ||
  [item.h_mo_per_unit, item.h_mo_atelier_per_unit, item.h_mo_chantier_per_unit].some((hours) => Number(hours ?? 0) > 0);
const sameValue = (left: unknown, right: unknown) =>
  typeof left === "number" || typeof right === "number"
    ? left !== null && right !== null && left !== undefined && right !== undefined && Number(left) === Number(right)
    : (left ?? null) === (right ?? null);

/** Pure: the caller has read both versions and the roles of both project owners. Throws a named refusal. */
export function planPriceReuseOperations(input: {
  targets: readonly PriceReuseItem[];
  references: readonly PriceReuseItem[];
  selections: readonly PriceReuseSelection[];
  targetRoles: readonly PriceReuseRole[];
  referenceRoles: readonly PriceReuseRole[];
}): { operations: PriceReuseOperation[]; unchanged: string[] } {
  if (input.selections.length > PRICE_REUSE_MAX_SELECTIONS) {
    throw new PriceReusePlanError("PRICE_REUSE_TOO_MANY",
      `Une reprise porte sur ${PRICE_REUSE_MAX_SELECTIONS} lignes au plus. Reprenez les prix en plusieurs fois.`);
  }
  const targets = new Map(input.targets.filter((item) => item.item_type === "line").map((item) => [item.id, item]));
  const references = new Map(input.references.map((item) => [item.id, item]));
  const targetRoleIds = new Set(input.targetRoles.map((role) => role.id));
  const targetRolesByName = new Map<string, string[]>();
  for (const role of input.targetRoles) {
    targetRolesByName.set(roleKey(role.name), [...(targetRolesByName.get(roleKey(role.name)) ?? []), role.id]);
  }
  const referenceRoleNames = new Map(input.referenceRoles.map((role) => [role.id, role.name]));
  const seen = new Set<string>();
  const operations: PriceReuseOperation[] = [];
  const unchanged: string[] = [];

  for (const selection of input.selections) {
    if (seen.has(selection.line_id)) {
      throw new PriceReusePlanError("PRICE_REUSE_DUPLICATE_LINE", "Une même ligne ne peut recevoir qu’un seul prix.", selection.line_id);
    }
    seen.add(selection.line_id);
    const target = targets.get(selection.line_id);
    if (!target) {
      throw new PriceReusePlanError("PRICE_REUSE_LINE_NOT_FOUND",
        "Une ligne choisie n’existe plus dans ce devis. Relancez la comparaison.", selection.line_id);
    }
    const reference = references.get(selection.reference_line_id);
    if (!reference) {
      throw new PriceReusePlanError("PRICE_REUSE_REFERENCE_NOT_FOUND",
        `L’article choisi pour « ${target.title} » n’existe plus dans le devis de référence. Relancez la comparaison.`, target.id);
    }
    if (reference.item_type !== "line" || reference.pricing_status !== "priced" || !hasPriceReuseInput(reference)) {
      throw new PriceReusePlanError("PRICE_REUSE_REFERENCE_NOT_PRICED",
        `« ${reference.title} » n’est pas chiffré dans le devis de référence : son prix ne peut pas être repris.`, target.id);
    }
    const targetUnit = unitOf(target.unit_code);
    const referenceUnit = unitOf(reference.unit_code);
    if (!targetUnit || targetUnit !== referenceUnit) {
      throw new PriceReusePlanError("PRICE_REUSE_UNIT_MISMATCH",
        `« ${target.title} » est ${targetUnit ? `en ${targetUnit}` : "sans unité"} et l’article de référence en ` +
          `${referenceUnit ?? "unité inconnue"} : le prix ne peut pas être repris.`, target.id);
    }
    const data = Object.fromEntries(PRICE_REUSE_COPIED_FIELDS.flatMap((field) => {
      const value = reference[field] ?? null;
      return value === null && (NON_NULL_FIELDS as Set<string>).has(field) ? [] : [[field, value]];
    })) as PriceReuseUpdateData;
    data.pricing_status = "priced";
    for (const field of ROLE_FIELDS) {
      const roleId = reference[field];
      if (!roleId || targetRoleIds.has(roleId)) continue;
      const name = referenceRoleNames.get(roleId);
      const sameName = name ? targetRolesByName.get(roleKey(name)) ?? [] : [];
      if (sameName.length > 1) {
        throw new PriceReusePlanError("PRICE_REUSE_LABOR_ROLE_AMBIGUOUS",
          `« ${target.title} » : plusieurs rôles « ${name} » existent dans ce devis. Renommez-les pour lever ` +
            "l’ambiguïté, puis relancez la reprise.", target.id);
      }
      const mapped = sameName[0];
      if (!mapped) {
        throw new PriceReusePlanError("PRICE_REUSE_LABOR_ROLE_MISSING",
          `« ${target.title} » : le rôle de main-d’œuvre « ${name ?? "inconnu"} » de la référence n’existe pas dans ce devis. ` +
            "Créez-le avec son taux horaire, puis relancez la reprise.", target.id);
      }
      data[field] = mapped;
    }
    // The retained supplier offer no longer explains the FO price: detach it with the reuse.
    if (target.selected_supplier_price_id) data.selected_supplier_price_id = null;
    if ((Object.keys(data) as Array<keyof PriceReuseUpdateData>).every((field) => sameValue(target[field], data[field]))) {
      unchanged.push(target.id);
      continue;
    }
    operations.push({ op: "update", id: target.id, data });
  }
  return { operations, unchanged };
}
