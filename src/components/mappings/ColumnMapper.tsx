"use client";

import { useMemo, useState } from "react";

import type {
  MappingConfidenceBand,
  MappingSuggestionConfidence,
  MappingSuggestionOrigin,
} from "@/lib/mappings/server";

type TargetFieldOption = {
  value: string;
  label: string;
  required?: boolean;
};

export type ColumnMapping = Record<string, string>;

/* ------------------------------------------------------------------ */
/*  Confidence badge helpers (UX2-010)                                 */
/* ------------------------------------------------------------------ */

const EMPTY_SAMPLE_VALUES: Record<string, string[]> = {};

const CONFIDENCE_LABELS: Record<MappingConfidenceBand, string> = {
  high: "Confiance elevee",
  medium: "Confiance moyenne",
  low: "Confiance faible",
};

const CONFIDENCE_COLORS: Record<MappingConfidenceBand, string> = {
  high: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-red-100 text-red-800 border-red-200",
};

const ORIGIN_LABELS: Record<MappingSuggestionOrigin, string> = {
  template: "Template",
  memory: "Memoire",
  heuristic: "Heuristique",
};

function ConfidenceBadge({ confidence }: { confidence: MappingSuggestionConfidence }) {
  const label = CONFIDENCE_LABELS[confidence.band];
  const colors = CONFIDENCE_COLORS[confidence.band];
  const originLabel = ORIGIN_LABELS[confidence.origin];
  const scorePercent = Math.round(confidence.score * 100);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight ${colors}`}
      role="status"
      aria-label={`${label} (${scorePercent}%) - origine : ${originLabel}`}
      title={`${scorePercent}% - ${originLabel}`}
    >
      <span aria-hidden="true">
        {confidence.band === "high" ? "\u2713" : confidence.band === "medium" ? "\u223C" : "\u2717"}
      </span>
      {label}
    </span>
  );
}

type FilterMode = "all" | "mapped" | "unmapped";

/** Natural sort: col_1, col_2, ... col_10 instead of col_1, col_10, col_11 */
function naturalSortKey(value: string): [string, number] {
  const match = value.match(/^(.+?)(\d+)$/);
  if (!match) return [value, 0];
  return [match[1], Number(match[2])];
}

function naturalCompare(a: string, b: string): number {
  const [prefixA, numA] = naturalSortKey(a);
  const [prefixB, numB] = naturalSortKey(b);

  const prefixCompare = prefixA.localeCompare(prefixB);
  if (prefixCompare !== 0) return prefixCompare;

  return numA - numB;
}

export function ColumnMapper({
  sourceColumns,
  mapping,
  targetFields,
  sampleValues = EMPTY_SAMPLE_VALUES,
  confidenceBySource,
  disabled = false,
  onChange,
}: {
  sourceColumns: string[];
  mapping: ColumnMapping;
  targetFields: TargetFieldOption[];
  sampleValues?: Record<string, string[]>;
  confidenceBySource?: Record<string, MappingSuggestionConfidence>;
  disabled?: boolean;
  onChange: (next: ColumnMapping) => void;
}) {
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const requiredTargets = targetFields.filter((field) => field.required).map((field) => field.value);
  const visibleMappings = useMemo(() => {
    const entries: Array<[string, string]> = [];
    for (const sourceColumn of sourceColumns) {
      const target = mapping[sourceColumn];
      if (target) {
        entries.push([sourceColumn, target]);
      }
    }
    return entries;
  }, [sourceColumns, mapping]);

  const mappedTargets = useMemo(() => new Set(visibleMappings.map(([, target]) => target)), [visibleMappings]);
  const missingRequiredTargets = requiredTargets.filter((required) => !mappedTargets.has(required));

  // Compute duplicate target assignments for inline warnings
  const duplicateTargetMap = useMemo(() => {
    const targetToSources = new Map<string, string[]>();
    for (const [source, target] of visibleMappings) {
      if (!target) continue;
      const existing = targetToSources.get(target) ?? [];
      existing.push(source);
      targetToSources.set(target, existing);
    }
    const duplicates = new Map<string, string[]>();
    for (const [target, sources] of targetToSources.entries()) {
      if (sources.length > 1) {
        duplicates.set(target, sources);
      }
    }
    return duplicates;
  }, [visibleMappings]);

  // Smart sorting: mapped columns first, then natural sort
  const sortedAndFilteredColumns = useMemo(() => {
    const mapped: string[] = [];
    const unmapped: string[] = [];

    for (const col of sourceColumns) {
      if (mapping[col]) {
        mapped.push(col);
      } else {
        unmapped.push(col);
      }
    }

    mapped.sort(naturalCompare);
    unmapped.sort(naturalCompare);

    const sorted = [...mapped, ...unmapped];

    if (filterMode === "mapped") return sorted.filter((col) => mapping[col]);
    if (filterMode === "unmapped") return sorted.filter((col) => !mapping[col]);
    return sorted;
  }, [sourceColumns, mapping, filterMode]);

  const mappedCount = visibleMappings.length;
  const totalTargetFields = targetFields.length;
  const mappedTargetCount = mappedTargets.size;

  function setMapping(sourceColumn: string, nextTarget: string) {
    if (disabled) return;

    const next = { ...mapping };

    if (!nextTarget) {
      delete next[sourceColumn];
    } else {
      next[sourceColumn] = nextTarget;
    }

    onChange(next);
  }

  function getTargetLabel(targetValue: string): string {
    return targetFields.find((f) => f.value === targetValue)?.label ?? targetValue;
  }

  return (
    <section className="dashboard-card overflow-hidden">
      <div className="border-b border-[var(--slate-200)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">Mapping des colonnes</h2>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              Associez les colonnes source aux champs metier.
              <span className="ml-2 font-medium text-[var(--slate-700)]">
                {mappedTargetCount}/{totalTargetFields} champs
              </span>
            </p>
          </div>

          {/* Filter toggle */}
          <div className="flex rounded-lg border border-[var(--slate-200)] text-xs">
            <button
              type="button"
              className={`px-2.5 py-1.5 transition-colors ${filterMode === "all" ? "bg-[var(--slate-800)] text-white" : "text-[var(--slate-600)] hover:bg-[var(--slate-100)]"}`}
              onClick={() => setFilterMode("all")}
            >
              Toutes ({sourceColumns.length})
            </button>
            <button
              type="button"
              className={`border-l border-r border-[var(--slate-200)] px-2.5 py-1.5 transition-colors ${filterMode === "mapped" ? "bg-[var(--slate-800)] text-white" : "text-[var(--slate-600)] hover:bg-[var(--slate-100)]"}`}
              onClick={() => setFilterMode("mapped")}
            >
              Mappees ({mappedCount})
            </button>
            <button
              type="button"
              className={`px-2.5 py-1.5 transition-colors ${filterMode === "unmapped" ? "bg-[var(--slate-800)] text-white" : "text-[var(--slate-600)] hover:bg-[var(--slate-100)]"}`}
              onClick={() => setFilterMode("unmapped")}
            >
              Non mappées / ignorées ({sourceColumns.length - mappedCount})
            </button>
          </div>
        </div>

        {/* Full-width progress bar */}
        <div className="h-2.5 w-full overflow-hidden bg-[var(--slate-200)]">
          <div
            className="h-full bg-[var(--success)] transition-all duration-300"
            style={{ width: `${totalTargetFields > 0 ? (mappedTargetCount / totalTargetFields) * 100 : 0}%` }}
          />
        </div>
      </div>

      {sourceColumns.length === 0 ? (
        <div className="px-6 py-8 text-sm text-[var(--slate-500)]">
          Aucune colonne detectee. Selectionnez un import pour commencer.
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Colonne source</th>
                <th>Apercu</th>
                {confidenceBySource && <th>Confiance</th>}
                <th>Champ cible</th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredColumns.map((sourceColumn) => {
                const currentTarget = mapping[sourceColumn] ?? "";
                const isMapped = Boolean(currentTarget);
                const isRequiredTarget = requiredTargets.includes(currentTarget);
                const duplicateSources = currentTarget ? duplicateTargetMap.get(currentTarget) : undefined;
                const hasDuplicateConflict = duplicateSources && duplicateSources.length > 1;
                const samples = sampleValues[sourceColumn] ?? [];
                const confidence = confidenceBySource?.[sourceColumn] ?? null;

                return (
                  <tr
                    key={sourceColumn}
                    className={
                      hasDuplicateConflict
                        ? "bg-warning-light"
                        : isMapped
                          ? "bg-emerald-50/50"
                          : ""
                    }
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block h-2 w-2 shrink-0 rounded-full ${isMapped ? "bg-[var(--success)]" : "bg-[var(--slate-300)]"}`}
                          title={isMapped ? "Mappe" : "Non mappe"}
                        />
                        <span className="font-medium text-[var(--slate-800)]">{sourceColumn}</span>
                      </div>
                    </td>
                    <td>
                      {samples.length > 0 ? (
                        <span className="text-xs text-[var(--slate-500)] italic">
                          {samples.join(", ")}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--slate-300)]">-</span>
                      )}
                    </td>
                    {confidenceBySource && (
                      <td>
                        {confidence ? (
                          <ConfidenceBadge confidence={confidence} />
                        ) : (
                          <span className="text-xs text-[var(--slate-300)]">-</span>
                        )}
                      </td>
                    )}
                    <td>
                      <div className="flex flex-col gap-1">
                        <select
                          className={`form-input form-select form-input--sm ${hasDuplicateConflict ? "!border-amber-400 !ring-amber-200" : ""}`}
                          value={currentTarget}
                          onChange={(event) => setMapping(sourceColumn, event.target.value)}
                          disabled={disabled}
                        >
                          <option value="">Ne pas mapper</option>
                          {targetFields.map((target) => (
                            <option key={target.value} value={target.value}>
                              {target.label}
                              {target.required ? " *" : ""}
                            </option>
                          ))}
                        </select>
                        {isRequiredTarget ? (
                          <span className="text-[11px] text-danger">
                            Champ requis
                          </span>
                        ) : null}
                        {hasDuplicateConflict ? (
                          <div className="flex items-center gap-2 text-[11px] text-warning">
                            <span>
                              Conflit : &laquo;{getTargetLabel(currentTarget)}&raquo; aussi assigne a {duplicateSources.filter((s) => s !== sourceColumn).join(", ")}
                            </span>
                            <button
                              type="button"
                              className="font-medium underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 hover:no-underline"
                              onClick={() => setMapping(sourceColumn, "")}
                              disabled={disabled}
                            >
                              Retirer
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-[var(--slate-200)] px-6 py-4 text-xs text-[var(--slate-500)]">
        {missingRequiredTargets.length === 0 ? (
          <span className="text-[var(--success)]">
            Tous les champs requis sont mappes.
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            A mapper :
            {missingRequiredTargets.map((v) => (
              <span
                key={v}
                className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"
              >
                {targetFields.find((f) => f.value === v)?.label ?? v}
              </span>
            ))}
          </span>
        )}
      </div>
    </section>
  );
}
