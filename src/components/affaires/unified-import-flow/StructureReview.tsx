"use client";

import { useMemo } from "react";

import type {
  StructureDecision,
  StructurePreviewData,
} from "./types";
import { Alert, AlertDescription } from "@/components/ui/alert";

type StructureReviewProps = {
  preview: StructurePreviewData | null;
  decisions: StructureDecision[];
  isLoading: boolean;
  onChange: (decisions: StructureDecision[]) => void;
};

export function buildDefaultStructureDecisions(
  preview: StructurePreviewData,
): StructureDecision[] {
  return preview.candidates.map((candidate) =>
    candidate.suggested_kind === "section"
      ? {
          rowIndex: candidate.row_index,
          kind: "section",
          level: candidate.suggested_level ?? 1,
        }
      : {
          rowIndex: candidate.row_index,
          kind: "line",
          level: null,
        },
  );
}

export function getStructureReviewError(
  preview: StructurePreviewData | null,
  decisions: StructureDecision[],
): string | null {
  if (!preview) return null;

  const decisionsByRow = new Map(
    decisions.map((decision) => [decision.rowIndex, decision]),
  );
  let hasLevelOneSection = false;

  for (const candidate of preview.candidates) {
    const decision = decisionsByRow.get(candidate.row_index);
    if (!decision) {
      return `La ligne ${candidate.source_row_number ?? candidate.row_index + 1} doit être qualifiée.`;
    }

    if (decision.kind === "section" && decision.level === 2 && !hasLevelOneSection) {
      return `La section « ${candidate.title} » ne peut pas être de niveau 2 sans section de niveau 1 précédente.`;
    }

    if (decision.kind === "section" && decision.level === 1) {
      hasLevelOneSection = true;
    }
  }

  return null;
}

function replaceDecision(
  decisions: StructureDecision[],
  nextDecision: StructureDecision,
) {
  return decisions.map((decision) =>
    decision.rowIndex === nextDecision.rowIndex ? nextDecision : decision,
  );
}

export function StructureReview({
  preview,
  decisions,
  isLoading,
  onChange,
}: StructureReviewProps) {
  const decisionsByRow = useMemo(
    () => new Map(decisions.map((decision) => [decision.rowIndex, decision])),
    [decisions],
  );
  const validationError = useMemo(
    () => getStructureReviewError(preview, decisions),
    [decisions, preview],
  );

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-surface shadow-card p-6" aria-busy="true">
        <div className="h-4 w-44 animate-pulse rounded bg-border" />
        <div className="mt-4 h-20 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (!preview) return null;

  return (
    <section className="rounded-lg border border-border bg-surface shadow-card p-6" aria-labelledby="structure-review-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="structure-review-title"
            className="text-sm font-semibold text-foreground"
          >
            Structure du DPGF
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Confirmez les titres détectés. Les lignes ordinaires sans prix seront
            conservées avec une valeur de 0 €.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-info-subtle px-2.5 py-1 font-medium text-info">
            {preview.summary.candidate_rows} titre(s)
          </span>
          <span className="rounded-full bg-warning-subtle px-2.5 py-1 font-medium text-warning">
            {preview.summary.zero_price_rows} ligne(s) à 0 €
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
            {preview.summary.ignored_footer_rows} pied(s) ignoré(s)
          </span>
        </div>
      </div>

      {preview.candidates.length === 0 ? (
        <p className="mt-4 rounded-xl border border-border bg-surface-subtle px-4 py-3 text-sm text-muted-foreground">
          Aucun titre candidat n&apos;a été détecté. Toutes les lignes opérationnelles
          seront importées dans la section racine.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {preview.candidates.map((candidate) => {
            const decision = decisionsByRow.get(candidate.row_index);
            if (!decision) return null;

            const sourceLabel = [
              candidate.sheet_name,
              candidate.source_row_number
                ? `ligne ${candidate.source_row_number}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const isIndented =
              decision.kind === "section" && decision.level === 2;

            return (
              <div
                key={candidate.row_index}
                className={`grid gap-3 rounded-xl border border-border bg-surface p-3 md:grid-cols-[minmax(0,1fr)_9rem_8rem] md:items-center ${
                  isIndented ? "ml-4 border-l-4 border-l-blue-300" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {candidate.title}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wide ${
                        candidate.confidence === "high"
                          ? "bg-success-subtle text-success"
                          : "bg-warning-subtle text-warning"
                      }`}
                    >
                      Confiance {candidate.confidence === "high" ? "forte" : "moyenne"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {sourceLabel || `Ligne importée ${candidate.row_index + 1}`}
                    {candidate.reasons.includes("bold_designation")
                      ? " · titre en gras"
                      : " · détection sémantique"}
                  </p>
                </div>

                <label className="text-xs font-medium text-muted-foreground">
                  Type
                  <select
                    aria-label={`Type de ${candidate.title}`}
                    className="input mt-1 h-9 w-full py-1 text-sm"
                    value={decision.kind}
                    onChange={(event) => {
                      const kind = event.target.value;
                      const nextDecision: StructureDecision =
                        kind === "section"
                          ? {
                              rowIndex: candidate.row_index,
                              kind: "section",
                              level:
                                decision.kind === "section" ? decision.level : 1,
                            }
                          : {
                              rowIndex: candidate.row_index,
                              kind: kind === "ignore" ? "ignore" : "line",
                              level: null,
                            };
                      onChange(replaceDecision(decisions, nextDecision));
                    }}
                  >
                    <option value="section">Section</option>
                    <option value="line">Ligne</option>
                    <option value="ignore">Ignorer</option>
                  </select>
                </label>

                <label className="text-xs font-medium text-muted-foreground">
                  Niveau
                  <select
                    aria-label={`Niveau de ${candidate.title}`}
                    className="input mt-1 h-9 w-full py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={decision.kind !== "section"}
                    value={decision.kind === "section" ? decision.level : ""}
                    onChange={(event) => {
                      if (decision.kind !== "section") return;
                      onChange(
                        replaceDecision(decisions, {
                          ...decision,
                          level: event.target.value === "2" ? 2 : 1,
                        }),
                      );
                    }}
                  >
                    {decision.kind !== "section" && <option value="">—</option>}
                    <option value="1">Niveau 1</option>
                    <option value="2">Niveau 2</option>
                  </select>
                </label>
              </div>
            );
          })}
        </div>
      )}

      {validationError && (
        <Alert variant="danger" className="mt-4">
          <AlertDescription className="text-danger">{validationError}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
