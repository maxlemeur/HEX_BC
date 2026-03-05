import {
  TAKEOFF_COMPARE_DEFAULT_THRESHOLD,
  TAKEOFF_COMPARE_MAX_THRESHOLD,
  TAKEOFF_COMPARE_MIN_THRESHOLD,
  computeTakeoffSimilarityRatio,
  normalizeTakeoffCompareText,
} from "@/lib/takeoff/diff";
import type {
  TakeoffDpgfComparisonDpgfLine,
  TakeoffDpgfComparisonResponse,
  TakeoffDpgfComparisonRow,
  TakeoffDpgfComparisonSeverity,
  TakeoffDpgfComparisonSummary,
  TakeoffDpgfComparisonTakeoffLine,
  TakeoffDpgfManualLinkRecord,
} from "@/lib/takeoff/types";

export const TAKEOFF_DPGF_COMPARE_DEFAULT_PAGE_SIZE = 50;
export const TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE = 200;

type BuildTakeoffDpgfComparisonInput = {
  versionId: string;
  jobId: string;
  dpgfLines: TakeoffDpgfComparisonDpgfLine[];
  takeoffLines: TakeoffDpgfComparisonTakeoffLine[];
  manualLinks?: TakeoffDpgfManualLinkRecord[];
  threshold?: number;
  cursor?: string | null;
  pageSize?: number;
};

type NormalizedDpgfLine = TakeoffDpgfComparisonDpgfLine & {
  searchText: string;
  normalizedUnit: string | null;
};

type NormalizedTakeoffLine = TakeoffDpgfComparisonTakeoffLine & {
  searchText: string;
  normalizedUnit: string | null;
};

type MatchedTakeoffCandidate = {
  line: NormalizedTakeoffLine;
  score: number;
};

function normalizeThreshold(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return TAKEOFF_COMPARE_DEFAULT_THRESHOLD;
  }

  if ((value ?? 0) < TAKEOFF_COMPARE_MIN_THRESHOLD) {
    return TAKEOFF_COMPARE_MIN_THRESHOLD;
  }

  if ((value ?? 0) > TAKEOFF_COMPARE_MAX_THRESHOLD) {
    return TAKEOFF_COMPARE_MAX_THRESHOLD;
  }

  return Number((value ?? TAKEOFF_COMPARE_DEFAULT_THRESHOLD).toFixed(2));
}

function normalizePageSize(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return TAKEOFF_DPGF_COMPARE_DEFAULT_PAGE_SIZE;
  }

  const clamped = Math.min(
    TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(value ?? TAKEOFF_DPGF_COMPARE_DEFAULT_PAGE_SIZE))
  );

  return clamped;
}

function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined) {
  if (!cursor) return 0;

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const offset = parsed?.offset;
    if (typeof offset !== "number" || !Number.isFinite(offset)) {
      return 0;
    }

    return Math.max(0, Math.trunc(offset));
  } catch {
    return 0;
  }
}

function normalizeUnit(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const normalized = normalizeTakeoffCompareText(value)
    .replace(/\s+/g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3");

  if (normalized.length === 0) return null;

  const aliasMap: Record<string, string> = {
    u: "u",
    un: "u",
    unite: "u",
    unit: "u",
    piece: "u",
    pieces: "u",
    pce: "u",
    ml: "ml",
    mlt: "ml",
    lm: "ml",
    m: "m",
    m2: "m2",
    sqm: "m2",
    m3: "m3",
    sqm3: "m3",
    kg: "kg",
    t: "t",
    for: "forfait",
    forfait: "forfait",
    ens: "ensemble",
    ensemble: "ensemble",
  };

  return aliasMap[normalized] ?? normalized;
}

function areUnitsCompatible(left: string | null, right: string | null) {
  if (!left || !right) return true;
  return left === right;
}

function buildDpgfSearchText(line: TakeoffDpgfComparisonDpgfLine) {
  return normalizeTakeoffCompareText(
    [line.title, line.description].filter(Boolean).join(" ")
  );
}

function buildTakeoffSearchText(line: TakeoffDpgfComparisonTakeoffLine) {
  return normalizeTakeoffCompareText(line.designation);
}

function computeMatchScore(input: {
  dpgf: NormalizedDpgfLine;
  takeoff: NormalizedTakeoffLine;
}) {
  if (!areUnitsCompatible(input.dpgf.normalizedUnit, input.takeoff.normalizedUnit)) {
    return null;
  }

  if (!input.dpgf.searchText || !input.takeoff.searchText) {
    return null;
  }

  let score = computeTakeoffSimilarityRatio(
    input.dpgf.searchText,
    input.takeoff.searchText
  );

  if (
    input.dpgf.normalizedUnit &&
    input.takeoff.normalizedUnit &&
    input.dpgf.normalizedUnit === input.takeoff.normalizedUnit
  ) {
    score += 0.05;
  }

  if (
    input.dpgf.searchText.includes(input.takeoff.searchText) ||
    input.takeoff.searchText.includes(input.dpgf.searchText)
  ) {
    score += 0.03;
  }

  return Math.min(0.9999, Number(score.toFixed(4)));
}

function toStableNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(4));
}

function computeDelta(input: {
  dpgf: TakeoffDpgfComparisonDpgfLine | null;
  takeoff: TakeoffDpgfComparisonTakeoffLine | null;
}) {
  if (!input.dpgf || !input.takeoff) {
    return {
      deltaAbsolute: null,
      deltaPercent: null,
      severity: "missing" as TakeoffDpgfComparisonSeverity,
    };
  }

  const deltaAbsolute = Math.abs(input.takeoff.quantity - input.dpgf.quantity);
  const deltaPercent =
    input.dpgf.quantity > 0
      ? (deltaAbsolute / input.dpgf.quantity) * 100
      : null;

  let severity: TakeoffDpgfComparisonSeverity = "ok";
  if (deltaPercent !== null && deltaPercent > 20) {
    severity = "critical";
  } else if (deltaPercent !== null && deltaPercent >= 5) {
    severity = "warning";
  }

  return {
    deltaAbsolute: toStableNumber(deltaAbsolute),
    deltaPercent: toStableNumber(deltaPercent),
    severity,
  };
}

function buildRow(input: {
  dpgf: NormalizedDpgfLine | TakeoffDpgfComparisonDpgfLine | null;
  takeoff: NormalizedTakeoffLine | TakeoffDpgfComparisonTakeoffLine | null;
  matchSource: "auto" | "manual" | null;
  matchScore: number | null;
  manualLinkId: string | null;
}): TakeoffDpgfComparisonRow {
  const delta = computeDelta({
    dpgf: input.dpgf,
    takeoff: input.takeoff,
  });

  const key =
    input.dpgf && input.takeoff
      ? `matched:${input.dpgf.estimate_item_id}:${input.takeoff.item_id}`
      : input.dpgf
        ? `dpgf:${input.dpgf.estimate_item_id}`
        : `takeoff:${input.takeoff?.item_id ?? "unknown"}`;

  return {
    key,
    dpgf: input.dpgf
      ? {
          estimate_item_id: input.dpgf.estimate_item_id,
          title: input.dpgf.title,
          description: input.dpgf.description,
          quantity: input.dpgf.quantity,
          unit: input.dpgf.unit,
          source_page: input.dpgf.source_page,
          source_file_name: input.dpgf.source_file_name,
          position: input.dpgf.position,
        }
      : null,
    takeoff: input.takeoff
      ? {
          item_id: input.takeoff.item_id,
          designation: input.takeoff.designation,
          quantity: input.takeoff.quantity,
          unit: input.takeoff.unit,
          source_page: input.takeoff.source_page,
          source_file_name: input.takeoff.source_file_name,
          confidence: input.takeoff.confidence,
        }
      : null,
    match_source: input.matchSource,
    match_score: input.matchScore === null ? null : Number(input.matchScore.toFixed(4)),
    delta_absolute: delta.deltaAbsolute,
    delta_percent: delta.deltaPercent,
    severity: delta.severity,
    manual_link_id: input.manualLinkId,
  };
}

function findBestAutoMatch(input: {
  dpgf: NormalizedDpgfLine;
  takeoffLines: NormalizedTakeoffLine[];
  usedTakeoffIds: Set<string>;
  threshold: number;
}): MatchedTakeoffCandidate | null {
  let bestMatch: MatchedTakeoffCandidate | null = null;

  for (const candidate of input.takeoffLines) {
    if (input.usedTakeoffIds.has(candidate.item_id)) {
      continue;
    }

    const score = computeMatchScore({
      dpgf: input.dpgf,
      takeoff: candidate,
    });

    if (score === null || score < input.threshold) {
      continue;
    }

    if (
      !bestMatch ||
      score > bestMatch.score ||
      (score === bestMatch.score &&
        (candidate.confidence ?? 0) > (bestMatch.line.confidence ?? 0))
    ) {
      bestMatch = {
        line: candidate,
        score,
      };
    }
  }

  return bestMatch;
}

function buildSummary(rows: TakeoffDpgfComparisonRow[]): TakeoffDpgfComparisonSummary {
  return rows.reduce<TakeoffDpgfComparisonSummary>(
    (summary, row) => {
      if (row.manual_link_id) {
        summary.manual_links += 1;
      }

      if (!row.dpgf) {
        summary.missing_dpgf += 1;
      } else if (!row.takeoff) {
        summary.missing_takeoff += 1;
      } else if (row.severity === "ok") {
        summary.matches += 1;
      } else {
        summary.gaps += 1;
        if (row.severity === "warning") {
          summary.warning_count += 1;
        }
        if (row.severity === "critical") {
          summary.critical_count += 1;
        }
      }

      summary.total_rows += 1;
      return summary;
    },
    {
      matches: 0,
      gaps: 0,
      missing_dpgf: 0,
      missing_takeoff: 0,
      manual_links: 0,
      warning_count: 0,
      critical_count: 0,
      total_rows: 0,
    }
  );
}

export function buildTakeoffDpgfComparison(
  input: BuildTakeoffDpgfComparisonInput
): TakeoffDpgfComparisonResponse {
  const threshold = normalizeThreshold(input.threshold);
  const pageSize = normalizePageSize(input.pageSize);
  const offset = decodeCursor(input.cursor);

  const normalizedDpgfLines: NormalizedDpgfLine[] = input.dpgfLines.map((line) => ({
    ...line,
    searchText: buildDpgfSearchText(line),
    normalizedUnit: normalizeUnit(line.unit),
  }));
  const normalizedTakeoffLines: NormalizedTakeoffLine[] = input.takeoffLines.map((line) => ({
    ...line,
    searchText: buildTakeoffSearchText(line),
    normalizedUnit: normalizeUnit(line.unit),
  }));

  const takeoffById = new Map(
    normalizedTakeoffLines.map((line) => [line.item_id, line] as const)
  );
  const manualLinkByEstimateItemId = new Map(
    (input.manualLinks ?? []).map((link) => [link.estimate_item_id, link] as const)
  );
  const usedTakeoffIds = new Set<string>();
  const rows: TakeoffDpgfComparisonRow[] = [];

  for (const dpgfLine of normalizedDpgfLines) {
    const manualLink = manualLinkByEstimateItemId.get(dpgfLine.estimate_item_id) ?? null;
    const manuallyLinkedTakeoff = manualLink
      ? takeoffById.get(manualLink.takeoff_item_id) ?? null
      : null;

    if (manualLink && manuallyLinkedTakeoff) {
      usedTakeoffIds.add(manuallyLinkedTakeoff.item_id);
      rows.push(
        buildRow({
          dpgf: dpgfLine,
          takeoff: manuallyLinkedTakeoff,
          matchSource: "manual",
          matchScore: computeMatchScore({
            dpgf: dpgfLine,
            takeoff: manuallyLinkedTakeoff,
          }),
          manualLinkId: manualLink.id,
        })
      );
      continue;
    }

    const bestMatch = findBestAutoMatch({
      dpgf: dpgfLine,
      takeoffLines: normalizedTakeoffLines,
      usedTakeoffIds,
      threshold,
    });

    if (!bestMatch) {
      rows.push(
        buildRow({
          dpgf: dpgfLine,
          takeoff: null,
          matchSource: null,
          matchScore: null,
          manualLinkId: null,
        })
      );
      continue;
    }

    usedTakeoffIds.add(bestMatch.line.item_id);
    rows.push(
      buildRow({
        dpgf: dpgfLine,
        takeoff: bestMatch.line,
        matchSource: "auto",
        matchScore: bestMatch.score,
        manualLinkId: null,
      })
    );
  }

  for (const takeoffLine of normalizedTakeoffLines) {
    if (usedTakeoffIds.has(takeoffLine.item_id)) {
      continue;
    }

    rows.push(
      buildRow({
        dpgf: null,
        takeoff: takeoffLine,
        matchSource: null,
        matchScore: null,
        manualLinkId: null,
      })
    );
  }

  const summary = buildSummary(rows);
  const paginatedRows = rows.slice(offset, offset + pageSize);
  const nextOffset = offset + paginatedRows.length;

  return {
    version_id: input.versionId,
    job_id: input.jobId,
    threshold,
    summary,
    rows: paginatedRows,
    pagination: {
      page_size: pageSize,
      next_cursor: nextOffset < rows.length ? encodeCursor(nextOffset) : null,
      total: rows.length,
    },
  };
}
