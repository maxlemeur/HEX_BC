/**
 * Corpus figé des moteurs de calcul 1 et 2 (lot 2, sous-lot 2.0 ; conception
 * `docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md`, §2 I1 (b) et §10.3).
 *
 * Génère 300 devis v1 et 300 devis v2 à partir d'une graine fixe, calcule leurs sorties avec les
 * moteurs de l'arbre courant et les écrit dans `src/test/fixtures/engine-frozen-corpus.json`.
 * Le test `src/lib/estimates/engine-frozen-corpus.test.ts` recalcule chaque devis et exige la
 * même ligne JSON, octet pour octet. La fixture se génère une fois, avant toute modification du
 * lot 2 ; elle ne se régénère jamais pour absorber un changement de montant v1/v2.
 *
 * Chaîne rejouée, celle de l'application :
 *  - brouillon : computeInitialDiscountCents puis computeEstimateBreakdown
 *    (`calculateEstimateSnapshotForItems`, src/lib/estimates/version-totals.ts) ;
 *    normalizeDraftItems (colonnes de ligne écrites par l'éditeur) ;
 *  - v1 envoyée : lignes de normalizeDraftItems, pied de computeEstimateBreakdown, puis
 *    computeStoredDiscountCents et computeReadOnlyTotals (lecture seule de l'éditeur) ;
 *  - v2 : computeReadOnlyTotals vivant, gel par buildEstimateV2SnapshotProjection, puis relecture
 *    figée par buildStoredEstimateBreakdown, computeReadOnlyTotals et computeAllSectionTotals.
 *
 * Domaine couvert : remises historiques (%), palier simple, cascade (palier nul compris), montant
 * fixe (plafonné ou non), autoliquidation, multi-taux, ventilation atelier/chantier (active ou
 * ignorée), quantités décimales, paliers de marge (entreprise et barème par défaut), coefficient
 * global, arrondis commerciaux, écrêtage int32, sections imbriquées, lignes racine, devis vides.
 *
 * Format : un en-tête JSON indenté, puis un cas par ligne en JSON canonique (clés triées). Les
 * lignes et sections tabulées commencent par leur identifiant et suivent `columns`.
 *
 * Usage, depuis la racine du dépôt :
 *   npm run engine:frozen-corpus                 vérifie : régénère en mémoire, compare l'octet
 *   npm run engine:frozen-corpus -- --write      première génération ; refuse d'écraser la
 *                                                fixture et refuse un moteur modifié
 *   npm run engine:frozen-corpus -- --write --force
 *                                                régénération délibérée (changement de format),
 *                                                jamais après un changement de montant
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  buildEstimateV2SnapshotProjection,
  buildStoredEstimateBreakdown,
  computeAllSectionTotals,
  computeEstimateBreakdown,
  computeInitialDiscountCents,
  computeReadOnlyTotals,
  computeStoredDiscountCents,
  hasActiveLaborSplitPayload,
  normalizeDraftItems,
  type DiscountMode,
  type EstimateBreakdown,
  type EstimateItemRecord,
  type EstimateTotals,
  type EstimateV2SnapshotProjection,
  type EstimateVersionForCalc,
  type MarginMode,
  type RoundingMode,
  type SectionTotals,
} from "../../src/lib/estimate-calculations";
import type { CalcEngineVersion } from "../../src/lib/estimates/calc-engine-version";
import {
  resolveMarginMultiplier,
  type MarginTier,
} from "../../src/lib/estimates/margin-tiers";

/* ---------- contrat de la fixture ---------- */

export const FROZEN_CORPUS_FORMAT = "engine-frozen-corpus/1";
export const FROZEN_CORPUS_SEED = 20_261_016;
export const FROZEN_CORPUS_CASES_PER_ENGINE = 300;
export const FROZEN_CORPUS_PATH = "src/test/fixtures/engine-frozen-corpus.json";
const FROZEN_CORPUS_GENERATOR = "scripts/engine-v3/frozen-corpus.ts";

/** Sources dont dépendent les montants : la génération exige qu'elles soient identiques à HEAD. */
const ENGINE_SOURCE_FILES = [
  "src/lib/estimate-calculations.ts",
  "src/lib/estimate-v2-snapshot.ts",
  "src/lib/estimate-allocation.ts",
  "src/lib/money.ts",
  "src/lib/numeric-input/parsers.ts",
  "src/lib/estimates/calc-engine-version.ts",
  "src/lib/estimates/effective-discount.ts",
  "src/lib/estimates/margin-tiers.ts",
] as const;

export const FROZEN_CORPUS_COLUMNS = {
  item: [
    "id",
    "item_type",
    "parent_id",
    "position",
    "supply_type_id",
    "quantity",
    "unit_price_ht_cents",
    "tax_rate_bp",
    "k_fo",
    "labor_role_id",
    "h_mo",
    "h_mo_majoration",
    "k_mo",
    "labor_role_atelier_id",
    "h_mo_atelier",
    "k_mo_atelier",
    "labor_role_chantier_id",
    "h_mo_chantier",
    "k_mo_chantier",
  ],
  line: [
    "costLineCents",
    "saleGrossCents",
    "coefficientShareCents",
    "discountShareCents",
    "saleNetHtCents",
    "foNetCents",
    "moNetCents",
    "moAtelierNetCents",
    "moChantierNetCents",
    "puNetHtCents",
    "taxCents",
  ],
  section: [
    "foTotalCents",
    "moTotalCents",
    "moAtelierTotalCents",
    "moChantierTotalCents",
    "totalHtCents",
    "totalTtcCents",
    "supplyTypeFoTotalsCents",
  ],
  normalizedLine: [
    "tax_rate_bp",
    "k_fo",
    "h_mo",
    "h_mo_majoration",
    "k_mo",
    "pu_ht_cents",
    "line_total_ht_cents",
    "line_tax_cents",
    "line_total_ttc_cents",
  ],
  projectionLine: [
    "id",
    "snapshot_pu_ht_cents",
    "line_total_ht_cents",
    "line_tax_cents",
    "line_total_ttc_cents",
    "snapshot_fo_ht_cents",
    "snapshot_mo_ht_cents",
    "snapshot_mo_atelier_ht_cents",
    "snapshot_mo_chantier_ht_cents",
  ],
} as const;

type ItemColumn = (typeof FROZEN_CORPUS_COLUMNS.item)[number];
type Cell = string | number | null;
type RateEntries = Array<[string, number]>;

export type FrozenCorpusVersion = {
  margin_multiplier: number;
  margin_mode: MarginMode;
  tax_rate_bp: number;
  discount_bp: number;
  discount_amount_cents: number | null;
  discount_mode: DiscountMode;
  discount_steps: Array<number | null> | null;
  global_coefficient: number;
  rounding_mode: RoundingMode;
  rounding_step_cents: number;
};

export type FrozenCorpusInput = {
  version: FrozenCorpusVersion;
  /** `contractor_role === "subcontractor"` dans l'application. */
  vatReverseCharge: boolean;
  isLaborSplitEnabled: boolean;
  marginTiers: MarginTier[];
  /** `null` : même table que `default`, comme le serveur (version-totals.ts). */
  laborRates: { default: RateEntries; atelier: RateEntries | null; chantier: RateEntries | null };
  items: Cell[][];
};

export type FrozenCorpusBreakdown = {
  totals: EstimateTotals;
  lines: unknown[][];
  sections: unknown[][];
  rootLineIds: string[];
  invariants: EstimateBreakdown["invariants"];
};

export type FrozenCorpusOutput = {
  initialDiscountCents: number;
  breakdown: FrozenCorpusBreakdown;
  normalizedLines: unknown[][];
  // v1
  storedDiscountCents?: number;
  readOnlyTotals?: EstimateTotals;
  // v2
  readOnlyLiveTotals?: EstimateTotals;
  projection?:
    | { items: unknown[][]; totals: EstimateV2SnapshotProjection["totals"] }
    | { error: string };
  storedBreakdown?: FrozenCorpusBreakdown | null;
  readOnlyStoredTotals?: EstimateTotals | null;
  storedSections?: unknown[][] | null;
};

export type FrozenCorpusCase = {
  id: string;
  engine: CalcEngineVersion;
  input: FrozenCorpusInput;
  output: FrozenCorpusOutput;
};

export type FrozenCorpusCoverage = Record<string, number>;

export type FrozenCorpusProvenance = {
  revision: string | null;
  engineSources: Record<string, string | null>;
  node: string;
};

export type FrozenCorpusFile = {
  format: string;
  description: string;
  seed: number;
  generator: string;
  casesPerEngine: number;
  columns: typeof FROZEN_CORPUS_COLUMNS;
  coverage: { v1: FrozenCorpusCoverage; v2: FrozenCorpusCoverage };
  fingerprint: string;
  provenance: FrozenCorpusProvenance;
  cases: FrozenCorpusCase[];
};

/* ---------- sérialisation canonique ---------- */

function canonicalize(value: unknown, label: string): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalize(entry, `${label}[${index}]`));
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} : nombre non fini (${value})`);
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  // Objet simple seulement : une Map ou un Set se sérialiserait silencieusement en `{}`.
  if (typeof value === "object" && Object.prototype.toString.call(value) === "[object Object]") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(record[key], `${label}.${key}`)])
    );
  }
  throw new Error(`${label} : valeur non sérialisable (${Object.prototype.toString.call(value)})`);
}

/** Une ligne de cas : JSON canonique (clés triées, `undefined` omis, nombres finis exigés). */
export function serializeFrozenCorpusCase(corpusCase: FrozenCorpusCase): string {
  return JSON.stringify(canonicalize(corpusCase, corpusCase.id));
}

export function fingerprintFrozenCorpusLines(lines: readonly string[]): string {
  return `sha256:${createHash("sha256").update(lines.join("\n")).digest("hex")}`;
}

/** Lignes brutes des cas, telles qu'écrites par `serializeFrozenCorpus`. */
export function extractFrozenCorpusCaseLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf('  "cases": [');
  const end = lines.lastIndexOf("  ]");
  if (start < 0 || end <= start) {
    throw new Error("FROZEN_CORPUS_LAYOUT : bloc \"cases\" introuvable.");
  }
  return lines
    .slice(start + 1, end)
    .map((line, index, all) => (index < all.length - 1 ? line.replace(/,$/, "") : line));
}

/** Une ligne tabulée ; un champ absent de `columns` est un changement de format, donc une erreur. */
function toRow(record: object, columns: readonly string[], label: string): unknown[] {
  const values = record as Record<string, unknown>;
  const unexpected = Object.keys(values).filter(
    (key) => values[key] !== undefined && !columns.includes(key)
  );
  if (unexpected.length > 0) {
    throw new Error(`${label} : champ hors de FROZEN_CORPUS_COLUMNS (${unexpected.join(", ")})`);
  }
  return columns.map((column) => values[column] ?? null);
}

function tabulateSections(sections: Map<string, SectionTotals>, label: string): unknown[][] {
  return [...sections].map(([id, section]) => [
    id,
    ...toRow(section, FROZEN_CORPUS_COLUMNS.section, `${label} section ${id}`),
  ]);
}

function tabulateBreakdown(breakdown: EstimateBreakdown, label: string): FrozenCorpusBreakdown {
  return {
    totals: breakdown.totals,
    lines: [...breakdown.lineById].map(([id, line]) => [
      id,
      ...toRow(line, FROZEN_CORPUS_COLUMNS.line, `${label} ligne ${id}`),
    ]),
    sections: tabulateSections(breakdown.sectionById, label),
    rootLineIds: breakdown.rootLineIds,
    invariants: breakdown.invariants,
  };
}

/* ---------- chaîne de calcul rejouée ---------- */

/** Colonnes d'un brouillon que les entrées ne portent pas : jamais lues par les moteurs en entrée. */
const DRAFT_ITEM_CONSTANTS = {
  title: "",
  description: null,
  category_id: null,
  pu_ht_cents: null,
  line_total_ht_cents: null,
  line_tax_cents: null,
  line_total_ttc_cents: null,
  snapshot_pu_ht_cents: null,
  snapshot_fo_ht_cents: null,
  snapshot_mo_ht_cents: null,
  snapshot_mo_atelier_ht_cents: null,
  snapshot_mo_chantier_ht_cents: null,
};

function toItemRecord(row: readonly Cell[]): EstimateItemRecord {
  if (row.length !== FROZEN_CORPUS_COLUMNS.item.length) {
    throw new Error(`FROZEN_CORPUS_ITEM : ${row.length} colonnes au lieu de ${FROZEN_CORPUS_COLUMNS.item.length}.`);
  }
  const fields = Object.fromEntries(
    FROZEN_CORPUS_COLUMNS.item.map((column, index) => [column, row[index]])
  );
  return { ...DRAFT_ITEM_CONSTANTS, ...fields } as EstimateItemRecord;
}

export function computeFrozenCorpusOutput(
  engine: CalcEngineVersion,
  input: FrozenCorpusInput
): FrozenCorpusOutput {
  const items = input.items.map(toItemRecord);
  const rates = new Map(input.laborRates.default);
  const atelierRates = input.laborRates.atelier ? new Map(input.laborRates.atelier) : rates;
  const chantierRates = input.laborRates.chantier ? new Map(input.laborRates.chantier) : rates;
  const { version: settings, isLaborSplitEnabled, marginTiers, vatReverseCharge } = input;
  const draftVersion: EstimateVersionForCalc = {
    margin_multiplier: settings.margin_multiplier,
    margin_mode: settings.margin_mode,
    tax_rate_bp: settings.tax_rate_bp,
    discount_bp: settings.discount_bp,
    discount_amount_cents: settings.discount_amount_cents,
    discount_mode: settings.discount_mode,
    discount_steps: settings.discount_steps,
    global_coefficient: settings.global_coefficient,
    status: "draft",
    calc_engine_version: engine,
  };
  // Comme version-totals.ts : paliers nuls retirés pour le pied, laissés à la remise initiale.
  const discountStepsBp = (settings.discount_steps ?? []).filter(
    (step): step is number => step !== null
  );
  const rateMaps = {
    laborRateById: rates,
    laborRateAtelierById: atelierRates,
    laborRateChantierById: chantierRates,
  };
  const initialDiscountCents = computeInitialDiscountCents(
    draftVersion,
    items,
    rates,
    isLaborSplitEnabled,
    atelierRates,
    chantierRates,
    { calcEngineVersion: engine, marginTiers }
  );
  const breakdown = computeEstimateBreakdown({
    items,
    marginMultiplier: settings.margin_multiplier,
    marginMode: settings.margin_mode,
    marginTiers,
    globalCoefficient: settings.global_coefficient,
    discountMode: settings.discount_mode,
    discountCents: initialDiscountCents,
    discountStepsBp,
    taxRateBp: settings.tax_rate_bp,
    roundingMode: settings.rounding_mode,
    roundingStepCents: settings.rounding_step_cents,
    isLaborSplitEnabled,
    ...rateMaps,
    calcEngineVersion: engine,
    vatReverseCharge,
  });
  const normalizedItems = normalizeDraftItems({
    items,
    version: draftVersion,
    rateById: rates,
    rateAtelierById: atelierRates,
    rateChantierById: chantierRates,
    isLaborSplitEnabled,
    calcEngineVersion: engine,
  });
  const readOnlyOptions = {
    isLaborSplitEnabled,
    marginTiers,
    roundingMode: settings.rounding_mode,
    roundingStepCents: settings.rounding_step_cents,
    vatReverseCharge,
    ...rateMaps,
  };
  const output: FrozenCorpusOutput = {
    initialDiscountCents,
    breakdown: tabulateBreakdown(breakdown, "breakdown"),
    normalizedLines: normalizedItems
      .filter((item) => item.item_type === "line")
      .map((item) => [
        item.id,
        ...FROZEN_CORPUS_COLUMNS.normalizedLine.map((column) => item[column] ?? null),
      ]),
  };

  if (engine === 1) {
    // v1 envoyée : lignes brutes normalisées, pied figé par calculateEstimateTotalsForItems.
    const storedVersion: EstimateVersionForCalc = {
      ...draftVersion,
      status: "sent",
      total_ht_cents: breakdown.totals.saleTotalCents,
      total_tax_cents: breakdown.totals.adjustedTaxCents,
      total_ttc_cents: breakdown.totals.roundedTtcCents,
    };
    const storedDiscountCents = computeStoredDiscountCents(storedVersion, normalizedItems);
    return {
      ...output,
      storedDiscountCents,
      readOnlyTotals: computeReadOnlyTotals({
        ...readOnlyOptions,
        items: normalizedItems,
        version: storedVersion,
        discountCents: storedDiscountCents,
        calcEngineVersion: 1,
        preserveStoredSnapshot: true,
      }),
    };
  }

  const readOnlyLiveTotals = computeReadOnlyTotals({
    ...readOnlyOptions,
    items,
    version: draftVersion,
    discountCents: initialDiscountCents,
    calcEngineVersion: 2,
    preserveStoredSnapshot: false,
  });
  let projection: EstimateV2SnapshotProjection;
  try {
    projection = buildEstimateV2SnapshotProjection({ items, breakdown });
  } catch (error) {
    return {
      ...output,
      readOnlyLiveTotals,
      projection: { error: error instanceof Error ? error.message : String(error) },
      storedBreakdown: null,
      readOnlyStoredTotals: null,
      storedSections: null,
    };
  }

  // v2 envoyée : colonnes figées par le gel, contexte de remise fixe comme version-totals.ts.
  const projectedById = new Map(projection.items.map((line) => [line.id, line]));
  const storedItems = items.map((item) => {
    const projected = projectedById.get(item.id);
    return projected ? { ...item, ...projected } : item;
  });
  const storedVersion: EstimateVersionForCalc = {
    ...draftVersion,
    status: "sent",
    ...projection.totals,
    content_revision: 2,
    calc_snapshot_content_revision: 2,
    calc_snapshot_context: {
      effective_margin_multiplier: breakdown.totals.appliedMarginMultiplier,
      ...(settings.discount_amount_cents != null
        ? {
            fixed_discount: {
              requested_cents: settings.discount_amount_cents,
              base_cents: breakdown.totals.saleSubtotalCents,
              applied_cents: breakdown.totals.discountCents,
            },
          }
        : {}),
    },
  };
  return {
    ...output,
    readOnlyLiveTotals,
    projection: {
      items: projection.items.map((line) =>
        toRow(line, FROZEN_CORPUS_COLUMNS.projectionLine, `projection ligne ${line.id}`)
      ),
      totals: projection.totals,
    },
    storedBreakdown: tabulateBreakdown(
      buildStoredEstimateBreakdown({ items: storedItems, version: storedVersion }),
      "storedBreakdown"
    ),
    readOnlyStoredTotals: computeReadOnlyTotals({
      ...readOnlyOptions,
      items: storedItems,
      version: storedVersion,
      discountCents: 0,
      calcEngineVersion: 2,
      preserveStoredSnapshot: true,
    }),
    storedSections: tabulateSections(
      computeAllSectionTotals({
        items: storedItems,
        marginMultiplier: settings.margin_multiplier,
        taxRateBp: settings.tax_rate_bp,
        discountCents: 0,
        marginMode: settings.margin_mode,
        marginTiers,
        globalCoefficient: settings.global_coefficient,
        discountMode: settings.discount_mode,
        discountStepsBp,
        calcEngineVersion: 2,
        isLaborSplitEnabled,
        ...rateMaps,
        preserveStoredSnapshot: true,
      }),
      "storedSections"
    ),
  };
}

/* ---------- couverture ---------- */

function featuresOf(corpusCase: FrozenCorpusCase): string[] {
  const { version, marginTiers, vatReverseCharge, isLaborSplitEnabled } = corpusCase.input;
  const items = corpusCase.input.items.map(toItemRecord);
  const lines = items.filter((item) => item.item_type === "line");
  const sectionIds = new Set(
    items.filter((item) => item.item_type === "section").map((item) => item.id)
  );
  const totals = corpusCase.output.breakdown.totals;
  const steps = (version.discount_steps ?? []).filter((step) => step !== null);
  const features: string[] = [];

  if (version.discount_amount_cents != null) {
    features.push("discount:fixed");
    if (version.discount_mode === "simple" && totals.discountCents < version.discount_amount_cents) {
      features.push("discount:fixedCapped");
    }
  } else if (version.discount_mode === "cascade" && steps.length > 0) {
    features.push("discount:cascade");
  } else if (steps.length > 0) {
    features.push("discount:simpleStep");
  } else {
    features.push(version.discount_bp > 0 ? "discount:percent" : "discount:none");
  }
  if (vatReverseCharge) {
    features.push("vat:reverseCharge");
  } else if (new Set(lines.map((line) => line.tax_rate_bp ?? version.tax_rate_bp)).size > 1) {
    features.push("vat:multiRate");
  }
  if (lines.some((line) => hasActiveLaborSplitPayload(line))) {
    features.push(isLaborSplitEnabled ? "labor:split" : "labor:splitPayloadIgnored");
  }
  if (lines.some((line) => line.quantity !== null && !Number.isInteger(line.quantity))) {
    features.push("quantity:decimal");
  }
  if (version.margin_mode === "tiered") {
    features.push(marginTiers.length > 0 ? "margin:tieredTenant" : "margin:tieredDefault");
    if (totals.appliedMarginMultiplier !== resolveMarginMultiplier(0, marginTiers)) {
      features.push("margin:tierAboveFirst");
    }
  }
  if (version.global_coefficient !== 1) features.push("coefficient:global");
  if (version.rounding_mode !== "none") features.push(`rounding:${version.rounding_mode}`);
  if (totals.roundingAdjustmentCents !== 0) features.push("rounding:adjusted");
  if (totals.isCapped === true) features.push("amount:capped");
  if (items.some((item) => item.item_type === "section" && item.parent_id !== null &&
    sectionIds.has(item.parent_id))) {
    features.push("structure:nested");
  }
  if (lines.some((line) => line.parent_id === null)) features.push("structure:rootLines");
  if (lines.length === 0) features.push("structure:empty");
  if (corpusCase.output.projection && "error" in corpusCase.output.projection) {
    features.push("v2:projectionError");
  }
  return features;
}

export function describeFrozenCorpusCoverage(
  cases: readonly FrozenCorpusCase[]
): { v1: FrozenCorpusCoverage; v2: FrozenCorpusCoverage } {
  const counts = { v1: new Map<string, number>(), v2: new Map<string, number>() };
  for (const corpusCase of cases) {
    const engineCounts = corpusCase.engine === 1 ? counts.v1 : counts.v2;
    for (const feature of featuresOf(corpusCase)) {
      engineCounts.set(feature, (engineCounts.get(feature) ?? 0) + 1);
    }
  }
  const sorted = (map: Map<string, number>) =>
    Object.fromEntries([...map].sort(([left], [right]) => left.localeCompare(right)));
  return { v1: sorted(counts.v1), v2: sorted(counts.v2) };
}

/* ---------- génération déterministe ---------- */

type Random = {
  int(min: number, max: number): number;
  pick<T>(values: readonly T[]): T;
  chance(probability: number): boolean;
  /** Décimal exact à `decimals` chiffres : un entier divisé par une puissance de 10. */
  decimal(min: number, max: number, decimals: number): number;
};

/** mulberry32 : entiers 32 bits seulement, identique sur toute plateforme. */
function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    int,
    pick: (values) => values[int(0, values.length - 1)],
    chance: (probability) => next() < probability,
    decimal: (min, max, decimals) => {
      const scale = 10 ** decimals;
      return int(Math.round(min * scale), Math.round(max * scale)) / scale;
    },
  };
}

/** Une suite indépendante par cas : un cas se relit sans dépendre des précédents. */
function caseSeed(engine: CalcEngineVersion, index: number): number {
  let mixed = (FROZEN_CORPUS_SEED ^ Math.imul(engine, 0x9e3779b1) ^
    Math.imul(index + 1, 0x85ebca6b)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

const DISCOUNT_KINDS = ["none", "percent", "simpleStep", "cascade", "fixed"] as const;
const ROUNDING_MODES = ["none", "nearest", "up", "down"] as const;
/** Montants au-delà du plafond int32 (écrêtage, `isCapped`). */
const CAPPED_CASE_INDEXES = new Set([37, 149, 271]);
const EMPTY_CASE_INDEXES = new Set([113, 227]);
const MARGIN_MULTIPLIERS = [1, 1.1, 1.15, 1.2, 1.25, 1.3, 1.333, 1.35, 1.4, 1.45, 1.5, 1.6, 1.75, 2, 0.95];
const GLOBAL_COEFFICIENTS = [0.9, 0.95, 0.975, 1.03, 1.05, 1.1, 1.125, 1.15, 1.2];
const LINE_TAX_RATES = [2_000, 1_000, 550, 210, 0, null];
const K_FO = [1, 1, 1, 1, 1.05, 1.1, 1.125, 1.15, 1.2, 1.3333, 0.95, 0.5];
const MAJORATIONS = [1, 1, 1, 1, 1.1, 1.15, 1.25, 1.5, null];
const K_MO = [1, 1, 1, 1, 1.05, 1.1, 1.2, 0.9, null];
/** `r-x` n'a de taux dans aucune table : repli à 0. */
const LABOR_ROLES = ["r-mo", "r-mo", "r-mo", "r-chef", "r-x", null];
const SUPPLY_TYPES = [null, null, "st-a", "st-b", "st-c"];

type Magnitude = "small" | "normal" | "large" | "capped";
// Bornes choisies pour ne jamais franchir le plafond int32 hors des cas `capped`.
const MAGNITUDES: Record<Magnitude, { maxQuantity: number; minPrice: number; maxPrice: number }> = {
  small: { maxQuantity: 20, minPrice: 0, maxPrice: 5_000 },
  normal: { maxQuantity: 120, minPrice: 0, maxPrice: 150_000 },
  large: { maxQuantity: 150, minPrice: 10_000, maxPrice: 250_000 },
  capped: { maxQuantity: 5_000, minPrice: 2_000_000, maxPrice: 9_000_000 },
};

type LineOptions = {
  magnitude: Magnitude;
  taxRateBp: number;
  multiRate: boolean;
  splitPayloads: boolean;
};

function generateDiscount(
  random: Random,
  kind: (typeof DISCOUNT_KINDS)[number]
): Pick<FrozenCorpusVersion, "discount_bp" | "discount_amount_cents" | "discount_mode" | "discount_steps"> {
  switch (kind) {
    case "none":
      return {
        discount_bp: 0,
        discount_amount_cents: null,
        discount_mode: "simple",
        discount_steps: random.pick([null, []]),
      };
    case "percent":
      return {
        discount_bp: random.chance(0.3)
          ? random.pick([333, 500, 1_000, 1_250, 1_500])
          : random.int(1, 3_000),
        discount_amount_cents: null,
        discount_mode: "simple",
        discount_steps: null,
      };
    case "simpleStep":
      return {
        discount_bp: random.chance(0.5) ? 0 : random.int(1, 2_000),
        discount_amount_cents: null,
        discount_mode: "simple",
        discount_steps: random.chance(0.7)
          ? [random.int(1, 2_500)]
          : [random.int(1, 2_500), random.int(1, 1_500)],
      };
    case "cascade": {
      const steps: Array<number | null> = Array.from(
        { length: random.int(1, 4) },
        () => random.int(1, 2_000)
      );
      if (random.chance(0.15)) steps.splice(random.int(0, steps.length), 0, null);
      return {
        discount_bp: random.chance(0.5) ? 0 : random.int(1, 2_000),
        discount_amount_cents: null,
        discount_mode: "cascade",
        discount_steps: steps,
      };
    }
    case "fixed": {
      const roll = random.int(1, 100);
      // Le dernier quart dépasse presque toujours l'assiette : remise plafonnée.
      const amount = roll <= 10
        ? 0
        : roll <= 45
          ? random.int(1, 5_000)
          : roll <= 75
            ? random.int(5_000, 500_000)
            : random.int(10_000_000, 90_000_000);
      // Le taux dérivé réécrit à côté du montant fixe (F12) ; parfois une cascade concurrente.
      const withCascade = random.chance(0.1);
      return {
        discount_bp: random.chance(0.5) ? random.int(1, 3_000) : 0,
        discount_amount_cents: amount,
        discount_mode: withCascade ? "cascade" : "simple",
        discount_steps: withCascade ? [random.int(100, 1_500)] : null,
      };
    }
  }
}

function generateTenantTiers(random: Random): MarginTier[] {
  const tiers: MarginTier[] = [
    {
      threshold_cents: random.chance(0.85) ? 0 : random.int(1, 50_000),
      multiplier: random.pick([1.2, 1.25, 1.3, 1.35, 1.6]),
      position: 0,
    },
    {
      threshold_cents: random.int(50_000, 2_000_000),
      multiplier: random.pick([1.15, 1.2, 1.25, 1.3, 1.45]),
      position: 1,
    },
  ];
  if (random.chance(0.6)) {
    tiers.push({
      threshold_cents: random.int(2_000_001, 30_000_000),
      multiplier: random.pick([1.1, 1.12, 1.18, 1.4]),
      position: 2,
    });
  }
  if (random.chance(0.1)) {
    // Seuil en double : le moteur départage par position.
    tiers.push({ threshold_cents: tiers[1].threshold_cents, multiplier: 1.22, position: 3 });
  }
  if (random.chance(0.25)) tiers.reverse();
  return tiers;
}

function generateLaborRates(random: Random): FrozenCorpusInput["laborRates"] {
  return {
    default: [
      ["r-mo", random.int(3_500, 6_500)],
      ["r-chef", random.int(4_500, 8_000)],
      ["r-at", random.int(3_000, 6_000)],
      ["r-ch", random.int(4_000, 7_000)],
    ],
    atelier: random.chance(0.3)
      ? [["r-at", random.int(3_000, 6_000)], ["r-mo", random.int(3_500, 6_500)]]
      : null,
    chantier: random.chance(0.3) ? [["r-ch", random.int(4_000, 7_000)]] : null,
  };
}

function generateQuantity(random: Random, maxQuantity: number): number | null {
  const roll = random.int(1, 100);
  if (roll <= 2) return null;
  if (roll <= 5) return 0;
  if (roll <= 40) return random.int(1, maxQuantity);
  if (roll <= 55) return random.decimal(0.1, maxQuantity, 1);
  if (roll <= 75) return random.decimal(0.01, maxQuantity, 2);
  if (roll <= 95) return random.decimal(0.001, maxQuantity, 3);
  return random.decimal(0.0001, 1, 4);
}

function generatePrice(random: Random, magnitude: Magnitude): number {
  const range = MAGNITUDES[magnitude];
  if (magnitude === "capped") return random.int(range.minPrice, range.maxPrice);
  const roll = random.int(1, 100);
  if (roll <= 4) return 0;
  // Petits prix : demi-centimes fréquents après coefficients.
  if (roll <= 9) return random.int(1, 99);
  return random.int(range.minPrice, range.maxPrice);
}

function generateSplitPayload(random: Random): Partial<Record<ItemColumn, Cell>> {
  const kind = random.pick(["both", "both", "atelier", "chantier", "roleOnly", "coefficientOnly"]);
  const atelier = {
    labor_role_atelier_id: random.pick(["r-at", "r-at", "r-mo", "r-x"]),
    h_mo_atelier: random.decimal(0.1, 30, random.int(0, 3)),
    k_mo_atelier: random.pick([1, 1, 1.1, 1.25, null]),
  };
  const chantier = {
    labor_role_chantier_id: random.pick(["r-ch", "r-ch", "r-chef", "r-x"]),
    h_mo_chantier: random.decimal(0.1, 30, random.int(0, 3)),
    k_mo_chantier: random.pick([1, 1, 1.15, null]),
  };
  const noAtelier = { labor_role_atelier_id: null, h_mo_atelier: null, k_mo_atelier: null };
  const noChantier = { labor_role_chantier_id: null, h_mo_chantier: null, k_mo_chantier: null };
  switch (kind) {
    case "atelier":
      return { ...atelier, ...noChantier };
    case "chantier":
      return { ...noAtelier, ...chantier };
    case "roleOnly":
      return { ...noAtelier, labor_role_atelier_id: "r-at", h_mo_atelier: 0, ...noChantier };
    case "coefficientOnly":
      return { ...noAtelier, k_mo_atelier: 1.2, ...noChantier };
    default:
      return { ...atelier, ...chantier };
  }
}

function generateLine(
  random: Random,
  id: string,
  parentId: string | null,
  options: LineOptions
): Partial<Record<ItemColumn, Cell>> {
  const hasSplitPayload = options.splitPayloads && random.chance(0.6);
  return {
    id,
    item_type: "line",
    parent_id: parentId,
    supply_type_id: random.pick(SUPPLY_TYPES),
    quantity: options.magnitude === "capped"
      ? random.int(1_000, MAGNITUDES.capped.maxQuantity)
      : generateQuantity(random, MAGNITUDES[options.magnitude].maxQuantity),
    unit_price_ht_cents: generatePrice(random, options.magnitude),
    tax_rate_bp: options.multiRate
      ? random.pick(LINE_TAX_RATES)
      : random.pick([options.taxRateBp, options.taxRateBp, null]),
    k_fo: random.pick(K_FO),
    labor_role_id: random.pick(LABOR_ROLES),
    h_mo: random.chance(0.4) ? 0 : random.decimal(0.05, 40, random.int(0, 4)),
    h_mo_majoration: random.pick(MAJORATIONS),
    k_mo: random.pick(K_MO),
    ...(hasSplitPayload ? generateSplitPayload(random) : {}),
  };
}

function shuffle<T>(random: Random, values: T[]): T[] {
  const shuffled = values.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = random.int(0, index);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function generateItems(random: Random, empty: boolean, options: LineOptions): Cell[][] {
  const structure = random.pick(["flat", "flat", "nested", "nested", "root", "mixed"]);
  const sectionCount = structure === "root" ? 0 : random.int(1, 4);
  const entries: Array<Partial<Record<ItemColumn, Cell>>> = [];
  const sectionIds: string[] = [];
  for (let index = 1; index <= sectionCount; index += 1) {
    const parentId = structure === "nested" && sectionIds.length > 0 && random.chance(0.6)
      ? random.pick(sectionIds)
      : null;
    const id = `s${index}`;
    sectionIds.push(id);
    entries.push({ id, item_type: "section", parent_id: parentId });
  }
  const lineCount = empty ? 0 : options.magnitude === "capped" ? random.int(2, 4) : random.int(1, 12);
  for (let index = 1; index <= lineCount; index += 1) {
    const parentId = sectionIds.length === 0 || (structure === "mixed" && random.chance(0.35))
      ? null
      : random.pick(sectionIds);
    entries.push(generateLine(random, `l${index}`, parentId, options));
  }

  // Ordre d'arbre (parent avant enfants), positions par parent : celui d'une lecture de devis.
  const ordered: Cell[][] = [];
  const emitChildren = (parentId: string | null) => {
    const children = shuffle(random, entries.filter((entry) => entry.parent_id === parentId));
    children.forEach((child, position) => {
      ordered.push(
        FROZEN_CORPUS_COLUMNS.item.map((column) =>
          column === "position" ? position : (child[column] ?? null)
        )
      );
      if (child.item_type === "section") emitChildren(child.id as string);
    });
  };
  emitChildren(null);
  return ordered;
}

function generateCaseInput(engine: CalcEngineVersion, index: number): FrozenCorpusInput {
  const random = createRandom(caseSeed(engine, index));
  const discountKind = DISCOUNT_KINDS[index % DISCOUNT_KINDS.length];
  const roundingMode =
    ROUNDING_MODES[Math.floor(index / DISCOUNT_KINDS.length) % ROUNDING_MODES.length];
  // 1 cas sur 6 aux paliers de l'entreprise, 1 sur 12 au barème par défaut (indices disjoints).
  const marginKind = index % 6 === 1 ? "tenant" : index % 12 === 4 ? "default" : "fixed";
  const magnitude: Magnitude = CAPPED_CASE_INDEXES.has(index)
    ? "capped"
    : marginKind === "default"
      ? random.pick(["normal", "large", "large"] as const)
      : random.pick(["small", "normal", "normal", "normal", "large"] as const);
  const taxRateBp = random.pick([2_000, 2_000, 2_000, 1_000, 550]);
  const isLaborSplitEnabled = random.chance(0.45);
  const lineOptions: LineOptions = {
    magnitude,
    taxRateBp,
    multiRate: random.chance(0.4),
    splitPayloads: random.chance(isLaborSplitEnabled ? 0.85 : 0.3),
  };
  const version: FrozenCorpusVersion = {
    margin_multiplier: random.pick(MARGIN_MULTIPLIERS),
    margin_mode: marginKind === "fixed" ? "fixed" : "tiered",
    tax_rate_bp: taxRateBp,
    ...generateDiscount(random, discountKind),
    // Tiré, pas indexé : le coefficient doit aussi croiser les deux modes de paliers.
    global_coefficient: random.chance(0.25) ? random.pick(GLOBAL_COEFFICIENTS) : 1,
    rounding_mode: roundingMode,
    rounding_step_cents: roundingMode === "none"
      ? random.pick([0, 100])
      : random.pick([1, 5, 10, 50, 100, 100, 500, 1_000, 0]),
  };
  return {
    version,
    vatReverseCharge: index % 7 === 3,
    isLaborSplitEnabled,
    marginTiers: marginKind === "tenant" ? generateTenantTiers(random) : [],
    laborRates: generateLaborRates(random),
    items: generateItems(random, EMPTY_CASE_INDEXES.has(index), lineOptions),
  };
}

export function generateFrozenCorpusCases(): FrozenCorpusCase[] {
  const cases: FrozenCorpusCase[] = [];
  for (const engine of [1, 2] as const) {
    for (let index = 0; index < FROZEN_CORPUS_CASES_PER_ENGINE; index += 1) {
      // Les sorties se calculent sur l'entrée relue depuis le JSON, exactement comme le test.
      const input = JSON.parse(
        JSON.stringify(canonicalize(generateCaseInput(engine, index), "input"))
      ) as FrozenCorpusInput;
      cases.push({
        id: `v${engine}-${String(index + 1).padStart(3, "0")}`,
        engine,
        input,
        output: computeFrozenCorpusOutput(engine, input),
      });
    }
  }
  return cases;
}

export function serializeFrozenCorpus(
  cases: readonly FrozenCorpusCase[],
  provenance: FrozenCorpusProvenance
): string {
  const lines = cases.map(serializeFrozenCorpusCase);
  const header: Omit<FrozenCorpusFile, "cases"> = {
    format: FROZEN_CORPUS_FORMAT,
    description:
      "Corpus figé des moteurs de calcul 1 et 2 (lot 2, sous-lot 2.0, invariant I1 b). Entrées " +
      "tirées d'une graine fixe ; sorties calculées par les moteurs de la révision indiquée en " +
      "provenance, avant toute modification du lot 2. Ne jamais régénérer pour absorber un " +
      "changement de montant v1/v2. Un cas par ligne ; les lignes et sections tabulées " +
      "commencent par leur identifiant puis suivent `columns`.",
    seed: FROZEN_CORPUS_SEED,
    generator: FROZEN_CORPUS_GENERATOR,
    casesPerEngine: FROZEN_CORPUS_CASES_PER_ENGINE,
    columns: FROZEN_CORPUS_COLUMNS,
    coverage: describeFrozenCorpusCoverage(cases),
    fingerprint: fingerprintFrozenCorpusLines(lines),
    provenance,
  };
  const headerJson = JSON.stringify(header, null, 2);
  return `${headerJson.slice(0, -2)},\n  "cases": [\n${lines.join(",\n")}\n  ]\n}\n`;
}

/* ---------- ligne de commande ---------- */

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function readProvenance(root: string): FrozenCorpusProvenance {
  const tree = git(root, ["ls-tree", "HEAD", "--", ...ENGINE_SOURCE_FILES]) ?? "";
  const blobByPath = new Map(
    tree
      .split("\n")
      .filter(Boolean)
      .map((entry) => {
        const [meta, file] = entry.split("\t");
        return [file, `git-blob:${meta.split(" ")[2]}`] as const;
      })
  );
  return {
    revision: git(root, ["rev-parse", "HEAD"])?.trim() ?? null,
    engineSources: Object.fromEntries(
      ENGINE_SOURCE_FILES.map((file) => [file, blobByPath.get(file) ?? null])
    ),
    node: process.version,
  };
}

function firstDifferingCase(expected: string, actual: string): string {
  const expectedLines = extractFrozenCorpusCaseLines(expected);
  const actualLines = extractFrozenCorpusCaseLines(actual);
  const index = expectedLines.findIndex((line, position) => line !== actualLines[position]);
  if (index < 0) return "en-tête (couverture, colonnes ou empreinte)";
  const id = (JSON.parse(expectedLines[index]) as { id: string }).id;
  return `cas ${id} (ligne de cas ${index + 1})`;
}

function runCli(argv: readonly string[]): number {
  const known = new Set(["--check", "--write", "--force", "--allow-dirty"]);
  const unknown = argv.filter((argument) => !known.has(argument));
  if (unknown.length > 0 || (argv.includes("--write") && argv.includes("--check"))) {
    console.error(
      "Usage : node --import tsx scripts/engine-v3/frozen-corpus.ts [--check | --write [--force] [--allow-dirty]]"
    );
    return 2;
  }
  const root = process.cwd();
  if (!existsSync(path.join(root, FROZEN_CORPUS_GENERATOR))) {
    console.error("À lancer depuis la racine du dépôt.");
    return 2;
  }
  const fixturePath = path.join(root, FROZEN_CORPUS_PATH);

  if (argv.includes("--write")) {
    if (existsSync(fixturePath) && !argv.includes("--force")) {
      console.error(
        `${FROZEN_CORPUS_PATH} existe déjà : le corpus est figé. --force seulement pour un ` +
          "changement de format, jamais pour absorber un changement de montant."
      );
      return 1;
    }
    const status = git(root, ["status", "--porcelain", "--", ...ENGINE_SOURCE_FILES]);
    if ((status === null || status.trim() !== "") && !argv.includes("--allow-dirty")) {
      console.error(
        status === null
          ? "git indisponible : impossible de prouver que les moteurs sont ceux de HEAD."
          : `Moteurs modifiés par rapport à HEAD, génération refusée :\n${status}`
      );
      return 1;
    }
    const cases = generateFrozenCorpusCases();
    const text = serializeFrozenCorpus(cases, readProvenance(root));
    writeFileSync(fixturePath, text, "utf8");
    const file = JSON.parse(text) as FrozenCorpusFile;
    console.log(
      JSON.stringify(
        {
          written: FROZEN_CORPUS_PATH,
          bytes: Buffer.byteLength(text, "utf8"),
          cases: cases.length,
          fingerprint: file.fingerprint,
          provenance: file.provenance,
          coverage: file.coverage,
        },
        null,
        2
      )
    );
    return 0;
  }

  if (!existsSync(fixturePath)) {
    console.error(`${FROZEN_CORPUS_PATH} absent : lancer d'abord --write sur un arbre propre.`);
    return 1;
  }
  const stored = readFileSync(fixturePath, "utf8");
  const storedFile = JSON.parse(stored) as FrozenCorpusFile;
  const regenerated = serializeFrozenCorpus(generateFrozenCorpusCases(), storedFile.provenance);
  if (regenerated !== stored) {
    console.error(
      `Corpus régénéré différent de ${FROZEN_CORPUS_PATH} : ${firstDifferingCase(stored, regenerated)}. ` +
        "Soit un montant v1/v2 a changé (le test engine-frozen-corpus le localise), soit le " +
        "générateur n'est plus déterministe."
    );
    return 1;
  }
  console.log(
    `Corpus identique à l'octet : ${storedFile.cases.length} cas, ${storedFile.fingerprint} ` +
      `(${Buffer.byteLength(stored, "utf8")} octets, généré à ${storedFile.provenance.revision ?? "?"}).`
  );
  return 0;
}

const executedAsCli =
  typeof process.argv[1] === "string" &&
  /frozen-corpus\.(?:[cm]?[jt]s)$/.test(path.basename(process.argv[1]));

if (executedAsCli) {
  process.exitCode = runCli(process.argv.slice(2));
}
