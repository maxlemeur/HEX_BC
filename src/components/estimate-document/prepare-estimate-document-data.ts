import {
  computeSectionTotals,
  type EstimateItemRecord,
  type SectionTotals,
} from "@/lib/estimate-calculations";
import { COMPANY_INFO } from "@/lib/company-info";
import { computeEstimateItemNumbering } from "@/lib/estimates/numbering";
import { formatEUR } from "@/lib/money";
import type { Database } from "@/types/database";

export type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
export type EstimateDocumentRow = { item: EstimateItem; depth: number };
export type QrLikeCell = { id: string; enabled: boolean };

type PrepareEstimateDocumentDataInput = {
  items: EstimateItem[];
  marginMultiplier: number;
  discountCents: number;
  taxRateBp: number;
  isLaborSplitEnabled: boolean;
  laborRateById: Record<string, number>;
  validiteJours: number;
  portalUrl?: string | null;
};

export type EstimateDocumentPreparedData = {
  rows: EstimateDocumentRow[];
  numberingById: Record<string, string>;
  sectionTotalsById: Record<string, SectionTotals>;
  taxEnabled: boolean;
  discountLabel: string;
  validiteLabel: string;
  taxLabel: string;
  footerAddress: string;
  qrLikeCells: QrLikeCell[];
};

const ROOT_KEY = "root";

export const EMPTY_SECTION_TOTALS: SectionTotals = {
  foTotalCents: 0,
  moTotalCents: 0,
  moAtelierTotalCents: 0,
  moChantierTotalCents: 0,
  totalHtCents: 0,
  totalTtcCents: 0,
  supplyTypeFoTotalsCents: {},
};

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

function buildRows(items: EstimateItem[]): EstimateDocumentRow[] {
  const map = new Map<string, EstimateItem[]>();
  items.forEach((item) => {
    const key = getParentKey(item.parent_id);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  });
  map.forEach((list) => list.sort((a, b) => a.position - b.position));

  const rows: EstimateDocumentRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const list = map.get(getParentKey(parentId)) ?? [];
    list.forEach((item) => {
      rows.push({ item, depth });
      if (item.item_type === "section") {
        walk(item.id, depth + 1);
      }
    });
  };
  walk(null, 0);
  return rows;
}

export function prepareEstimateDocumentData({
  items,
  marginMultiplier,
  discountCents,
  taxRateBp,
  isLaborSplitEnabled,
  laborRateById,
  validiteJours,
  portalUrl,
}: PrepareEstimateDocumentDataInput): EstimateDocumentPreparedData {
  const rows = buildRows(items);
  const numberingById = computeEstimateItemNumbering(items);
  const sectionTotalsById: Record<string, SectionTotals> = {};
  const calcItems = items as EstimateItemRecord[];
  const laborRateMap = new Map(Object.entries(laborRateById));

  items.forEach((item) => {
    if (item.item_type !== "section") return;
    sectionTotalsById[item.id] = computeSectionTotals({
      items: calcItems,
      sectionId: item.id,
      marginMultiplier,
      discountCents,
      taxRateBp,
      laborRateById: laborRateMap,
      isLaborSplitEnabled,
    });
  });

  const taxEnabled = taxRateBp > 0;
  const discountLabel =
    discountCents > 0 ? `-${formatEUR(discountCents)}` : formatEUR(0);
  const validiteLabel = validiteJours > 0 ? `${validiteJours} jours` : "-";
  const taxLabel = taxEnabled ? `${formatPercent(taxRateBp)} %` : "";
  const footerAddress = `${COMPANY_INFO.address.street} ${COMPANY_INFO.address.postalCode} ${COMPANY_INFO.address.city}`;
  const qrLikeCells = portalUrl ? buildQrLikeCells(portalUrl) : [];

  return {
    rows,
    numberingById,
    sectionTotalsById,
    taxEnabled,
    discountLabel,
    validiteLabel,
    taxLabel,
    footerAddress,
    qrLikeCells,
  };
}
