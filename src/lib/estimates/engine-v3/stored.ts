/**
 * Lot 2, sous-lot 2.4 - relecture pure d'une v3 figée (conception §8.1, D7, D8, §6.5).
 *
 * Lit les colonnes figées sans rien recalculer (un document émis ne dépend pas d'un nouveau
 * calcul) et refuse toute incohérence par `ESTIMATE_V3_STORED_INCOHERENT` : Σ nets = HT,
 * HT = brut − remise − arrondi, TTC = HT + TVA, ajustement nul, récapitulatif par taux conforme
 * aux lignes, TVA par taux = ⌈base × taux⌋ sauf autoliquidation, lignes non chiffrées à 0,
 * coefficient réalisé = ⌈HT / déboursé⌋ à 6 décimales (§4.11).
 * L'autoliquidation se lit sur le rôle d'entreprise figé de la version (`contractor_role` =
 * `subcontractor`, convention v2), jamais sur des montants de TVA nuls. Les colonnes `snapshot_gross_*` et le contexte v3
 * arrivent avec M4 (2.5) ; ce lecteur en fixe dès 2.4 le contrat.
 */
import { divideHalfUp, formatScaled, pow10, ZERO } from "@/lib/estimates/engine-v3/decimal";
import { storedIncoherent } from "@/lib/estimates/engine-v3/errors";
import type { EstimateV3TaxBreakdownRow } from "@/lib/estimates/engine-v3/types";

export type StoredEstimateV3Version = {
  /** `principal` ou `subcontractor` (CHECK de la colonne) ; `subcontractor` = autoliquidation. */
  contractor_role: string | null;
  gross_ht_cents: number | null;
  discount_applied_cents: number | null;
  commercial_rounding_cents: number | null;
  total_ht_cents: number | null;
  total_tax_cents: number | null;
  total_ttc_cents: number | null;
  rounding_adjustment_cents: number | null;
  calc_snapshot_context: unknown;
};

export type StoredEstimateV3Item = {
  id: string;
  item_type: "section" | "line";
  pricing_status: string | null;
  tax_rate_bp: number | null;
  pu_ht_cents: number | null;
  snapshot_gross_ht_cents: number | null;
  snapshot_gross_fo_ht_cents: number | null;
  line_total_ht_cents: number | null;
  line_tax_cents: number | null;
  line_total_ttc_cents: number | null;
  snapshot_fo_ht_cents: number | null;
  snapshot_mo_ht_cents: number | null;
  snapshot_mo_atelier_ht_cents: number | null;
  snapshot_mo_chantier_ht_cents: number | null;
};

export type StoredEstimateV3Line = {
  id: string;
  pricing_status: string;
  tax_rate_bp: number;
  pu_ht_cents: number | null;
  gross_ht_cents: number;
  gross_fo_ht_cents: number;
  gross_mo_ht_cents: number;
  net_ht_cents: number;
  net_fo_ht_cents: number;
  net_mo_ht_cents: number;
  net_mo_atelier_ht_cents: number;
  net_mo_chantier_ht_cents: number;
  tax_cents: number;
  ttc_cents: number;
};

export type StoredEstimateV3View = {
  totals: {
    gross_ht_cents: number;
    discount_applied_cents: number;
    commercial_rounding_cents: number;
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
    rounding_adjustment_cents: 0;
    cost_subtotal_cents: number;
    realized_sale_coefficient: number | null;
  };
  tax_breakdown: EstimateV3TaxBreakdownRow[];
  lines: StoredEstimateV3Line[];
};

function cents(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2147483647) {
    throw storedIncoherent(field, "montant entier positif attendu");
  }
  return value;
}

const REALIZED_COEFFICIENT_SCALE = 6;

function ensure(condition: boolean, field: string, reason: string) {
  if (!condition) throw storedIncoherent(field, reason);
}

function readContext(raw: unknown) {
  const context = (typeof raw === "object" && raw !== null ? raw : null) as Record<string, unknown> | null;
  ensure(context !== null && context.engine === 3, "calc_snapshot_context", "contexte v3 absent");
  const rows = context?.tax_breakdown;
  ensure(Array.isArray(rows), "calc_snapshot_context.tax_breakdown", "récapitulatif absent");
  const taxBreakdown = (rows as unknown[]).map((row, index) => {
    const value = (row ?? {}) as Record<string, unknown>;
    const path = `calc_snapshot_context.tax_breakdown[${index}]`;
    return {
      rate_bp: cents(value.rate_bp, `${path}.rate_bp`),
      base_cents: cents(value.base_cents, `${path}.base_cents`),
      tax_cents: cents(value.tax_cents, `${path}.tax_cents`),
    };
  });
  const coefficient = context?.realized_sale_coefficient;
  ensure(
    coefficient === null || (typeof coefficient === "number" && Number.isFinite(coefficient)),
    "calc_snapshot_context.realized_sale_coefficient",
    "nombre ou null attendu"
  );
  return {
    taxBreakdown,
    costSubtotal: cents(context?.cost_subtotal_cents, "calc_snapshot_context.cost_subtotal_cents"),
    realizedSaleCoefficient: coefficient as number | null,
  };
}

function readLine(item: StoredEstimateV3Item): StoredEstimateV3Line {
  const path = `items[${item.id}]`;
  const status = item.pricing_status ?? "";
  const rate = cents(item.tax_rate_bp, `${path}.tax_rate_bp`);
  const gross = cents(item.snapshot_gross_ht_cents, `${path}.snapshot_gross_ht_cents`);
  const grossFo = cents(item.snapshot_gross_fo_ht_cents, `${path}.snapshot_gross_fo_ht_cents`);
  const net = cents(item.line_total_ht_cents, `${path}.line_total_ht_cents`);
  const netFo = cents(item.snapshot_fo_ht_cents, `${path}.snapshot_fo_ht_cents`);
  const netMo = cents(item.snapshot_mo_ht_cents, `${path}.snapshot_mo_ht_cents`);
  const netAtelier = cents(item.snapshot_mo_atelier_ht_cents, `${path}.snapshot_mo_atelier_ht_cents`);
  const netChantier = cents(item.snapshot_mo_chantier_ht_cents, `${path}.snapshot_mo_chantier_ht_cents`);
  const tax = cents(item.line_tax_cents, `${path}.line_tax_cents`);
  const ttc = cents(item.line_total_ttc_cents, `${path}.line_total_ttc_cents`);
  ensure(grossFo <= gross, path, "FO brut supérieur au brut");
  ensure(net <= gross, path, "net supérieur au brut");
  ensure(netFo + netMo === net, path, "FO net + MO net ≠ net");
  ensure(netAtelier + netChantier === netMo, path, "atelier + chantier ≠ MO net");
  ensure(ttc === net + tax, path, "TTC de ligne ≠ net + TVA");
  if (status === "priced") {
    ensure(item.pu_ht_cents !== null, path, "PU publié absent");
  } else {
    ensure(item.pu_ht_cents === null && gross === 0 && tax === 0, path, "ligne non chiffrée avec un montant");
  }
  return {
    id: item.id,
    pricing_status: status,
    tax_rate_bp: rate,
    pu_ht_cents: item.pu_ht_cents === null ? null : cents(item.pu_ht_cents, `${path}.pu_ht_cents`),
    gross_ht_cents: gross,
    gross_fo_ht_cents: grossFo,
    gross_mo_ht_cents: gross - grossFo,
    net_ht_cents: net,
    net_fo_ht_cents: netFo,
    net_mo_ht_cents: netMo,
    net_mo_atelier_ht_cents: netAtelier,
    net_mo_chantier_ht_cents: netChantier,
    tax_cents: tax,
    ttc_cents: ttc,
  };
}

export function readStoredEstimateV3(stored: {
  version: StoredEstimateV3Version;
  items: readonly StoredEstimateV3Item[];
}): StoredEstimateV3View {
  const { version } = stored;
  const gross = cents(version.gross_ht_cents, "gross_ht_cents");
  const discount = cents(version.discount_applied_cents, "discount_applied_cents");
  const rounding = cents(version.commercial_rounding_cents, "commercial_rounding_cents");
  const net = cents(version.total_ht_cents, "total_ht_cents");
  const tax = cents(version.total_tax_cents, "total_tax_cents");
  const ttc = cents(version.total_ttc_cents, "total_ttc_cents");
  ensure(version.rounding_adjustment_cents === 0, "rounding_adjustment_cents", "ajustement non nul en v3");
  ensure(
    version.contractor_role === "principal" || version.contractor_role === "subcontractor",
    "contractor_role",
    "rôle d'entreprise « principal » ou « subcontractor » attendu"
  );
  const reverseCharge = version.contractor_role === "subcontractor";
  ensure(net === gross - discount - rounding, "total_ht_cents", "HT ≠ brut − remise − arrondi");
  ensure(ttc === net + tax, "total_ttc_cents", "TTC ≠ HT + TVA");
  const context = readContext(version.calc_snapshot_context);
  // Même règle que le moteur (§4.11) : 1 si HT = déboursé = 0, indéterminé si seul le déboursé est nul.
  const cost = BigInt(context.costSubtotal);
  const expectedCoefficient =
    cost === ZERO
      ? net === 0
        ? 1
        : null
      : Number(formatScaled(divideHalfUp(BigInt(net) * pow10(REALIZED_COEFFICIENT_SCALE), cost), REALIZED_COEFFICIENT_SCALE));
  ensure(
    context.realizedSaleCoefficient === expectedCoefficient,
    "calc_snapshot_context.realized_sale_coefficient",
    "coefficient réalisé ≠ ⌈HT / déboursé⌋ à 6 décimales"
  );

  const lines =stored.items.filter((item) => item.item_type === "line").map(readLine);
  const sumOf = (read: (line: StoredEstimateV3Line) => number, rows = lines) =>
    rows.reduce((total, line) => total + read(line), 0);
  ensure(sumOf((line) => line.gross_ht_cents) === gross, "gross_ht_cents", "Σ bruts ≠ brut");
  ensure(sumOf((line) => line.net_ht_cents) === net, "total_ht_cents", "Σ nets ≠ HT");
  ensure(sumOf((line) => line.tax_cents) === tax, "total_tax_cents", "Σ TVA de ligne ≠ TVA");

  const priced = lines.filter((line) => line.pricing_status === "priced");
  const rates = [...new Set(priced.map((line) => line.tax_rate_bp))].sort((left, right) => left - right);
  ensure(
    rates.length === context.taxBreakdown.length &&
      rates.every((rate, index) => context.taxBreakdown[index].rate_bp === rate),
    "calc_snapshot_context.tax_breakdown",
    "taux du récapitulatif ≠ taux des lignes"
  );
  context.taxBreakdown.forEach((row, index) => {
    const group = priced.filter((line) => line.tax_rate_bp === row.rate_bp);
    const field = `calc_snapshot_context.tax_breakdown[${index}]`;
    ensure(sumOf((line) => line.net_ht_cents, group) === row.base_cents, field, "base ≠ Σ nets du taux");
    ensure(sumOf((line) => line.tax_cents, group) === row.tax_cents, field, "TVA ≠ Σ TVA de ligne du taux");
    const expected = reverseCharge
      ? 0
      : Number(divideHalfUp(BigInt(row.base_cents) * BigInt(row.rate_bp), BigInt(10000)));
    ensure(row.tax_cents === expected, field, "TVA ≠ ⌈base × taux⌋");
  });

  return {
    totals: {
      gross_ht_cents: gross,
      discount_applied_cents: discount,
      commercial_rounding_cents: rounding,
      total_ht_cents: net,
      total_tax_cents: tax,
      total_ttc_cents: ttc,
      rounding_adjustment_cents: 0,
      cost_subtotal_cents: context.costSubtotal,
      realized_sale_coefficient: context.realizedSaleCoefficient,
    },
    tax_breakdown: context.taxBreakdown,
    lines,
  };
}
