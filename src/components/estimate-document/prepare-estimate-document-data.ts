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
import { isLegacyEngine, isUnifiedEngine } from "@/lib/estimates/engine/capabilities";
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

export function prepareEstimateDocumentData({
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
