import "server-only";

import type { EstimateReading, EstimateReadingAmounts, EstimateReadingNode } from "@/lib/assistant/estimate-reading";
import type { EstimateBreakdown } from "@/lib/estimate-calculations";
import type { EstimateV3Breakdown } from "@/lib/estimates/engine-v3/types";
import { assertNever, requireEstimateEngineVersion, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { foCostDetail } from "@/lib/estimates/fo-cost-detail";
import type { Database } from "@/types/database";

/** What a reading is built from: the stored rows and, for a draft, what its pinned engine just computed. */
export type EstimateReadingSource = {
  version: Database["public"]["Tables"]["estimate_versions"]["Row"];
  items: Array<Database["public"]["Tables"]["estimate_items"]["Row"]>;
  calculation:
    | { kind: "v3"; breakdown: EstimateV3Breakdown }
    | { kind: "v2"; breakdown: EstimateBreakdown }
    /** The engine refuses the draft as it stands, with the reason it words for the estimator. */
    | { kind: "refused"; message: string }
    /** An issued version: its frozen amounts, never recalculated at today's rates. */
    | { kind: "frozen" };
};

const UNKNOWN_TOTALS: EstimateReading["totals"] = {
  grossHtCents: null, discountCents: null, roundingCents: null, totalHtCents: null, totalTaxCents: null,
  totalTtcCents: null, costHtCents: null,
};

function versionLabel(version: { version_number: number | null; variant_label?: string | null }) {
  return [`V${version.version_number ?? "?"}`, version.variant_label?.trim()].filter(Boolean).join(" ");
}

/**
 * Maps one estimate to what the assistant reads. A line's total is the one the
 * editor and the document show (before the discount is spread); its net is kept
 * apart. A line whose status is not « priced » carries no amount, in a draft as
 * in an issued version, so that a status at zero is never read as a price.
 */
export function buildEstimateReading(source: EstimateReadingSource): EstimateReading {
  const { version, items, calculation } = source;
  const engine = requireEstimateEngineVersion(version);
  const isV3 = usesSaleCoefficients(engine);
  const amounts = new Map<string, EstimateReadingAmounts>();
  const warnings: string[] = [];
  let totals = UNKNOWN_TOTALS;
  let params: EstimateReading["params"] = isV3
    ? { coefficient_vente_fo: version.sale_coefficient_fo, coefficient_vente_mo: version.sale_coefficient_mo }
    : { coefficient_global: version.global_coefficient, multiplicateur_marge: version.margin_multiplier };

  if (calculation.kind === "v3") {
    const { breakdown } = calculation;
    for (const line of breakdown.lines) {
      if (line.pricing_status !== "priced") continue;
      amounts.set(line.id, {
        puHtCents: line.pu_ht_cents, totalHtCents: line.gross_ht_cents, netHtCents: line.line_total_ht_cents,
        costHtCents: line.cost_ht_cents, foHtCents: line.gross_fo_ht_cents, moHtCents: line.gross_mo_ht_cents, hours: line.h_mo,
      });
    }
    // The engine warns for every status other than priced; only « Non chiffrée » is work left to do.
    const notPriced = breakdown.warnings.filter((warning) =>
      warning.code === "ESTIMATE_V3_LINE_NOT_PRICED" && warning.pricing_status === "not_priced").length;
    const missingRates = breakdown.warnings.filter((warning) => warning.code === "ESTIMATE_V3_LABOR_RATE_MISSING").length;
    if (notPriced > 0) warnings.push(`${notPriced} ligne(s) « Non chiffrée » : elles ne comptent pas dans le total.`);
    if (missingRates > 0) warnings.push(`${missingRates} ligne(s) portent des heures sans taux horaire de main-d’œuvre.`);
    totals = {
      grossHtCents: breakdown.totals.gross_ht_cents, discountCents: breakdown.totals.discount_applied_cents,
      roundingCents: breakdown.totals.commercial_rounding_cents, totalHtCents: breakdown.totals.total_ht_cents,
      totalTaxCents: breakdown.totals.total_tax_cents, totalTtcCents: breakdown.totals.total_ttc_cents,
      costHtCents: breakdown.totals.cost_subtotal_cents,
    };
    params = {
      coefficient_vente_fo: breakdown.params.sale_coefficient_fo, coefficient_vente_mo: breakdown.params.sale_coefficient_mo,
      coefficient_de_vente_realise: breakdown.totals.realized_sale_coefficient,
      arrondi_commercial: breakdown.commercial_rounding.mode, autoliquidation_tva: breakdown.params.reverse_charge,
    };
  } else if (calculation.kind === "v2") {
    const { breakdown } = calculation;
    for (const [id, line] of breakdown.lineById) {
      amounts.set(id, {
        puHtCents: line.puNetHtCents, totalHtCents: line.saleNetHtCents, netHtCents: line.saleNetHtCents,
        costHtCents: line.costLineCents, foHtCents: line.foNetCents, moHtCents: line.moNetCents, hours: null,
      });
    }
    totals = {
      grossHtCents: null, discountCents: breakdown.totals.discountCents, roundingCents: null,
      totalHtCents: breakdown.totals.saleTotalCents, totalTaxCents: breakdown.totals.adjustedTaxCents,
      totalTtcCents: breakdown.totals.roundedTtcCents, costHtCents: breakdown.totals.costSubtotalCents,
    };
    params = {
      coefficient_global: breakdown.totals.globalCoefficient, multiplicateur_marge: breakdown.totals.appliedMarginMultiplier,
      mode_remise: breakdown.totals.discountMode,
    };
    if (breakdown.totals.isCapped) warnings.push("Le total dépasse le plafond de stockage : le montant affiché est inférieur au montant réel.");
  } else if (calculation.kind === "refused") {
    // Say why instead of showing the amounts stored for an earlier state of the draft.
    warnings.push(`Le brouillon ne peut pas être calculé en l’état : ${calculation.message}`);
  } else {
    for (const item of items) {
      if (item.item_type !== "line" || item.line_total_ht_cents === null) continue;
      if (item.pricing_status !== "priced") continue;
      const gross = item.snapshot_gross_ht_cents;
      const grossFo = item.snapshot_gross_fo_ht_cents;
      amounts.set(item.id, {
        puHtCents: item.pu_ht_cents, totalHtCents: gross ?? item.line_total_ht_cents, netHtCents: item.line_total_ht_cents,
        costHtCents: null,
        // Engine 3 freezes the shown total and its supply share; the labour share is the rest of that same total.
        foHtCents: isV3 ? grossFo : item.snapshot_fo_ht_cents,
        moHtCents: isV3 ? (gross === null || grossFo === null ? null : gross - grossFo) : item.snapshot_mo_ht_cents,
        hours: item.h_mo === null ? null : String(item.h_mo),
      });
    }
    totals = {
      grossHtCents: version.gross_ht_cents, discountCents: version.discount_applied_cents,
      roundingCents: version.commercial_rounding_cents, totalHtCents: version.total_ht_cents,
      totalTaxCents: version.total_tax_cents, totalTtcCents: version.total_ttc_cents, costHtCents: null,
    };
  }
  switch (engine) {
    case 1:
      warnings.push("Sur ce moteur de calcul, la somme des sections peut différer du total du pied (coefficient global, remise).");
      break;
    case 2:
    case 3:
      break;
    default:
      assertNever(engine);
  }

  const saleCoefficientFo = typeof params.coefficient_vente_fo === "boolean" ? null : params.coefficient_vente_fo;
  const nodes: EstimateReadingNode[] = items.map((item) => ({
    id: item.id, parentId: item.parent_id, type: item.item_type === "section" ? "section" : "line",
    title: item.title, position: item.position,
    line: item.item_type === "section" ? null : {
      quantity: item.quantity,
      // The older engines keep the unit in the description column.
      unit: item.unit_code ?? (isV3 ? null : item.description), description: isV3 ? item.description : null,
      pricingStatus: item.pricing_status,
      source: [item.source_provider, item.source_file_name, item.source_page === null ? null : `page ${item.source_page}`]
        .filter(Boolean).join(", ") || null,
      inputs: {
        unitPriceHtCents: item.unit_price_ht_cents, kFo: item.k_fo, hMoPerUnit: item.h_mo_per_unit,
        // On engine 3 the line's hours are computed, not entered: they are read with the amounts.
        hMo: isV3 ? null : item.h_mo, kMo: item.k_mo, taxRateBp: item.tax_rate_bp,
      },
      amounts: amounts.get(item.id) ?? null,
      // The factor-by-factor sentence is the one engine 3 computes; older engines price supply differently.
      foCostText: isV3 && (item.unit_price_ht_cents ?? 0) > 0 ? foCostDetail(item, { saleCoefficientFo }).text : null,
    },
  }));

  return {
    version: {
      id: version.id, label: versionLabel(version), title: version.title, status: version.status, engine,
      amountsBasis: calculation.kind === "frozen" ? "frozen" : "draft_calculation",
    },
    params, totals, warnings, nodes,
  };
}
