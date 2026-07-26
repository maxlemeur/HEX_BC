import {
  computeEstimateLineValues,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import { resolveLaborRoleHourlyRate, type LaborRole } from "@/lib/estimates/editor-items";

/**
 * Marge d'une ligne de devis, telle qu'un chiffreur la lit.
 *
 * EST-E15 increment 1. Le deboursé sec EXISTE deja : `computeEstimateLineValues`
 * le calcule a chaque mutation (`costLineCents` = fournitures x k_fo + MO x k_mo)
 * puis le JETTE — seuls le prix de vente et le total sont conserves. Le chiffreur
 * ne voit donc jamais sa marge ligne a ligne, ce qui est le fondement du metier :
 * sans elle, il ne peut pas arbitrer.
 *
 * Aucun changement de modele de prix ici : on rend visible ce qui est deja
 * calcule. La decomposition DS/FC/FG/B&A complete est l'increment 2
 * (docs/user_story/EST-E15-DECISIONS-structure-prix.md).
 */
export type EstimateLineMargin = {
  /** Deboursé sec : fournitures (x k_fo) + main-d'oeuvre (x k_mo). */
  costCents: number;
  /**
   * Vente HT de la ligne, telle que persistee — donc BRUTE de la remise et du
   * coefficient global, qui sont des grandeurs de VERSION appliquees au pied.
   * La marge nette par ligne arrivera avec `breakdown.lineById[].saleNetHtCents`
   * (T6 phase D), qui redescend ces grandeurs jusqu'a la ligne.
   */
  saleCents: number;
  /** Vente - deboursé sec. Peut etre negatif : une ligne vendue a perte. */
  marginCents: number;
  /**
   * Taux de MARQUE : marge / vente. `null` quand la vente est nulle.
   *
   * Volontairement PAS le taux de marge (marge / cout). Sur un coefficient de
   * vente 1,35, le taux de marge vaut 35 % et le taux de marque 25,9 % : les
   * afficher l'un pour l'autre a cote d'un total de vente est l'erreur la plus
   * couteuse du metier. C'est la marque que lit la direction.
   */
  markupRatio: number | null;
};

/**
 * Calcule la marge d'une ligne a partir des roles de main-d'oeuvre disponibles.
 *
 * Les taux horaires sont resolus par la cascade canonique (taux dedie du role
 * pour la portee demandee, sinon taux par defaut) — la meme que le moteur.
 */
export function computeEstimateLineMargin(input: {
  item: EstimateItemRecord & { line_total_ht_cents?: number | null };
  laborRoles: LaborRole[];
  isLaborSplitEnabled: boolean;
  taxRateBp?: number;
}): EstimateLineMargin {
  const roleById = new Map(input.laborRoles.map((role) => [role.id, role]));
  const rateFor = (
    roleId: string | null | undefined,
    scope: "default" | "atelier" | "chantier"
  ) => {
    if (!roleId) return 0;
    const role = roleById.get(roleId);
    return role ? resolveLaborRoleHourlyRate(role, scope) : 0;
  };

  const { costLineCents } = computeEstimateLineValues(
    {
      ...input.item,
      labor_role_hourly_rate_cents: rateFor(input.item.labor_role_id, "default"),
      labor_role_atelier_hourly_rate_cents: rateFor(
        input.item.labor_role_atelier_id,
        "atelier"
      ),
      labor_role_chantier_hourly_rate_cents: rateFor(
        input.item.labor_role_chantier_id,
        "chantier"
      ),
    },
    {
      // La marge ne depend pas du multiplicateur : on veut le cout brut.
      marginMultiplier: 1,
      taxRateBp: input.taxRateBp ?? 0,
      isLaborSplitEnabled: input.isLaborSplitEnabled,
    }
  );

  const saleCents = Math.max(input.item.line_total_ht_cents ?? 0, 0);
  const marginCents = saleCents - costLineCents;

  return {
    costCents: costLineCents,
    saleCents,
    marginCents,
    markupRatio: saleCents > 0 ? marginCents / saleCents : null,
  };
}

/** Formate un taux de marque pour l'affichage en grille (une decimale). */
export function formatMarkupRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "-";
  return `${(ratio * 100).toFixed(1).replace(".", ",")} %`;
}
