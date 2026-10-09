"use client";

import { useMemo, useState } from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
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
  high: "Confiance élevée",
  medium: "Confiance moyenne",
  low: "Confiance faible",
};

const CONFIDENCE_VARIANTS: Record<MappingConfidenceBand, NonNullable<BadgeProps["variant"]>> = {
  high: "success",
  medium: "warning",
  low: "danger",
};

const ORIGIN_LABELS: Record<MappingSuggestionOrigin, string> = {
  template: "Modèle",
  memory: "Mémoire",
  heuristic: "Heuristique",
};

function ConfidenceBadge({ confidence }: { confidence: MappingSuggestionConfidence }) {
  const label = CONFIDENCE_LABELS[confidence.band];
  const originLabel = ORIGIN_LABELS[confidence.origin];
  const scorePercent = Math.round(confidence.score * 100);

  return (
    <Badge variant={CONFIDENCE_VARIANTS[confidence.band]} size="sm">
      <span aria-hidden="true">
        {confidence.band === "high" ? "✓" : confidence.band === "medium" ? "∼" : "✗"}
      </span>
      {label}
      <span className="sr-only">{` (${scorePercent} %, origine : ${originLabel})`}</span>
    </Badge>
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
  const filters: Array<{ mode: FilterMode; label: string }> = [
    { mode: "all", label: `Toutes (${sourceColumns.length})` },
    { mode: "mapped", label: `Mappées (${mappedCount})` },
    { mode: "unmapped", label: `Non mappées / ignorées (${sourceColumns.length - mappedCount})` },
  ];

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
    <section
      aria-labelledby="column-mapper-title"
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
    >
      <div className="border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="column-mapper-title" className="text-sm font-semibold text-foreground">
              Mapping des colonnes
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Associez les colonnes source aux champs métier.
              <span className="ml-2 font-medium text-foreground-secondary">
                {mappedTargetCount}/{totalTargetFields} champs
              </span>
            </p>
          </div>

          {/* Filter toggle */}
          <div
            role="group"
            aria-label="Filtrer les colonnes"
            className="flex max-w-full flex-wrap overflow-hidden rounded-control border border-border text-xs"
          >
            {filters.map((filter, index) => (
              <button
                key={filter.mode}
                type="button"
                aria-pressed={filterMode === filter.mode}
                className={cn(
                  "min-h-9 px-2.5 py-1.5 font-medium transition-colors focus-visible:relative focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                  index > 0 && "border-l border-border",
                  filterMode === filter.mode
                    ? "bg-foreground text-surface"
                    : "text-foreground-secondary hover:bg-muted"
                )}
                onClick={() => setFilterMode(filter.mode)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {/* Full-width progress bar */}
        <div
          role="progressbar"
          aria-label="Champs métier mappés"
          aria-valuemin={0}
          aria-valuemax={totalTargetFields}
          aria-valuenow={mappedTargetCount}
          className="h-2.5 w-full overflow-hidden bg-muted"
        >
          <div
            className="h-full bg-success transition-all duration-300 motion-reduce:transition-none"
            style={{ width: `${totalTargetFields > 0 ? (mappedTargetCount / totalTargetFields) * 100 : 0}%` }}
          />
        </div>
      </div>

      {sourceColumns.length === 0 ? (
        <div className="px-4 py-8 text-sm text-muted-foreground sm:px-6">
          Aucune colonne détectée. Sélectionnez un import pour commencer.
        </div>
      ) : (
        <div
          className="table-scroll relative overflow-x-auto"
          role="region"
          aria-label="Colonnes source et champs cibles"
          tabIndex={0}
        >
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Colonne source</th>
                <th scope="col">Aperçu</th>
                {confidenceBySource && <th scope="col">Confiance</th>}
                <th scope="col">Champ cible</th>
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
                          ? "bg-success-subtle/60"
                          : ""
                    }
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "inline-block size-2 shrink-0 rounded-full",
                            isMapped ? "bg-success" : "bg-border-strong"
                          )}
                        />
                        <span className="sr-only">{isMapped ? "Mappée : " : "Non mappée : "}</span>
                        <span className="font-medium text-foreground">{sourceColumn}</span>
                      </div>
                    </td>
                    <td>
                      {samples.length > 0 ? (
                        <span className="text-xs text-muted-foreground italic">
                          {samples.join(", ")}
                        </span>
                      ) : (
                        <span className="text-xs text-subtle-foreground">—</span>
                      )}
                    </td>
                    {confidenceBySource && (
                      <td>
                        {confidence ? (
                          <ConfidenceBadge confidence={confidence} />
                        ) : (
                          <span className="text-xs text-subtle-foreground">—</span>
                        )}
                      </td>
                    )}
                    <td>
                      <div className="flex min-w-48 flex-col gap-1">
                        <NativeSelect
                          size="sm"
                          aria-label={`Champ cible pour ${sourceColumn}`}
                          aria-invalid={hasDuplicateConflict || undefined}
                          className={cn(hasDuplicateConflict && "border-warning-border ring-3 ring-warning/20")}
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
                        </NativeSelect>
                        {isRequiredTarget ? (
                          <span className="text-micro text-danger">Champ requis</span>
                        ) : null}
                        {hasDuplicateConflict ? (
                          <div className="flex flex-wrap items-center gap-2 text-micro text-warning">
                            <span>
                              Conflit : « {getTargetLabel(currentTarget)} » aussi assigné à{" "}
                              {duplicateSources.filter((s) => s !== sourceColumn).join(", ")}
                            </span>
                            <Button
                              variant="link"
                              size="xs"
                              className="text-micro text-warning"
                              onClick={() => setMapping(sourceColumn, "")}
                              disabled={disabled}
                            >
                              Retirer
                            </Button>
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

      <div className="border-t border-border px-4 py-4 text-xs text-muted-foreground sm:px-6">
        {missingRequiredTargets.length === 0 ? (
          <span className="text-success">Tous les champs requis sont mappés.</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            À mapper :
            {missingRequiredTargets.map((v) => (
              <Badge key={v} variant="warning" size="sm">
                {targetFields.find((f) => f.value === v)?.label ?? v}
              </Badge>
            ))}
          </span>
        )}
      </div>
    </section>
  );
}
