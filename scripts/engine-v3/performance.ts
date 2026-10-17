// Lot 2, sub-lot 2.4: performance acceptance of the pure engine 3 (design §14 "2.4": 1 000 lines
// p95 <= 50 ms under Node; 3 000 lines <= 2 x the v2 engine on comparable input). A measuring
// script, not a test: `npm run engine:v3:performance [-- --samples <n>]`.
//
// Both engines receive the same seeded lines (sections of 25 lines, quantities with 3 decimals,
// supply cost, labour hours at one role rate, a fixed discount, VAT 20 %): v3 through
// computeEstimateV3Breakdown (hours per unit), v2 through computeEstimateBreakdown (engine 2,
// fixed margin, the same hours as line hours Q x h/u). Runs are interleaved after a warm-up;
// every raw sample is archived in .e2e/engine-v3/performance/<timestamp>/report.json.

import fs from "node:fs";
import path from "node:path";

import {
  computeEstimateBreakdown,
  type EstimateComputationInput,
  type EstimateItemRecord,
} from "../../src/lib/estimate-calculations";
import {
  computeEstimateV3Breakdown,
  type EstimateV3Input,
  type EstimateV3ItemInput,
} from "../../src/lib/estimates/engine-v3";
import { newEvidenceDirectory } from "../tester-army/local-recipe-common.mjs";

const SEED = 20261017;
const ROLE_ID = "00000000-0000-4000-8009-000000000001";
const RATE_CENTS = 4000;
const WARM_UP = 20;

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

const uuid = (kind: number, n: number) =>
  `00000000-0000-4000-8${String(kind).padStart(3, "0")}-${String(n).padStart(12, "0")}`;

function buildInputs(lineCount: number) {
  const random = mulberry32(SEED + lineCount);
  const int = (max: number) => Math.floor(random() * (max + 1));
  const v3Items: EstimateV3ItemInput[] = [];
  const v2Items: EstimateItemRecord[] = [];
  let position = 0;
  let section = "";
  for (let n = 0; n < lineCount; n += 1) {
    if (n % 25 === 0) {
      section = uuid(1, n);
      v3Items.push({ id: section, item_type: "section", parent_id: null } as EstimateV3ItemInput);
      v2Items.push({
        id: section,
        item_type: "section",
        parent_id: null,
        title: "",
        description: null,
        position: (position += 1),
        labor_role_id: null,
        category_id: null,
        quantity: null,
        unit_price_ht_cents: null,
        tax_rate_bp: null,
        k_fo: null,
        h_mo: null,
        k_mo: null,
        pu_ht_cents: null,
        line_total_ht_cents: null,
        line_tax_cents: null,
        line_total_ttc_cents: null,
      });
    }
    const quantityThousandths = 1 + int(20_000);
    const hoursTenThousandths = int(15_000);
    const unitPrice = int(20_000);
    const kFoThousandths = 900 + int(400);
    const id = uuid(2, n);
    v3Items.push({
      id,
      item_type: "line",
      parent_id: section,
      quantity: (quantityThousandths / 1000).toFixed(3),
      unit_price_ht_cents: unitPrice,
      k_fo: (kFoThousandths / 1000).toFixed(3),
      h_mo_per_unit: (hoursTenThousandths / 10_000).toFixed(4),
      h_mo_atelier_per_unit: null,
      h_mo_chantier_per_unit: null,
      h_mo_majoration: 1,
      k_mo: 1,
      k_mo_atelier: null,
      k_mo_chantier: null,
      labor_rate_cents: RATE_CENTS,
      labor_rate_atelier_cents: null,
      labor_rate_chantier_cents: null,
      pricing_status: "priced",
      tax_rate_bp: 2000,
      unit_code: "u",
    });
    v2Items.push({
      id,
      item_type: "line",
      parent_id: section,
      title: "",
      description: null,
      position: (position += 1),
      labor_role_id: ROLE_ID,
      category_id: null,
      quantity: quantityThousandths / 1000,
      unit_price_ht_cents: unitPrice,
      tax_rate_bp: 2000,
      k_fo: kFoThousandths / 1000,
      // v2 reads line hours: the same work as Q x h/u.
      h_mo: Number(((quantityThousandths * hoursTenThousandths) / 10_000_000).toFixed(3)),
      h_mo_majoration: 1,
      k_mo: 1,
      pu_ht_cents: null,
      line_total_ht_cents: null,
      line_tax_cents: null,
      line_total_ttc_cents: null,
    });
  }
  const v3: EstimateV3Input = {
    params: {
      sale_coefficient_fo: "1.25",
      sale_coefficient_mo: "1.25",
      discount_amount_cents: 1000,
      discount_bp: 0,
      rounding_mode: "none",
      rounding_step_cents: 1,
      reverse_charge: false,
      labor_split_enabled: false,
    },
    items: v3Items,
  };
  const v2: EstimateComputationInput = {
    items: v2Items,
    marginMultiplier: 1.25,
    marginMode: "fixed",
    marginTiers: [],
    globalCoefficient: 1,
    discountMode: "simple",
    discountCents: 1000,
    discountStepsBp: [],
    taxRateBp: 2000,
    roundingMode: "none",
    roundingStepCents: 1,
    isLaborSplitEnabled: false,
    laborRateById: new Map([[ROLE_ID, RATE_CENTS]]),
    laborRateAtelierById: new Map(),
    laborRateChantierById: new Map(),
    calcEngineVersion: 2,
  };
  return { v3, v2 };
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (quantile: number) => sorted[Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)];
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    count: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((total, value) => total + value, 0) / sorted.length),
  };
}

function time(run: () => unknown) {
  const started = performance.now();
  run();
  return performance.now() - started;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0 && !(args.length === 2 && args[0] === "--samples" && /^\d{2,4}$/.test(args[1]))) {
    throw new Error("Usage: npm run engine:v3:performance [-- --samples <n>] (n: 10 to 9999)");
  }
  const samples = args.length === 2 ? Number(args[1]) : 200;
  const started = new Date();
  const thousand = buildInputs(1000);
  const threeThousand = buildInputs(3000);
  for (let n = 0; n < WARM_UP; n += 1) {
    computeEstimateV3Breakdown(thousand.v3);
    computeEstimateV3Breakdown(threeThousand.v3);
    computeEstimateBreakdown(threeThousand.v2);
  }
  const raw = { v3At1000: [] as number[], v3At3000: [] as number[], v2At3000: [] as number[] };
  for (let n = 0; n < samples; n += 1) {
    raw.v3At1000.push(time(() => computeEstimateV3Breakdown(thousand.v3)));
    raw.v3At3000.push(time(() => computeEstimateV3Breakdown(threeThousand.v3)));
    raw.v2At3000.push(time(() => computeEstimateBreakdown(threeThousand.v2)));
  }
  const summary = {
    v3At1000: stats(raw.v3At1000),
    v3At3000: stats(raw.v3At3000),
    v2At3000: stats(raw.v2At3000),
  };
  const ratioP50 = Math.round((summary.v3At3000.p50 / summary.v2At3000.p50) * 1000) / 1000;
  const ratioP95 = Math.round((summary.v3At3000.p95 / summary.v2At3000.p95) * 1000) / 1000;
  const checks = {
    "1 000 lines p95 <= 50 ms": summary.v3At1000.p95 <= 50,
    "3 000 lines v3 p50 <= 2 x v2 p50": ratioP50 <= 2,
    "3 000 lines v3 p95 <= 2 x v2 p95": ratioP95 <= 2,
  };
  const evidence = await newEvidenceDirectory("engine-v3/performance", started.toISOString().replace(/[:.]/g, "-"));
  const report = {
    schemaVersion: "engine-v3-performance-1",
    startedAt: started.toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    warmUp: WARM_UP,
    samples,
    summaryMs: summary,
    ratioV3OverV2At3000: { p50: ratioP50, p95: ratioP95 },
    checks,
    rawSamplesMs: raw,
  };
  fs.writeFileSync(path.join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ node: process.version, samples, summaryMs: summary, ratioV3OverV2At3000: report.ratioV3OverV2At3000, checks }, null, 2));
  console.log(`Rapport : ${evidence}`);
  if (Object.values(checks).some((passed) => !passed)) {
    throw new Error("Critère de performance du §14 « 2.4 » non tenu.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
