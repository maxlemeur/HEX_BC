// Lot 2, sub-lot 2.4: acceptance of the pure engine 3 on complete OPTIMA lots (design §5.4, §5.5,
// §5.6). Local script, never in CI: `npm run engine:v3:optima-lot-check -- <workbook.xlsx> [...]`.
// Ported from docs/audit-independant-2026-10-14/reproductions/lot2/optima-v3-check2.cjs and
// optima-v3-offer.cjs, with the v3 engine (computeEstimateV3Breakdown) instead of floats.
//
// - The workbook is recognised by the 2.3 OPTIMA profile (detectImportProfile): columns are read
//   by their declared header, the parameters on the parameter row (Coeff FO, Coeff MO, additive
//   Majoration MO, Taux horaire), never by position.
// - Priced line (as the reproduction): "Prix Unitaire" > 0 and Qté > 0, outside "Sous-total" /
//   "Total" rows. Status line: its "Uté" cell normalises to a pricing status (D9,
//   normalizeMeasurementUnit); it enters the v3 estimate as a non-priced line.
// - Engine inputs are exact: Qté, PR FO (rounded half up to the cent, P-10), hours per unit and
//   the parameters are read through their shortest decimal string; a value beyond the column
//   scale stops the script, it is never rounded silently.
// - Controls: "Prix Unitaire" and "Prix Total" are float cells; they are read at Excel's 15
//   significant digits, then rounded half up to the cent.
// - Run 1 at the workbook coefficients (1,3 / 1,3): PU v3 against "Prix Unitaire", gross against
//   "Prix Total". Run 2 at 1,30 / 1,20 (the offer): net HT, cost and realized coefficient.
// - The §5.4 expectations of the two lots of docs/prd_file are checked when the file name names
//   the lot; any difference fails the run (exit 1): find the root cause, never move the number.
// The report (numbers and row numbers only, no designation) is archived outside the tracked tree:
// .e2e/engine-v3/optima-lot-check/<timestamp>/report.json.

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import * as XLSX from "xlsx";

import {
  computeEstimateV3Breakdown,
  type EstimateV3Breakdown,
  type EstimateV3Input,
  type EstimateV3ItemInput,
} from "../../src/lib/estimates/engine-v3";
import {
  detectImportProfile,
  normalizeProfileHeader,
  readWorkbookParameterValues,
} from "../../src/lib/imports/optima-profile";
import type { MappingTargetField } from "../../src/lib/mappings/schemas";
import { normalizeMeasurementUnit } from "../../src/lib/units/normalize";
import { newEvidenceDirectory } from "../tester-army/local-recipe-common.mjs";
import { centsHalfUp, controlCents } from "./optima-control";

type Expectation = {
  priced: number;
  ptEqual: number;
  maxGapCents: number;
  workbookSumCents: number;
  sumAtWorkbookCoefficientsCents: number;
  sumAtOfferCoefficientsCents: number;
  costCents: number;
  realizedSaleCoefficient: string;
  statuses: Record<string, number>;
};

// Design §5.4 (validated 16/10/2026, P-03): aggregate numbers only.
const EXPECTATIONS: Record<string, Expectation> = {
  HYDRAULIQUE: {
    priced: 785,
    ptEqual: 392,
    maxGapCents: 794,
    workbookSumCents: 164_417_389,
    sumAtWorkbookCoefficientsCents: 164_420_761,
    sumAtOfferCoefficientsCents: 157_232_099,
    costCents: 126_474_907,
    realizedSaleCoefficient: "1.243188",
    statuses: { HL: 61, inc: 9, NC: 7, PM: 1, CP: 1 },
  },
  PLOMBERIE: {
    priced: 656,
    ptEqual: 310,
    maxGapCents: 203,
    workbookSumCents: 102_763_733,
    sumAtWorkbookCoefficientsCents: 102_765_561,
    sumAtOfferCoefficientsCents: 98_188_792,
    costCents: 79_049_005,
    realizedSaleCoefficient: "1.242126",
    statuses: { HL: 74, NC: 4, SO: 3, PM: 1 },
  },
};

const OFFER_COEFFICIENTS = { fo: "1.30", mo: "1.20" } as const;
const TAX_RATE_BP = 2000;

/** Shortest decimal string of a workbook number; exponent notation is refused. */
function decimalString(value: unknown, field: string, maxScale: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field}: non-negative number expected, got ${JSON.stringify(value)}`);
  }
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2]?.length ?? 0) > maxScale) {
    throw new Error(`${field}: ${text} does not fit ${maxScale} decimals; it is never rounded silently`);
  }
  return text;
}

function lineId(lot: number, row: number) {
  return `00000000-0000-4000-8${String(lot).padStart(3, "0")}-${String(row).padStart(12, "0")}`;
}

type WorkbookLine = { row: number; item: EstimateV3ItemInput; controlPuCents?: number; controlPtCents?: number };

function readWorkbook(file: string, lotIndex: number) {
  const workbook = XLSX.readFile(file);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const headers = (rows[0] ?? []).map((cell) => (cell === null || cell === undefined ? "" : String(cell)));
  const profile = detectImportProfile(headers.filter(Boolean));
  if (profile?.id !== "optima") throw new Error(`${path.basename(file)}: not recognised by the OPTIMA profile (2.3)`);
  const columnOf = new Map<MappingTargetField, number>();
  for (const [source, target] of Object.entries(profile.mapping)) {
    const index = headers.findIndex((header) => header && normalizeProfileHeader(header) === normalizeProfileHeader(source));
    if (index >= 0 && target) columnOf.set(target, index);
  }
  const column = (target: MappingTargetField) => {
    const index = columnOf.get(target);
    if (index === undefined) throw new Error(`${path.basename(file)}: the OPTIMA column for ${target} is missing`);
    return index;
  };
  const cell = (row: unknown[], target: MappingTargetField) => row[column(target)];

  const parameterRow = rows[1] ?? [];
  const parameters = readWorkbookParameterValues(
    Object.fromEntries(
      (["param_coeff_fo", "param_coeff_mo", "param_hourly_rate", "h_mo_majoration_additive"] as MappingTargetField[]).map(
        (target) => [target, cell(parameterRow, target)]
      )
    )
  );
  const coefficientFo = decimalString(parameters.coeffFo, "Coeff FO (row 2)", 4);
  const coefficientMo = decimalString(parameters.coeffMo, "Coeff MO (row 2)", 4);
  const hourlyRateCents = centsHalfUp(decimalString(parameters.hourlyRate, "Taux horaire (row 2)", 2));
  const additive = decimalString(parameters.majoration.h_mo_majoration_additive ?? 0, "Majoration MO (row 2)", 4);
  // Additive convention of the OPTIMA profile (2.3): coefficient = 1 + N, added exactly.
  const [additiveWhole, additiveFraction] = additive.split(".");
  const majoration = `${BigInt(additiveWhole) + BigInt(1)}${additiveFraction ? `.${additiveFraction}` : ""}`;

  const lines: WorkbookLine[] = [];
  const statuses: Record<string, number> = {};
  let skipped = 0;
  for (let index = 2; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rowNumber = index + 1;
    const label = String(cell(row, "designation") ?? "").trim();
    if (/^Sous-total|^Total/i.test(label)) {
      skipped += 1;
      continue;
    }
    const unitRaw = cell(row, "unit");
    const unit = normalizeMeasurementUnit(typeof unitRaw === "string" ? unitRaw : null);
    const quantity = cell(row, "quantity");
    const pu = cell(row, "control_unit_price");
    const priced = typeof pu === "number" && pu > 0 && typeof quantity === "number" && quantity > 0;
    const optional = (value: unknown, field: string, scale: number) =>
      typeof value === "number" ? decimalString(value, `row ${rowNumber} ${field}`, scale) : null;
    const base = {
      id: lineId(lotIndex, rowNumber),
      item_type: "line" as const,
      parent_id: null,
      quantity: optional(quantity, "Qté", 3),
      unit_price_ht_cents:
        typeof cell(row, "unit_price_ht") === "number"
          ? centsHalfUp(decimalString(cell(row, "unit_price_ht"), `row ${rowNumber} PR Fourniture unitaire`, 12))
          : null,
      k_fo: 1,
      h_mo_per_unit: optional(cell(row, "labor_hours_per_unit"), "Tps pose unitaire", 4),
      h_mo_atelier_per_unit: null,
      h_mo_chantier_per_unit: null,
      h_mo_majoration: majoration,
      k_mo: 1,
      k_mo_atelier: null,
      k_mo_chantier: null,
      labor_rate_cents: hourlyRateCents,
      labor_rate_atelier_cents: null,
      labor_rate_chantier_cents: null,
      tax_rate_bp: TAX_RATE_BP,
      unit_code: unit.unitCode,
    };
    if (priced) {
      if (unit.pricingStatus) throw new Error(`row ${rowNumber}: a priced row carries a status unit`);
      const total = cell(row, "control_total_price");
      lines.push({
        row: rowNumber,
        item: { ...base, pricing_status: "priced" },
        controlPuCents: controlCents(pu),
        controlPtCents: typeof total === "number" ? controlCents(total) : undefined,
      });
    } else if (unit.pricingStatus) {
      const token = String(unitRaw).trim();
      statuses[token] = (statuses[token] ?? 0) + 1;
      lines.push({ row: rowNumber, item: { ...base, pricing_status: unit.pricingStatus } });
    } else {
      skipped += 1;
    }
  }
  return { coefficientFo, coefficientMo, hourlyRateCents, majoration, lines, statuses, skipped, rows: rows.length };
}

function compute(lines: WorkbookLine[], fo: string, mo: string): EstimateV3Breakdown {
  const input: EstimateV3Input = {
    params: {
      sale_coefficient_fo: fo,
      sale_coefficient_mo: mo,
      discount_amount_cents: null,
      discount_bp: 0,
      rounding_mode: "none",
      rounding_step_cents: 1,
      reverse_charge: false,
      labor_split_enabled: false,
    },
    items: lines.map((line) => line.item),
  };
  return computeEstimateV3Breakdown(input);
}

const euros = (cents: number) =>
  `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error("Usage: npm run engine:v3:optima-lot-check -- <workbook.xlsx> [...]");
  const started = new Date();
  const lots: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  files.forEach((file, lotIndex) => {
    const name = path.basename(file);
    const workbook = readWorkbook(file, lotIndex + 1);
    const priced = workbook.lines.filter((line) => line.item.pricing_status === "priced");
    const atWorkbook = compute(workbook.lines, workbook.coefficientFo, workbook.coefficientMo);
    const atOffer = compute(workbook.lines, OFFER_COEFFICIENTS.fo, OFFER_COEFFICIENTS.mo);
    const byId = new Map(atWorkbook.lines.map((line) => [line.id, line]));
    let puEqual = 0;
    let ptEqual = 0;
    let maxGapCents = 0;
    let workbookSumCents = 0;
    const puDifferences: Array<{ row: number; v3: number | null; workbook: number }> = [];
    for (const line of priced) {
      const result = byId.get(String(line.item.id).toLowerCase());
      if (!result) throw new Error(`row ${line.row}: no v3 result`);
      if (result.pu_ht_cents === line.controlPuCents) puEqual += 1;
      else if (puDifferences.length < 20) puDifferences.push({ row: line.row, v3: result.pu_ht_cents, workbook: line.controlPuCents ?? -1 });
      const control = line.controlPtCents ?? 0;
      if (result.gross_ht_cents === control) ptEqual += 1;
      maxGapCents = Math.max(maxGapCents, Math.abs(result.gross_ht_cents - control));
      workbookSumCents += control;
    }
    const nonPricedContribution = atWorkbook.lines
      .filter((line) => line.pricing_status !== "priced")
      .reduce((total, line) => total + Math.abs(line.gross_ht_cents) + Math.abs(line.line_total_ttc_cents), 0);
    const lot: Record<string, unknown> = {
      file: name,
      rows: workbook.rows,
      parameters: {
        coefficientFo: workbook.coefficientFo,
        coefficientMo: workbook.coefficientMo,
        hourlyRateCents: workbook.hourlyRateCents,
        majoration: workbook.majoration,
      },
      pricedLines: priced.length,
      statusLines: workbook.statuses,
      skippedRows: workbook.skipped,
      nonPricedContributionCents: nonPricedContribution,
      warnings: atWorkbook.warnings.length,
      atWorkbookCoefficients: {
        puEqual,
        puDifferences,
        ptEqual,
        maxGapCents,
        workbookSumCents,
        sumV3Cents: atWorkbook.totals.gross_ht_cents,
        deltaCents: atWorkbook.totals.gross_ht_cents - workbookSumCents,
      },
      atOfferCoefficients: {
        coefficients: OFFER_COEFFICIENTS,
        totalHtCents: atOffer.totals.total_ht_cents,
        costCents: atOffer.totals.cost_subtotal_cents,
        realizedSaleCoefficient: atOffer.totals.realized_sale_coefficient,
      },
    };
    lots.push(lot);
    console.log(
      `${name}: PU ${puEqual}/${priced.length} ; PT ${ptEqual}/${priced.length} ; écart max ${euros(maxGapCents)} ; ` +
        `Σ v3 ${euros(atWorkbook.totals.gross_ht_cents)} (classeur ${euros(workbookSumCents)}) à ${workbook.coefficientFo} / ${workbook.coefficientMo} ; ` +
        `${euros(atOffer.totals.total_ht_cents)} à 1,30 / 1,20 ; déboursé ${euros(atOffer.totals.cost_subtotal_cents)} ; ` +
        `coefficient réalisé ${atOffer.totals.realized_sale_coefficient} ; statuts ${JSON.stringify(workbook.statuses)} ; ` +
        `contribution des lignes non chiffrées ${nonPricedContribution} c`
    );

    const lotKey = Object.keys(EXPECTATIONS).find((key) => name.toUpperCase().includes(key));
    if (!lotKey) return;
    const expected = EXPECTATIONS[lotKey];
    const check = (label: string, actual: unknown, wanted: unknown) => {
      if (!isDeepStrictEqual(actual, wanted)) {
        failures.push(`${name}: ${label} = ${JSON.stringify(actual)}, attendu ${JSON.stringify(wanted)} (§5.4)`);
      }
    };
    check("lignes chiffrées", priced.length, expected.priced);
    check("PU identiques", puEqual, expected.priced);
    check("PT identiques", ptEqual, expected.ptEqual);
    check("écart max (c)", maxGapCents, expected.maxGapCents);
    check("Σ classeur (c)", workbookSumCents, expected.workbookSumCents);
    check("Σ v3 à 1,3 / 1,3 (c)", atWorkbook.totals.gross_ht_cents, expected.sumAtWorkbookCoefficientsCents);
    check("Σ v3 à 1,30 / 1,20 (c)", atOffer.totals.total_ht_cents, expected.sumAtOfferCoefficientsCents);
    check("déboursé (c)", atOffer.totals.cost_subtotal_cents, expected.costCents);
    check("coefficient réalisé", atOffer.totals.realized_sale_coefficient, expected.realizedSaleCoefficient);
    check("lignes à statut", workbook.statuses, expected.statuses);
    check("contribution des lignes non chiffrées (c)", nonPricedContribution, 0);
    lot.expectation = lotKey;
  });

  const evidence = await newEvidenceDirectory(
    "engine-v3/optima-lot-check",
    started.toISOString().replace(/[:.]/g, "-")
  );
  const report = {
    schemaVersion: "engine-v3-optima-lot-check-1",
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    lots,
    failures,
    status: failures.length === 0 ? "passed" : "failed",
  };
  fs.writeFileSync(path.join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length > 0) {
    throw new Error(`Lots OPTIMA : ${failures.length} écart(s) au §5.4\n${failures.join("\n")}\nRapport : ${evidence}`);
  }
  console.log(`Lots OPTIMA conformes au §5.4. Rapport : ${evidence}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
