import { readImportRowStructure } from "./payload";

type JsonRecord = Record<string, unknown>;

export type ImportStructureDecisionKind = "section" | "line" | "ignore";
export type ImportStructureLevel = 1 | 2;

export type ImportStructureDecision =
  | {
      rowIndex: number;
      kind: "section";
      level: ImportStructureLevel;
    }
  | {
      rowIndex: number;
      kind: "line" | "ignore";
      level: null;
    };

export type ImportStructureRow = {
  id: string;
  rowIndex: number;
  rawRow: JsonRecord;
  mappedRow: JsonRecord;
};

export type ImportStructureCandidate = {
  row_index: number;
  title: string;
  confidence: "high" | "medium";
  suggested_kind: "section" | "line";
  suggested_level: 1 | null;
  reasons: string[];
  sheet_name: string | null;
  source_row_number: number | null;
};

export type ImportStructurePreview = {
  candidates: ImportStructureCandidate[];
  footer_row_indexes: number[];
  summary: {
    total_rows: number;
    candidate_rows: number;
    high_confidence_candidates: number;
    medium_confidence_candidates: number;
    zero_price_rows: number;
    ignored_footer_rows: number;
    footer_start_row_index: number | null;
  };
};

export type ResolvedImportStructure = {
  preview: ImportStructurePreview;
  decisionsByRowIndex: Map<number, ImportStructureDecision>;
  footerRowIndexes: Set<number>;
};

const FOOTER_TITLE_PATTERN = /^(?:sous[- ]?total|total(?:\s+(?:h\.?t\.?|t\.?t\.?c\.?|general))?|totaux)\b/i;
const LEGAL_FOOTER_TITLE_PATTERN =
  /^(?:conditions?\s+(?:generales?|particulieres?|de\s+validite)|mentions?\s+legales?|validite\s+(?:de\s+)?(?:l['’])?offre|offre\s+valable|(?:les|nos)\s+prix\s+(?:sont|restent)|toute\s+commande|bon\s+pour\s+accord)\b/i;
const EMPTY_SENTINELS = new Set(["", "-", "--", "—", "–", "pm", "p.m.", "n/a", "na"]);

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeToken(value: unknown) {
  return stripAccents(asText(value).toLowerCase()).replace(/\s+/g, " ").trim();
}

function isEmptyLike(value: unknown) {
  return EMPTY_SENTINELS.has(normalizeToken(value));
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const raw = value.trim().replace(/[\s\u00A0]/g, "").replace(/[^0-9,.\-]/g, "");
  if (!raw) return null;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalIndex = Math.max(lastComma, lastDot);
    const digits = raw.replace(/[,.]/g, "");
    const decimalLength = raw.length - decimalIndex - 1;
    normalized =
      decimalLength > 0
        ? `${digits.slice(0, digits.length - decimalLength)}.${digits.slice(-decimalLength)}`
        : digits;
  } else if (lastComma >= 0) {
    normalized = (raw.match(/,/g) ?? []).length > 1 ? raw.replace(/,/g, "") : raw.replace(",", ".");
  } else if ((raw.match(/\./g) ?? []).length > 1) {
    normalized = raw.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasUsablePrice(mappedRow: JsonRecord) {
  const unitPrice = parseNumericValue(mappedRow.unit_price_ht);
  const total = parseNumericValue(mappedRow.total_ht);
  return (unitPrice !== null && unitPrice > 0) || (total !== null && total > 0);
}

function resolveTitle(mappedRow: JsonRecord) {
  return asText(mappedRow.designation) || asText(mappedRow.reference ?? mappedRow.hex_code);
}

function isFooterTitle(title: string) {
  return [FOOTER_TITLE_PATTERN, LEGAL_FOOTER_TITLE_PATTERN].some((pattern) =>
    pattern.test(stripAccents(title))
  );
}

function isDesignationBold(row: ImportStructureRow, title: string) {
  const structure = readImportRowStructure(row.rawRow);
  if (!structure) return false;

  return structure.bold_columns.some(
    (column) => normalizeToken(row.rawRow[column]) === normalizeToken(title)
  );
}

function isDesignationMerged(row: ImportStructureRow, title: string) {
  const structure = readImportRowStructure(row.rawRow);
  if (!structure) return false;

  return structure.merged_columns.some(
    (column) => normalizeToken(row.rawRow[column]) === normalizeToken(title)
  );
}

function buildCandidate(row: ImportStructureRow): ImportStructureCandidate | null {
  const title = resolveTitle(row.mappedRow);
  if (!title || hasUsablePrice(row.mappedRow)) return null;

  const structure = readImportRowStructure(row.rawRow);
  const designationIsBold = isDesignationBold(row, title);
  const designationIsMerged = isDesignationMerged(row, title);
  const semanticTitleShape =
    isEmptyLike(row.mappedRow.quantity) && isEmptyLike(row.mappedRow.unit);

  if (!designationIsBold && !semanticTitleShape) return null;

  const reasons = ["no_price"];
  if (designationIsBold) reasons.unshift("bold_designation");
  if (designationIsMerged) reasons.push("merged_designation");
  if (semanticTitleShape) reasons.push("semantic_title_shape");
  if (structure?.outline_level) reasons.push("outline_level");

  return {
    row_index: row.rowIndex,
    title,
    confidence: designationIsBold ? "high" : "medium",
    suggested_kind: designationIsBold ? "section" : "line",
    suggested_level: designationIsBold ? 1 : null,
    reasons,
    sheet_name: structure?.sheet_name ?? null,
    source_row_number: structure?.source_row_number ?? null,
  };
}

export function analyzeImportStructure(rows: ImportStructureRow[]): ImportStructurePreview {
  const sortedRows = [...rows].sort((left, right) => left.rowIndex - right.rowIndex);
  const candidates: ImportStructureCandidate[] = [];
  const footerRowIndexes: number[] = [];
  let footerStarted = false;
  let footerStartRowIndex: number | null = null;
  let zeroPriceRows = 0;

  for (const row of sortedRows) {
    const title = resolveTitle(row.mappedRow);
    if (!footerStarted && title && isFooterTitle(title)) {
      footerStarted = true;
      footerStartRowIndex = row.rowIndex;
    }

    if (footerStarted) {
      footerRowIndexes.push(row.rowIndex);
      continue;
    }

    const candidate = buildCandidate(row);
    if (candidate) candidates.push(candidate);

    const defaultsToSection = candidate?.suggested_kind === "section";
    if (title && !defaultsToSection && !hasUsablePrice(row.mappedRow)) {
      zeroPriceRows += 1;
    }
  }

  return {
    candidates,
    footer_row_indexes: footerRowIndexes,
    summary: {
      total_rows: rows.length,
      candidate_rows: candidates.length,
      high_confidence_candidates: candidates.filter(
        (candidate) => candidate.confidence === "high"
      ).length,
      medium_confidence_candidates: candidates.filter(
        (candidate) => candidate.confidence === "medium"
      ).length,
      zero_price_rows: zeroPriceRows,
      ignored_footer_rows: footerRowIndexes.length,
      footer_start_row_index: footerStartRowIndex,
    },
  };
}

export function resolveImportStructure(
  rows: ImportStructureRow[],
  decisions: ImportStructureDecision[] = []
): ResolvedImportStructure {
  const preview = analyzeImportStructure(rows);
  const candidatesByRowIndex = new Map(
    preview.candidates.map((candidate) => [candidate.row_index, candidate])
  );
  const explicitDecisions = new Map<number, ImportStructureDecision>();

  for (const decision of decisions) {
    if (explicitDecisions.has(decision.rowIndex)) {
      throw new Error(`La ligne ${decision.rowIndex + 1} possède plusieurs décisions de structure.`);
    }
    if (!candidatesByRowIndex.has(decision.rowIndex)) {
      throw new Error(`La ligne ${decision.rowIndex + 1} n'est pas un titre révisable.`);
    }
    if (decision.kind === "section" && decision.level !== 1 && decision.level !== 2) {
      throw new Error(`Un niveau 1 ou 2 est requis pour la ligne ${decision.rowIndex + 1}.`);
    }
    if (decision.kind !== "section" && decision.level !== null) {
      throw new Error("Le niveau doit être vide pour une ligne non-section.");
    }
    explicitDecisions.set(decision.rowIndex, decision);
  }

  const decisionsByRowIndex = new Map<number, ImportStructureDecision>();
  let hasLevelOneSection = false;

  for (const candidate of preview.candidates) {
    const decision =
      explicitDecisions.get(candidate.row_index) ??
      (candidate.suggested_kind === "section"
        ? { rowIndex: candidate.row_index, kind: "section" as const, level: 1 as const }
        : { rowIndex: candidate.row_index, kind: "line" as const, level: null });

    if (decision.kind === "section" && decision.level === 2 && !hasLevelOneSection) {
      throw new Error(
        `La section de niveau 2 « ${candidate.title} » doit suivre une section de niveau 1.`
      );
    }

    if (decision.kind === "section" && decision.level === 1) {
      hasLevelOneSection = true;
    }

    decisionsByRowIndex.set(candidate.row_index, decision);
  }

  return {
    preview,
    decisionsByRowIndex,
    footerRowIndexes: new Set(preview.footer_row_indexes),
  };
}
