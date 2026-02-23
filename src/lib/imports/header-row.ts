const HEADER_KEYWORDS = new Set([
  "description",
  "designation",
  "quantite",
  "qte",
  "qty",
  "unite",
  "unit",
  "prix",
  "pu",
  "total",
  "montant",
  "famille",
  "lot",
  "commentaire",
  "code",
  "reference",
  "ref",
  "fo",
  "mo",
]);

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function tokenize(value: string): string[] {
  return stripAccents(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isNumericLike(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (compact.length === 0) return false;
  return /^[-+]?[\d.,]+(?:[%€$])?$/.test(compact);
}

function scoreHeaderCandidate(row: unknown[], rowIndex: number): number {
  const cells = row.map(normalizeCell);
  const nonEmpty = cells.filter((cell) => cell.length > 0);
  const nonEmptyCount = nonEmpty.length;

  if (nonEmptyCount === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const tokenSet = new Set<string>();
  nonEmpty.forEach((cell) => {
    tokenize(cell).forEach((token) => tokenSet.add(token));
  });

  const keywordHits = Array.from(tokenSet).filter((token) =>
    HEADER_KEYWORDS.has(token)
  ).length;

  const numericLikeCount = nonEmpty.filter((cell) => isNumericLike(cell)).length;
  const uniqueCount = new Set(nonEmpty).size;
  const maxCellLength = nonEmpty.reduce(
    (max, cell) => Math.max(max, cell.length),
    0
  );

  let score = 0;

  score += Math.min(nonEmptyCount, 12) * 6;
  score += (uniqueCount / nonEmptyCount) * 6;
  score += keywordHits * 10;
  score += (nonEmptyCount - numericLikeCount) * 2;
  score -= numericLikeCount * 4;
  score -= rowIndex * 0.25;

  if (keywordHits >= 2) {
    score += 8;
  }

  if (nonEmptyCount === 1) {
    score -= 12;
  }

  if (nonEmptyCount <= 2 && maxCellLength > 35) {
    score -= 10;
  }

  const joinedTokens = Array.from(tokenSet).join(" ");
  if (
    nonEmptyCount <= 2 &&
    /\b(dpgf|projet|devis|bordereau)\b/.test(joinedTokens)
  ) {
    score -= 12;
  }

  return score;
}

function firstNonEmptyRowIndex(matrix: unknown[][]): number {
  for (let index = 0; index < matrix.length; index += 1) {
    const row = Array.isArray(matrix[index]) ? matrix[index] : [];
    if (row.some((cell) => normalizeCell(cell).length > 0)) {
      return index;
    }
  }
  return 0;
}

function hasNonEmptyCell(row: unknown[]): boolean {
  return row.some((cell) => normalizeCell(cell).length > 0);
}

export function normalizeHeaderRowNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1) return null;
    return value;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function detectHeaderRowIndex(matrix: unknown[][]): number {
  if (matrix.length === 0) return 0;

  const scanLimit = Math.min(matrix.length, 50);
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
    const score = scoreHeaderCandidate(row, rowIndex);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  }

  if (bestIndex >= 0 && Number.isFinite(bestScore)) {
    return bestIndex;
  }

  return firstNonEmptyRowIndex(matrix);
}

export function resolveHeaderRowIndex(
  matrix: unknown[][],
  options?: { headerRowNumber?: number | null }
): number {
  if (matrix.length === 0) return 0;

  const manualHeaderRow = normalizeHeaderRowNumber(options?.headerRowNumber);
  if (manualHeaderRow !== null) {
    const manualIndex = manualHeaderRow - 1;
    if (manualIndex < 0 || manualIndex >= matrix.length) {
      throw new Error(
        `La ligne d'en-tete ${manualHeaderRow} est hors limites pour ce fichier.`
      );
    }

    const row = Array.isArray(matrix[manualIndex]) ? matrix[manualIndex] : [];
    if (!hasNonEmptyCell(row)) {
      throw new Error(`La ligne d'en-tete ${manualHeaderRow} est vide.`);
    }

    return manualIndex;
  }

  return detectHeaderRowIndex(matrix);
}
