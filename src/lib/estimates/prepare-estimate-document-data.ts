import {
  buildStoredEstimateBreakdown,
  computeEstimateBreakdown,
  computeReadOnlyTotals,
  computeStoredDiscountCents,
  type EstimateBreakdown,
  type EstimateLineBreakdown,
  type EstimateItemRecord,
  type EstimateVersionForCalc,
  type SectionTotals,
} from "@/lib/estimate-calculations";
import { aggregateEstimateV2Sections } from "@/lib/estimate-v2-snapshot";
import type { CalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import {
  isLegacyEngine,
  isUnifiedEngine,
  usesSaleCoefficients,
  type EstimateEngineVersion,
} from "@/lib/estimates/engine/capabilities";
import {
  ESTIMATE_V3_STORED_INCOHERENT,
  EstimateV3Error,
  readStoredEstimateV3,
  type EstimateV3PricingStatus,
  type StoredEstimateV3Item,
  type StoredEstimateV3Version,
} from "@/lib/estimates/engine-v3";
import {
  columnBounds,
  decimalFromInteger,
  multiply,
  parseDecimal,
  roundHalfUp,
} from "@/lib/estimates/engine-v3/decimal";
import { MEASUREMENT_UNITS } from "@/lib/units/normalize";
import { COMPANY_INFO } from "@/lib/company-info";
import { computeEstimateItemNumbering } from "@/lib/estimates/numbering";
import {
  DEFAULT_ESTIMATE_PDF_LAYOUT,
  normalizeEstimatePdfLayoutOptions,
  type EstimatePdfDetailLevel,
  type EstimatePdfLayoutOptions,
} from "@/lib/estimates/pdf-layout";
import {
  formatCurrency,
  normalizeEstimateCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import type { Database } from "@/types/database";

export type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
/** Actual stored capture metadata; callers never synthesize a fresh revision. */
export type EstimateDocumentCalculationVersion = Partial<Pick<
  EstimateVersionForCalc,
  | "discount_amount_cents"
  | "calc_engine_version"
  | "content_revision"
  | "calc_snapshot_content_revision"
  | "calc_snapshot_context"
  | "status"
  | "discount_bp"
  | "discount_mode"
  | "discount_steps"
>>;
export type EstimateDocumentRow = { item: EstimateItem; depth: number };
export type EstimateDocumentLineSplit = {
  foTotalCents: number;
  moTotalCents: number;
  totalHtCents: number;
};
export type QrLikeCell = { id: string; enabled: boolean };

type PrepareEstimateDocumentDataInput = {
  items: EstimateItem[];
  /**
   * EST-E26 (T6, étape 12) : le document DÉRIVE du moteur d'autorité au lieu de
   * recalculer sa propre version des sections et des lignes. Remplace
   * `marginMultiplier` / `discountCents` / `isLaborSplitEnabled` / `laborRateById`.
   */
  breakdown: EstimateBreakdown;
  calcEngineVersion: CalcEngineVersion;
  taxRateBp: number;
  /** EST-E27 : sous-traitance, TVA autoliquidee — le document ne porte aucune TVA. */
  vatReverseCharge?: boolean;
  currency: string;
  validiteJours: number;
  portalUrl?: string | null;
  maxVisibleSectionLevel?: number | null;
  layout?: EstimatePdfLayoutOptions;
  preserveStoredSnapshot?: boolean;
};

/**
 * Lot 2, sous-lot 2.7 (D7, D8, D14) : entrée du document d'une v3 figée. Aucun `breakdown` : le
 * document relit le gel (`readStoredEstimateV3`) et ne recalcule rien.
 */
export type PrepareEstimateDocumentV3Input = {
  calcEngineVersion: 3;
  items: EstimateItem[];
  /** Colonnes figées v3, contexte figé et intention de remise de la version. */
  version: StoredEstimateV3Version & {
    discount_bp: number;
    discount_amount_cents: number | null;
    tax_rate_bp: number;
  };
  currency: string;
  validiteJours: number;
  portalUrl?: string | null;
  maxVisibleSectionLevel?: number | null;
  layout?: EstimatePdfLayoutOptions;
};

/** Ligne d'un document v3 : valeurs BRUTES publiées (PT = ⌈Q × PU⌋). */
export type EstimateDocumentV3Line = {
  unitCode: string | null;
  /** Symbole du référentiel d'unités (`units.json`), nul sans unité. */
  unitLabel: string | null;
  pricingStatus: EstimateV3PricingStatus;
  taxRateBp: number;
  /** PU brut publié (`pu_ht_cents`), nul sur une ligne non chiffrée. */
  unitSaleHtCents: number | null;
  /** Brut de ligne figé (`snapshot_gross_ht_cents`). */
  saleHtCents: number;
  foSaleHtCents: number;
  moSaleHtCents: number;
};

/** Pied d'un document v3 : brut, remise, arrondi commercial, HT net, TVA par taux (gel), TTC. */
export type EstimateDocumentV3Totals = {
  grossHtCents: number;
  discount: { kind: "none" | "amount" | "rate"; rateBp: number | null; appliedCents: number };
  commercialRoundingCents: number;
  netHtCents: number;
  taxByRate: Array<{ rateBp: number; baseHtCents: number; taxCents: number }>;
  taxCents: number;
  payableTtcCents: number;
  reverseCharge: boolean;
};

export type EstimateDocumentPreparedData = {
  rows: EstimateDocumentRow[];
  numberingById: Record<string, string>;
  sectionTotalsById: Record<string, SectionTotals>;
  lineSplitsById: Record<string, EstimateDocumentLineSplit>;
  lineUnitPriceHtById: Record<string, number>;
  layout: EstimatePdfLayoutOptions;
  taxEnabled: boolean;
  vatReverseCharge: boolean;
  discountLabel: string;
  validiteLabel: string;
  taxLabel: string;
  footerAddress: string;
  qrLikeCells: QrLikeCell[];
};

export type EstimateDocumentV3PreparedData = EstimateDocumentPreparedData & {
  v3: { linesById: Record<string, EstimateDocumentV3Line>; totals: EstimateDocumentV3Totals };
};

const ROOT_KEY = "root";

/**
 * EST-E26 (T6, étape 12) : le rendu document reste sur le moteur historique tant
 * que la bascule `calc_engine_version` n'a pas eu lieu — les devis existants sont
 * tous en v1, et une version `sent`/`accepted` ne doit pas changer de total.
 */
export const DOCUMENT_CALC_ENGINE_VERSION: CalcEngineVersion = 1;

/**
 * Construit le breakdown du document à partir des grandeurs déjà résolues par
 * l'appelant.
 *
 * La marge, les paliers et la cascade sont neutralisés parce que les appelants
 * fournissent déjà le multiplicateur résolu et le montant de remise absolu. Le
 * coefficient reste neutralisé en v1 pour préserver le rendu historique ; en
 * v2 il est transmis au moteur afin que lignes, sections et pied restent
 * réconciliés.
 *
 * Remplacé par `buildEstimateRenderModel` à l'étape 14, qui portera les vraies
 * grandeurs de version.
 */
export function buildLegacyDocumentBreakdown({
  items,
  marginMultiplier,
  discountCents,
  taxRateBp,
  isLaborSplitEnabled,
  laborRateById,
  calcEngineVersion = DOCUMENT_CALC_ENGINE_VERSION,
  globalCoefficient = 1,
  preserveStoredSnapshot = false,
  versionTotals,
}: {
  items: EstimateItem[];
  marginMultiplier: number;
  discountCents: number;
  taxRateBp: number;
  isLaborSplitEnabled: boolean;
  laborRateById: Record<string, number>;
  /**
   * Moteur de la VERSION rendue, via `resolveCalcEngineVersion(version)`.
   * Le repli sur la constante ne sert qu'aux appelants sans ligne de version
   * en portée (tests, aperçus).
   */
  calcEngineVersion?: CalcEngineVersion;
  /**
   * Le moteur v2 répartit le coefficient sur les lignes et sections. Le moteur
   * v1 conserve son rendu historique, où cette grandeur était déjà absorbée
   * dans les totaux stockés mais pas redescendue dans le détail.
   */
  globalCoefficient?: number | null;
  preserveStoredSnapshot?: boolean;
  versionTotals?: {
    total_ht_cents: number | null;
    /** TVA comptable, hors arrondi commercial. */
    total_tax_cents: number | null;
    total_ttc_cents: number | null;
    rounding_adjustment_cents?: number | null;
  } & EstimateDocumentCalculationVersion;
}): EstimateBreakdown {
  if (isLegacyEngine(calcEngineVersion) && preserveStoredSnapshot) {
    const version: EstimateVersionForCalc = {
      ...versionTotals,
      margin_multiplier: marginMultiplier,
      tax_rate_bp: taxRateBp,
      discount_bp: versionTotals?.discount_bp ?? 0,
      global_coefficient: globalCoefficient,
    };
    const totals = computeReadOnlyTotals({
      items,
      version,
      discountCents: computeStoredDiscountCents(version, items),
      laborRateById: new Map(),
      isLaborSplitEnabled: false,
      marginTiers: [],
      roundingMode: "none",
      roundingStepCents: 0,
      calcEngineVersion,
    });
    // V1 stores gross lines and a net footer. Preserve both; no allocation or
    // present-day labor rate may change its historical document amounts.
    const lineById = new Map<string, EstimateLineBreakdown>();
    let sumGrossCents = 0;
    for (const item of items) {
      if (item.item_type !== "line") continue;
      const grossCents = item.line_total_ht_cents ?? 0;
      const hasStoredSplit = hasCoherentStoredV1Split(item);
      const moCents = hasStoredSplit ? item.snapshot_mo_ht_cents! : 0;
      const atelierCents = Number.isInteger(item.snapshot_mo_atelier_ht_cents)
        && (item.snapshot_mo_atelier_ht_cents ?? -1) >= 0
        && (item.snapshot_mo_atelier_ht_cents ?? 0) <= moCents
        ? item.snapshot_mo_atelier_ht_cents! : 0;
      sumGrossCents += grossCents;
      lineById.set(item.id, {
        costLineCents: 0,
        saleGrossCents: grossCents,
        coefficientShareCents: grossCents,
        discountShareCents: 0,
        saleNetHtCents: grossCents,
        foNetCents: hasStoredSplit ? item.snapshot_fo_ht_cents! : 0,
        moNetCents: moCents,
        moAtelierNetCents: atelierCents,
        moChantierNetCents: moCents - atelierCents,
        puNetHtCents: item.pu_ht_cents ?? 0,
        taxCents: item.line_tax_cents ?? 0,
      });
    }
    // This is only tree aggregation; V2's net-line/footer invariant does not
    // apply to the historical V1 gross-line document.
    const sections = aggregateEstimateV2Sections(items, lineById);
    return {
      totals,
      lineById,
      ...sections,
      invariants: {
        sumAllocatedHtCents: sumGrossCents,
        matchesFooter: sumGrossCents === totals.saleTotalCents,
      },
    };
  }
  if (isUnifiedEngine(calcEngineVersion) && preserveStoredSnapshot) {
    return buildStoredEstimateBreakdown({
      items: items as EstimateItemRecord[],
      version: {
        discount_amount_cents: versionTotals?.discount_amount_cents,
        calc_engine_version: versionTotals?.calc_engine_version,
        content_revision: versionTotals?.content_revision,
        calc_snapshot_content_revision: versionTotals?.calc_snapshot_content_revision,
        calc_snapshot_context: versionTotals?.calc_snapshot_context,
        margin_multiplier: marginMultiplier,
        discount_mode: "simple",
        global_coefficient: globalCoefficient,
        total_ht_cents: versionTotals?.total_ht_cents,
        total_tax_cents:
          (versionTotals?.total_tax_cents ?? 0) +
          (versionTotals?.rounding_adjustment_cents ?? 0),
        total_ttc_cents: versionTotals?.total_ttc_cents,
        rounding_adjustment_cents:
          versionTotals?.rounding_adjustment_cents,
      },
    });
  }
  const laborRateMap = new Map(Object.entries(laborRateById));
  return computeEstimateBreakdown({
    items: items as EstimateItemRecord[],
    marginMultiplier,
    marginMode: "fixed",
    marginTiers: [],
    globalCoefficient:
      isUnifiedEngine(calcEngineVersion) ? (globalCoefficient ?? 1) : 1,
    discountMode: "simple",
    discountCents,
    discountStepsBp: [],
    taxRateBp,
    roundingMode: "none",
    roundingStepCents: 0,
    isLaborSplitEnabled,
    laborRateById: laborRateMap,
    laborRateAtelierById: laborRateMap,
    laborRateChantierById: laborRateMap,
    calcEngineVersion,
  });
}

export const EMPTY_SECTION_TOTALS: SectionTotals = {
  foTotalCents: 0,
  moTotalCents: 0,
  moAtelierTotalCents: 0,
  moChantierTotalCents: 0,
  totalHtCents: 0,
  totalTtcCents: 0,
  supplyTypeFoTotalsCents: {},
};

function hasCoherentStoredV1Split(item: EstimateItem): boolean {
  return Number.isInteger(item.snapshot_fo_ht_cents)
    && Number.isInteger(item.snapshot_mo_ht_cents)
    && (item.snapshot_fo_ht_cents ?? -1) >= 0
    && (item.snapshot_mo_ht_cents ?? -1) >= 0
    && item.snapshot_fo_ht_cents! + item.snapshot_mo_ht_cents!
      === item.line_total_ht_cents;
}

function getParentKey(value: string | null) {
  return value ?? ROOT_KEY;
}

function formatPercent(bp: number): string {
  const value = bp / 100;
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(value);
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildQrLikeCells(value: string, size = 21): QrLikeCell[] {
  const matrix = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false)
  );
  const reserved = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false)
  );

  const markReserved = (
    startX: number,
    startY: number,
    width: number,
    height: number
  ) => {
    for (let y = startY; y < startY + height; y += 1) {
      for (let x = startX; x < startX + width; x += 1) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        reserved[y][x] = true;
      }
    }
  };

  const drawFinder = (originX: number, originY: number) => {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const px = originX + x;
        const py = originY + y;
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        const isOuter = x === 0 || y === 0 || x === 6 || y === 6;
        const isInner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        matrix[py][px] = isOuter || isInner;
      }
    }
    markReserved(originX - 1, originY - 1, 9, 9);
  };

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  for (let i = 8; i < size - 8; i += 1) {
    const marker = i % 2 === 0;
    matrix[6][i] = marker;
    matrix[i][6] = marker;
    reserved[6][i] = true;
    reserved[i][6] = true;
  }

  let seed = hashText(value);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (reserved[y][x]) continue;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const randomBit = ((seed >>> 30) & 1) === 1;
      const patternBit = ((x * 3 + y * 5 + (seed & 0x0f)) % 7) < 3;
      matrix[y][x] = randomBit !== patternBit;
    }
  }

  return matrix.flatMap((row, y) =>
    row.map((enabled, x) => ({
      id: `${x}-${y}`,
      enabled,
    }))
  );
}

function buildRows(
  items: EstimateItem[],
  detailLevel: EstimatePdfDetailLevel
): EstimateDocumentRow[] {
  const map = new Map<string, EstimateItem[]>();
  items.forEach((item) => {
    const key = getParentKey(item.parent_id);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  });
  map.forEach((list) => list.sort((a, b) => a.position - b.position));

  const rows: EstimateDocumentRow[] = [];
  const hideLineDetails = detailLevel !== "lines";
  const walk = (parentId: string | null, depth: number) => {
    const list = map.get(getParentKey(parentId)) ?? [];
    list.forEach((item) => {
      if (item.item_type === "section") {
        const sectionLevel = depth + 1;
        if (
          detailLevel !== "lines" &&
          sectionLevel > detailLevel
        ) {
          return;
        }
        rows.push({ item, depth });
        walk(item.id, depth + 1);
        return;
      }

      if (!hideLineDetails) {
        rows.push({ item, depth });
      }
    });
  };
  walk(null, 0);
  return rows;
}

export function summarizeEstimateDocumentStructure(items: EstimateItem[]) {
  const sectionCountsByLevel: Record<"1" | "2" | "3" | "4", number> = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
  };
  const childrenByParentId = new Map<string, EstimateItem[]>();
  items.forEach((item) => {
    const key = getParentKey(item.parent_id);
    const children = childrenByParentId.get(key) ?? [];
    children.push(item);
    childrenByParentId.set(key, children);
  });

  const walk = (parentId: string | null, depth: number) => {
    const children = childrenByParentId.get(getParentKey(parentId)) ?? [];
    children.forEach((item) => {
      if (item.item_type !== "section") return;
      const level = Math.min(depth + 1, 4) as 1 | 2 | 3 | 4;
      sectionCountsByLevel[String(level) as "1" | "2" | "3" | "4"] += 1;
      walk(item.id, depth + 1);
    });
  };
  walk(null, 0);

  return {
    lineCount: items.filter((item) => item.item_type === "line").length,
    sectionCountsByLevel,
  };
}

function resolveDocumentLayout(
  layout: EstimatePdfLayoutOptions | undefined,
  maxVisibleSectionLevel: number | null
): EstimatePdfLayoutOptions {
  return normalizeEstimatePdfLayoutOptions(
    layout ?? {
      ...DEFAULT_ESTIMATE_PDF_LAYOUT,
      detailLevel: maxVisibleSectionLevel ?? "lines",
    }
  );
}

const UNIT_SYMBOL_BY_CODE = new Map(MEASUREMENT_UNITS.map((unit) => [unit.code, unit.symbol]));
const STORED_QUANTITY_BOUNDS = columnBounds(12, 3);

function incoherent(field: string, reason: string): EstimateV3Error {
  return new EstimateV3Error(
    ESTIMATE_V3_STORED_INCOHERENT,
    `Version v3 figée incohérente (${field}) : ${reason}.`,
    field
  );
}

/** ⌈Q × PU⌋ en décimal exact (A4), sur la quantité stockée (`numeric(12,3)`). */
function storedLineGross(item: EstimateItem, unitSaleHtCents: number): bigint {
  try {
    const quantity = parseDecimal(item.quantity, `items[${item.id}].quantity`, STORED_QUANTITY_BOUNDS);
    return roundHalfUp(multiply(quantity, decimalFromInteger(BigInt(unitSaleHtCents))));
  } catch {
    throw incoherent(`items[${item.id}].quantity`, "quantité illisible");
  }
}

/** Colonnes figées d'une ligne v3 (les colonnes de M4 sont optionnelles dans le type de ligne). */
function toStoredV3Item(item: EstimateItem): StoredEstimateV3Item {
  return {
    id: item.id,
    item_type: item.item_type,
    pricing_status: item.pricing_status ?? null,
    tax_rate_bp: item.tax_rate_bp,
    pu_ht_cents: item.pu_ht_cents,
    snapshot_gross_ht_cents: item.snapshot_gross_ht_cents ?? null,
    snapshot_gross_fo_ht_cents: item.snapshot_gross_fo_ht_cents ?? null,
    line_total_ht_cents: item.line_total_ht_cents,
    line_tax_cents: item.line_tax_cents,
    line_total_ttc_cents: item.line_total_ttc_cents,
    snapshot_fo_ht_cents: item.snapshot_fo_ht_cents,
    snapshot_mo_ht_cents: item.snapshot_mo_ht_cents,
    snapshot_mo_atelier_ht_cents: item.snapshot_mo_atelier_ht_cents,
    snapshot_mo_chantier_ht_cents: item.snapshot_mo_chantier_ht_cents,
  };
}

type StoredDiscountSummary = { kind?: unknown; requested_cents?: unknown; rate_bp?: unknown; applied_cents?: unknown };
type StoredRoundingSummary = { applied_cents?: unknown };

/** Intention de remise lue sur le contexte figé, contrôlée contre la version (jamais dérivée). */
function readStoredV3Discount(
  version: PrepareEstimateDocumentV3Input["version"],
  appliedCents: number,
  commercialRoundingCents: number
): EstimateDocumentV3Totals["discount"] {
  const context = version.calc_snapshot_context as { discount?: StoredDiscountSummary; commercial_rounding?: StoredRoundingSummary };
  const discount = context.discount ?? {};
  const expectedKind = version.discount_amount_cents !== null ? "amount" : version.discount_bp > 0 ? "rate" : "none";
  if (discount.kind !== expectedKind || discount.applied_cents !== appliedCents
    || (expectedKind === "amount" && discount.requested_cents !== version.discount_amount_cents)
    || (expectedKind === "rate" && discount.rate_bp !== version.discount_bp)) {
    throw incoherent("calc_snapshot_context.discount", "intention ou remise appliquée ≠ version");
  }
  if (context.commercial_rounding?.applied_cents !== commercialRoundingCents) {
    throw incoherent("calc_snapshot_context.commercial_rounding", "arrondi appliqué ≠ version");
  }
  return { kind: expectedKind, rateBp: expectedKind === "rate" ? version.discount_bp : null, appliedCents };
}

/**
 * Document d'une v3 figée (D7, D8, D14) : lignes et sections en BRUT (PU publié, brut de ligne,
 * parts FO/MO brutes), pied du gel (remise, arrondi commercial, HT net, TVA par taux du contexte,
 * TTC). Toute incohérence du gel est refusée (`ESTIMATE_V3_STORED_INCOHERENT`), y compris un PT
 * ≠ ⌈Q × PU⌋ sur une ligne chiffrée : le document n'imprime jamais un gel qu'il devrait réparer.
 */
export function prepareEstimateV3DocumentData(input: PrepareEstimateDocumentV3Input): EstimateDocumentV3PreparedData {
  const { items, version } = input;
  const resolvedCurrency: SupportedEstimateCurrency = normalizeEstimateCurrency(input.currency) ?? "EUR";
  const resolvedLayout = resolveDocumentLayout(input.layout, input.maxVisibleSectionLevel ?? null);
  const stored = readStoredEstimateV3({ version, items: items.map(toStoredV3Item) });
  const storedById = new Map(stored.lines.map((line) => [line.id, line]));
  const linesById: Record<string, EstimateDocumentV3Line> = {};
  const lineSplitsById: Record<string, EstimateDocumentLineSplit> = {};
  const lineUnitPriceHtById: Record<string, number> = {};
  for (const item of items) {
    if (item.item_type !== "line") continue;
    const line = storedById.get(item.id)!;
    const unitCode = item.unit_code ?? null;
    const unitLabel = unitCode === null ? null : (UNIT_SYMBOL_BY_CODE.get(unitCode) ?? null);
    if (unitCode !== null && unitLabel === null) throw incoherent(`items[${item.id}].unit_code`, "unité absente du référentiel");
    const priced = line.pricing_status === "priced";
    if (priced) {
      if (unitCode === null) throw incoherent(`items[${item.id}].unit_code`, "unité absente sur une ligne chiffrée");
      // Le PU publié est figé deux fois (D7) : le contrat 2 lit `snapshot_pu_ht_cents`, comme le SQL.
      if (item.snapshot_pu_ht_cents !== line.pu_ht_cents) {
        throw incoherent(`items[${item.id}].snapshot_pu_ht_cents`, "PU figé ≠ PU publié");
      }
      if (storedLineGross(item, line.pu_ht_cents!) !== BigInt(line.gross_ht_cents)) {
        throw incoherent(`items[${item.id}].snapshot_gross_ht_cents`, "PT ≠ ⌈Q × PU⌋");
      }
      lineUnitPriceHtById[item.id] = line.pu_ht_cents!;
    }
    linesById[item.id] = {
      unitCode,
      unitLabel,
      pricingStatus: line.pricing_status as EstimateV3PricingStatus,
      taxRateBp: line.tax_rate_bp,
      unitSaleHtCents: priced ? line.pu_ht_cents : null,
      saleHtCents: line.gross_ht_cents,
      foSaleHtCents: line.gross_fo_ht_cents,
      moSaleHtCents: line.gross_mo_ht_cents,
    };
    lineSplitsById[item.id] = {
      foTotalCents: line.gross_fo_ht_cents,
      moTotalCents: line.gross_mo_ht_cents,
      totalHtCents: line.gross_ht_cents,
    };
  }

  // Sous-totaux de section : Σ des bruts des lignes descendantes (aucun net en v3, D7).
  // Ni TTC ni ventilation atelier/chantier bruts ne sont figés par section : laissés à 0.
  const itemById = new Map(items.map((item) => [item.id, item]));
  const sectionTotalsById: Record<string, SectionTotals> = {};
  for (const item of items) {
    if (item.item_type === "section") sectionTotalsById[item.id] = { ...EMPTY_SECTION_TOTALS, supplyTypeFoTotalsCents: {} };
  }
  for (const item of items) {
    if (item.item_type !== "line") continue;
    const split = lineSplitsById[item.id];
    let parentId = item.parent_id;
    for (let guard = 0; parentId !== null && guard <= items.length; guard += 1) {
      const totals = sectionTotalsById[parentId];
      if (!totals) throw incoherent(`items[${item.id}].parent_id`, "section parente absente");
      totals.totalHtCents += split.totalHtCents;
      totals.foTotalCents += split.foTotalCents;
      totals.moTotalCents += split.moTotalCents;
      parentId = itemById.get(parentId)?.parent_id ?? null;
    }
  }

  const reverseCharge = version.contractor_role === "subcontractor";
  const totals: EstimateDocumentV3Totals = {
    grossHtCents: stored.totals.gross_ht_cents,
    discount: readStoredV3Discount(version, stored.totals.discount_applied_cents, stored.totals.commercial_rounding_cents),
    commercialRoundingCents: stored.totals.commercial_rounding_cents,
    netHtCents: stored.totals.total_ht_cents,
    // Le récapitulatif imprimé est celui du gel validé (`tax_breakdown`), jamais recalculé.
    taxByRate: stored.tax_breakdown.map((row) => ({ rateBp: row.rate_bp, baseHtCents: row.base_cents, taxCents: row.tax_cents })),
    taxCents: stored.totals.total_tax_cents,
    payableTtcCents: stored.totals.total_ttc_cents,
    reverseCharge,
  };
  const discountCents = totals.discount.appliedCents;
  const rates = totals.taxByRate.map((row) => `${formatPercent(row.rateBp)} %`);
  return {
    rows: buildRows(items, resolvedLayout.detailLevel),
    numberingById: computeEstimateItemNumbering(items),
    sectionTotalsById,
    lineSplitsById,
    lineUnitPriceHtById,
    layout: resolvedLayout,
    taxEnabled: !reverseCharge,
    vatReverseCharge: reverseCharge,
    discountLabel: discountCents > 0 ? `-${formatCurrency(discountCents, resolvedCurrency)}` : formatCurrency(0, resolvedCurrency),
    validiteLabel: input.validiteJours > 0 ? `${input.validiteJours} jours` : "-",
    taxLabel: reverseCharge ? "" : (rates.length > 0 ? rates.join(" · ") : `${formatPercent(version.tax_rate_bp)} %`),
    footerAddress: `${COMPANY_INFO.registeredOffice.street} ${COMPANY_INFO.registeredOffice.postalCode} ${COMPANY_INFO.registeredOffice.city}`,
    qrLikeCells: input.portalUrl ? buildQrLikeCells(input.portalUrl) : [],
    v3: { linesById, totals },
  };
}

/**
 * Document d'une version. Moteurs 1 et 2 : dérivé du breakdown d'autorité (inchangé). Une entrée
 * v3 (`calcEngineVersion: 3`, sous-lot 2.7) est aiguillée à l'exécution vers le document du gel v3
 * (`prepareEstimateV3DocumentData`) : un moteur 3 n'est jamais relu par le moteur historique.
 */
export function prepareEstimateDocumentData(input: PrepareEstimateDocumentDataInput): EstimateDocumentPreparedData {
  const engine = input.calcEngineVersion as EstimateEngineVersion;
  return usesSaleCoefficients(engine)
    ? prepareEstimateV3DocumentData(input as unknown as PrepareEstimateDocumentV3Input)
    : prepareHistoricalEstimateDocumentData(input);
}

function prepareHistoricalEstimateDocumentData({
  items,
  breakdown,
  calcEngineVersion,
  taxRateBp,
  vatReverseCharge,
  currency,
  validiteJours,
  portalUrl,
  maxVisibleSectionLevel = null,
  layout,
  preserveStoredSnapshot = false,
}: PrepareEstimateDocumentDataInput): EstimateDocumentPreparedData {
  const resolvedCurrency: SupportedEstimateCurrency =
    normalizeEstimateCurrency(currency) ?? "EUR";
  const resolvedLayout = normalizeEstimatePdfLayoutOptions(
    layout ?? {
      ...DEFAULT_ESTIMATE_PDF_LAYOUT,
      detailLevel: maxVisibleSectionLevel ?? "lines",
    }
  );
  if (isLegacyEngine(calcEngineVersion) && preserveStoredSnapshot
    && resolvedLayout.priceMode === "fo_mo_and_total"
    && !items.filter((item) => item.item_type === "line")
      .every(hasCoherentStoredV1Split)) {
    resolvedLayout.priceMode = "unit_and_total";
  }
  const rows = buildRows(items, resolvedLayout.detailLevel);
  const numberingById = computeEstimateItemNumbering(items);
  const discountCents = breakdown.totals.discountCents;
  const sectionTotalsById = Object.fromEntries(
    breakdown.sectionById.entries()
  ) as Record<string, SectionTotals>;

  // Les lignes hors chapitre (`breakdown.rootLineIds`) restent des lignes libres
  // au niveau 0 : elles ne sont jamais sous-totalisées, mais elles COMPTENT au
  // total (le pied vient du breakdown, pas d'une somme de sections).
  const lineSplitsById = Object.fromEntries(
    items
      .filter((item) => item.item_type === "line")
      .map((item) => {
        const line = breakdown.lineById.get(item.id);
        if (!line) {
          return [item.id, { foTotalCents: 0, moTotalCents: 0, totalHtCents: 0 }];
        }

        if (isUnifiedEngine(calcEngineVersion)) {
          // Moteur réconcilié : la ligne est déjà NETTE de coefficient et de
          // remise, donc Σ lignes === Σ sections === pied, au centime.
          return [
            item.id,
            {
              foTotalCents: line.foNetCents,
              moTotalCents: line.moNetCents,
              totalHtCents: line.saleNetHtCents,
            },
          ];
        }

        // SHIM DE COMPATIBILITÉ v1 — supprimable à la bascule v2.
        // Le moteur historique ne redescend ni le coefficient ni la remise : la
        // ligne recalculée ne somme pas au pied stocké. On conserve donc le
        // rebasage sur `line_total_ht_cents` (comportement d'avant EST-E26), au
        // lieu de le déplacer dans le moteur — où il corromprait les autres
        // consommateurs v1 (la passe COÛT de l'analyse de marge rebaserait un
        // coût sur une valeur de vente).
        const storedTotal = Number.isFinite(item.line_total_ht_cents ?? NaN)
          ? Math.max(item.line_total_ht_cents ?? 0, 0)
          : line.saleNetHtCents;
        const proportionalMo =
          line.saleNetHtCents > 0
            ? Math.round((line.moNetCents * storedTotal) / line.saleNetHtCents)
            : 0;
        const moTotalCents = Math.min(Math.max(proportionalMo, 0), storedTotal);

        return [
          item.id,
          {
            foTotalCents: storedTotal - moTotalCents,
            moTotalCents,
            totalHtCents: storedTotal,
          },
        ];
      })
  ) as Record<string, EstimateDocumentLineSplit>;
  const lineUnitPriceHtById = Object.fromEntries(
    items
      .filter((item) => item.item_type === "line")
      .map((item) => [
        item.id,
        isUnifiedEngine(calcEngineVersion)
          ? (breakdown.lineById.get(item.id)?.puNetHtCents ??
            item.snapshot_pu_ht_cents ??
            item.pu_ht_cents ??
            0)
          : (item.pu_ht_cents ?? 0),
      ])
  );

  // EST-E27 : en autoliquidation le document ne porte AUCUNE ligne de TVA, quel
  // que soit le taux de la version. La mention legale la remplace.
  const taxEnabled = !vatReverseCharge && taxRateBp > 0;
  const discountLabel =
    discountCents > 0
      ? `-${formatCurrency(discountCents, resolvedCurrency)}`
      : formatCurrency(0, resolvedCurrency);
  const validiteLabel = validiteJours > 0 ? `${validiteJours} jours` : "-";
  const taxLabel = taxEnabled ? `${formatPercent(taxRateBp)} %` : "";
  const footerAddress = `${COMPANY_INFO.registeredOffice.street} ${COMPANY_INFO.registeredOffice.postalCode} ${COMPANY_INFO.registeredOffice.city}`;
  const qrLikeCells = portalUrl ? buildQrLikeCells(portalUrl) : [];

  return {
    rows,
    numberingById,
    sectionTotalsById,
    lineSplitsById,
    lineUnitPriceHtById,
    layout: resolvedLayout,
    taxEnabled,
    vatReverseCharge: vatReverseCharge === true,
    discountLabel,
    validiteLabel,
    taxLabel,
    footerAddress,
    qrLikeCells,
  };
}
