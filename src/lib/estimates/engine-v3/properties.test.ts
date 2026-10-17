import { describe, expect, it } from "vitest";

import {
  computeEstimateV3Breakdown,
  type EstimateV3Breakdown,
  type EstimateV3Input,
  type EstimateV3ItemInput,
  type EstimateV3PricingStatus,
} from "@/lib/estimates/engine-v3";
import { v3Line, v3Params } from "@/lib/estimates/engine-v3/oracle.fixtures";

// Lot 2, sous-lot 2.4 (docs/testing/estimate-engine-v3-2.4.md, F-V3-03, F-V3-09, F-V3-10).
// Isolation justifiée : 500 devis tirés au hasard (graine fixe) vérifient les invariants du §4
// avec une arithmétique BigInt indépendante du moteur ; une dérive d'un centime sur un
// demi-centime, un PU qui dépend de Q ou une ligne non chiffrée comptée ne se voient sur
// aucun écran tant que le moteur est inerte.

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;
const int = (random: Random, max: number) => Math.floor(random() * (max + 1));
const pick = <T,>(random: Random, values: readonly T[]) => values[int(random, values.length - 1)];
const decimal = (units: number, scale: number) => (units / 10 ** scale).toFixed(scale);
const B = (value: number | bigint) => BigInt(value);
/** ⌈num / den⌋, demi supérieur, pour num ≥ 0 et den > 0. */
const halfUp = (num: bigint, den: bigint) => (B(2) * num + den) / (B(2) * den);

const NON_PRICED: readonly EstimateV3PricingStatus[] = [
  "included",
  "for_memory",
  "not_priced",
  "out_of_scope",
  "not_applicable",
];

type GeneratedLine = { item: EstimateV3ItemInput; quantityThousandths: number };

function generateEstimate(random: Random, index: number): {
  input: EstimateV3Input;
  lines: GeneratedLine[];
} {
  const lineCount = 1 + int(random, 24);
  const lines: GeneratedLine[] = [];
  const items: EstimateV3ItemInput[] = [];
  for (let n = 0; n < lineCount; n += 1) {
    if (random() < 0.1) {
      items.push({ ...v3Line(index * 1000 + 500 + n), item_type: "section", tax_rate_bp: null });
    }
    const quantityThousandths = random() < 0.3 ? int(random, 200) * 1000 : int(random, 200_000);
    const item = v3Line(index * 1000 + n + 1, {
      quantity: decimal(quantityThousandths, 3),
      unit_price_ht_cents: int(random, 20_000),
      k_fo: pick(random, ["1", "1.75", decimal(int(random, 2000), 3)]),
      h_mo_per_unit: random() < 0.2 ? null : decimal(int(random, 30_000), 4),
      h_mo_atelier_per_unit: random() < 0.5 ? null : decimal(int(random, 15_000), 4),
      h_mo_chantier_per_unit: random() < 0.5 ? null : decimal(int(random, 15_000), 4),
      h_mo_majoration: pick(random, ["1", "1.1", "1.25"]),
      k_mo: decimal(500 + int(random, 1500), 3),
      k_mo_atelier: random() < 0.5 ? null : decimal(500 + int(random, 1500), 3),
      k_mo_chantier: random() < 0.5 ? null : decimal(500 + int(random, 1500), 3),
      labor_rate_cents: random() < 0.1 ? null : int(random, 9000),
      labor_rate_atelier_cents: random() < 0.5 ? null : int(random, 9000),
      labor_rate_chantier_cents: random() < 0.5 ? null : int(random, 9000),
      pricing_status: random() < 0.85 ? "priced" : pick(random, NON_PRICED),
      tax_rate_bp: pick(random, [2000, 1000, 550, 210, 0]),
    });
    items.push(item);
    lines.push({ item, quantityThousandths });
  }
  const discountKind = int(random, 2);
  const roundingDown = random() < 0.5;
  const input: EstimateV3Input = {
    params: v3Params({
      sale_coefficient_fo: decimal(1 + int(random, 19_999), 4),
      sale_coefficient_mo: decimal(1 + int(random, 19_999), 4),
      discount_amount_cents: discountKind === 1 ? int(random, 5_000_000) : null,
      discount_bp: discountKind === 2 ? int(random, 10_000) : 0,
      rounding_mode: roundingDown ? "down" : "none",
      rounding_step_cents: roundingDown ? pick(random, [1, 100, 1000, 10_000]) : 1,
      reverse_charge: random() < 0.1,
      labor_split_enabled: random() < 0.25,
    }),
    items,
  };
  return { input, lines };
}

function sumBy<T>(rows: readonly T[], read: (row: T) => number) {
  return rows.reduce((sum, row) => sum + read(row), 0);
}

function invariantViolations(
  input: EstimateV3Input,
  lines: GeneratedLine[],
  result: EstimateV3Breakdown
): string[] {
  const violations: string[] = [];
  const check = (ok: boolean, label: string) => {
    if (!ok) violations.push(label);
  };
  const { totals } = result;
  check(result.lines.length === lines.length, "one output per line, sections excluded");

  result.lines.forEach((line, index) => {
    const generated = lines[index];
    check(line.id === generated.item.id, "input order");
    check(line.line_total_ht_cents >= 0 && line.line_total_ht_cents <= line.gross_ht_cents, "0 <= net <= gross");
    check(line.reduction_cents === line.gross_ht_cents - line.line_total_ht_cents, "reduction = gross - net");
    check(line.gross_fo_ht_cents + line.gross_mo_ht_cents === line.gross_ht_cents, "gross FO + MO");
    check(line.snapshot_fo_ht_cents + line.snapshot_mo_ht_cents === line.line_total_ht_cents, "net FO + MO");
    check(line.line_total_ttc_cents === line.line_total_ht_cents + line.line_tax_cents, "line TTC");
    if (line.gross_mo_atelier_ht_cents + line.gross_mo_chantier_ht_cents > 0) {
      check(
        line.gross_mo_atelier_ht_cents + line.gross_mo_chantier_ht_cents === line.gross_mo_ht_cents,
        "gross atelier + chantier"
      );
      check(
        line.snapshot_mo_atelier_ht_cents + line.snapshot_mo_chantier_ht_cents === line.snapshot_mo_ht_cents,
        "net atelier + chantier"
      );
    }
    if (generated.item.pricing_status === "priced") {
      check(line.pu_ht_cents !== null, "priced line has a PU");
      const expectedGross = halfUp(B(generated.quantityThousandths) * B(line.pu_ht_cents ?? 0), B(1000));
      check(B(line.gross_ht_cents) === expectedGross, "gross = ⌈Q × PU⌋");
    } else {
      check(line.pu_ht_cents === null, "non-priced PU is null");
      check(
        line.gross_ht_cents === 0 && line.cost_ht_cents === 0 && line.line_total_ht_cents === 0 &&
          line.line_tax_cents === 0 && line.line_total_ttc_cents === 0,
        "non-priced line contributes 0"
      );
    }
  });

  const gross = sumBy(result.lines, (line) => line.gross_ht_cents);
  check(totals.gross_ht_cents === gross, "G = Σ B");
  const { discount_amount_cents: amount, discount_bp: bp } = input.params;
  const expectedDiscount =
    amount !== null && amount !== undefined
      ? Math.min(Number(amount), gross)
      : Math.min(Number(halfUp(B(gross) * B(Number(bp)), B(10_000))), gross);
  check(totals.discount_applied_cents === expectedDiscount, "R per intent");
  const step = Number(input.params.rounding_step_cents);
  const expectedRounding = input.params.rounding_mode === "down" ? (gross - expectedDiscount) % step : 0;
  check(totals.commercial_rounding_cents === expectedRounding, "A = (G - R) mod s");
  check(totals.total_ht_cents === gross - expectedDiscount - expectedRounding, "N = G - R - A");
  check(sumBy(result.lines, (line) => line.line_total_ht_cents) === totals.total_ht_cents, "Σ nets = HT");
  check(sumBy(result.lines, (line) => line.cost_ht_cents) === totals.cost_subtotal_cents, "Σ D");

  const rates = [...new Set(lines.filter((l) => l.item.pricing_status === "priced").map((l) => Number(l.item.tax_rate_bp)))].sort(
    (left, right) => left - right
  );
  const expectedBreakdown = rates.map((rate) => {
    const group = result.lines.filter(
      (_line, index) => lines[index].item.pricing_status === "priced" && Number(lines[index].item.tax_rate_bp) === rate
    );
    const base = sumBy(group, (line) => line.line_total_ht_cents);
    const tax = input.params.reverse_charge ? 0 : Number(halfUp(B(base) * B(rate), B(10_000)));
    check(sumBy(group, (line) => line.line_tax_cents) === tax, "Σ line VAT = ⌈base × r⌋");
    return { rate_bp: rate, base_cents: base, tax_cents: tax };
  });
  check(JSON.stringify(totals.tax_breakdown) === JSON.stringify(expectedBreakdown), "tax breakdown by ascending rate");
  check(totals.total_tax_cents === sumBy(expectedBreakdown, (row) => row.tax_cents), "Σ T_r");
  check(totals.total_ttc_cents === totals.total_ht_cents + totals.total_tax_cents, "TTC = HT + VAT");
  check(totals.rounding_adjustment_cents === 0, "no rounding adjustment");
  const cost = totals.cost_subtotal_cents;
  const expectedCoefficient =
    cost === 0
      ? totals.total_ht_cents === 0
        ? "1.000000"
        : null
      : (() => {
          const scaled = halfUp(B(totals.total_ht_cents) * B(1_000_000), B(cost));
          return `${scaled / B(1_000_000)}.${(scaled % B(1_000_000)).toString().padStart(6, "0")}`;
        })();
  check(totals.realized_sale_coefficient === expectedCoefficient, "realized coefficient");
  return violations;
}

function shuffled<T>(values: readonly T[], random: Random): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = int(random, index);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

describe("engine v3 invariants on 500 seeded random estimates (§4)", () => {
  it("holds every invariant, PU independence from Q, permutation stability, monotonicity, non-priced neutrality", () => {
    const random = mulberry32(17102026);
    for (let index = 0; index < 500; index += 1) {
      const { input, lines } = generateEstimate(random, index);
      const result = computeEstimateV3Breakdown(input);
      const violations = invariantViolations(input, lines, result);

      // PU indépendant de Q : changer toutes les quantités ne change aucun PU.
      const requantified = computeEstimateV3Breakdown({
        ...input,
        items: input.items.map((item) =>
          item.item_type === "line" ? { ...item, quantity: decimal(int(random, 200_000), 3) } : item
        ),
      });
      requantified.lines.forEach((line, lineIndex) => {
        if (line.pu_ht_cents !== result.lines[lineIndex].pu_ht_cents) violations.push("PU depends on Q");
      });

      // Permutation de l'entrée : mêmes résultats par identifiant.
      const permuted = computeEstimateV3Breakdown({ ...input, items: shuffled(input.items, random) });
      const byId = new Map(result.lines.map((line) => [line.id, line]));
      permuted.lines.forEach((line) => {
        if (JSON.stringify(line) !== JSON.stringify(byId.get(line.id))) violations.push("permutation");
      });
      if (JSON.stringify(permuted.totals) !== JSON.stringify(result.totals)) violations.push("permutation totals");

      // Monotonie : augmenter un coût d'entrée n'abaisse ni le PU ni le HT.
      const target = int(random, lines.length - 1);
      const bumpedItems = input.items.map((item) =>
        item.id === lines[target].item.id
          ? random() < 0.5
            ? { ...item, unit_price_ht_cents: Number(item.unit_price_ht_cents) + 1 + int(random, 5000) }
            : { ...item, h_mo_per_unit: decimal(Math.round(Number(item.h_mo_per_unit ?? 0) * 10_000) + 1 + int(random, 5000), 4) }
          : item
      );
      const bumped = computeEstimateV3Breakdown({ ...input, items: bumpedItems });
      if ((bumped.lines[target].pu_ht_cents ?? 0) < (result.lines[target].pu_ht_cents ?? 0)) {
        violations.push("PU not monotone");
      }
      if (bumped.totals.total_ht_cents < result.totals.total_ht_cents) violations.push("HT not monotone");

      // Neutralité : retirer les lignes non chiffrées ne change aucun total.
      const pricedOnly = computeEstimateV3Breakdown({
        ...input,
        items: input.items.filter((item) => item.item_type !== "line" || item.pricing_status === "priced"),
      });
      if (JSON.stringify(pricedOnly.totals) !== JSON.stringify(result.totals)) {
        violations.push("non-priced lines change the totals");
      }

      expect({ index, violations }).toEqual({ index, violations: [] });
    }
  });
});
