"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  fetchTakeoffLineEvidencePanel,
  isTakeoffApiError,
} from "@/lib/takeoff/client";
import type {
  TakeoffLineEvidence,
  TakeoffLineEvidencePanelResponse,
} from "@/lib/takeoff/types";

type TakeoffLineEvidencePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  versionId: string;
  lineId: string;
  lineLabel: string;
  sourceFileName?: string | null;
  sourcePage?: number | null;
  surfaceLabel?: string;
};

const EVIDENCE_KIND_LABELS: Record<TakeoffLineEvidence["kind"], string> = {
  fact: "Fait",
  hypothesis: "Hypothèse",
  inference: "Inférence",
};

const EVIDENCE_TYPE_LABELS: Record<TakeoffLineEvidence["type"], string> = {
  dpgf: "DPGF",
  takeoff: "Métré",
  plan_zone: "Plan",
  formula: "Formule",
  price_source: "Prix",
  comment: "Note",
};

const EVIDENCE_TYPE_VARIANTS: Record<
  TakeoffLineEvidence["type"],
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  dpgf: "neutral",
  takeoff: "info",
  plan_zone: "info",
  formula: "warning",
  price_source: "success",
  comment: "neutral",
};

const EVIDENCE_STATUS_LABELS: Record<TakeoffLineEvidence["status"], string> = {
  active: "Active",
  invalidated: "Invalidée",
  replaced: "Remplacée",
};

const EVIDENCE_STATUS_VARIANTS: Record<
  TakeoffLineEvidence["status"],
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  active: "success",
  invalidated: "warning",
  replaced: "info",
};

const EVIDENCE_KIND_ORDER: TakeoffLineEvidence["kind"][] = [
  "fact",
  "hypothesis",
  "inference",
];

function formatEvidenceConfidence(value: number | null) {
  if (value === null) {
    return "Confiance non renseignée";
  }

  return `Confiance ${Math.round(value * 100)}%`;
}

function formatEvidenceDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function buildLineContextLabel(input: {
  sourceFileName?: string | null;
  sourcePage?: number | null;
}) {
  const normalizedFileName = input.sourceFileName?.trim().toLowerCase() ?? null;
  const sourceLocationLabel =
    normalizedFileName && normalizedFileName.endsWith(".pdf") ? "page" : "ligne";
  const fragments = [
    input.sourceFileName?.trim() ? input.sourceFileName.trim() : null,
    typeof input.sourcePage === "number" && input.sourcePage > 0
      ? `${sourceLocationLabel} ${input.sourcePage}`
      : null,
  ].filter((fragment): fragment is string => fragment !== null);

  return fragments.length > 0 ? fragments.join(" · ") : "Contexte source non renseigné";
}

function EvidenceCard({
  evidence,
}: {
  evidence: TakeoffLineEvidence;
}) {
  return (
    <article className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{evidence.label}</p>
            <Badge variant={EVIDENCE_TYPE_VARIANTS[evidence.type]} size="sm">
              {EVIDENCE_TYPE_LABELS[evidence.type]}
            </Badge>
            <Badge variant="neutral" size="sm">
              {EVIDENCE_KIND_LABELS[evidence.kind]}
            </Badge>
            <Badge variant={EVIDENCE_STATUS_VARIANTS[evidence.status]} size="sm">
              {EVIDENCE_STATUS_LABELS[evidence.status]}
            </Badge>
          </div>
          <p className="text-sm text-foreground-secondary">{evidence.source}</p>
          <p className="text-xs text-muted-foreground">
            {formatEvidenceConfidence(evidence.confidence_score)}
            {evidence.source_file_name ? ` · ${evidence.source_file_name}` : ""}
            {evidence.source_page ? ` · page ${evidence.source_page}` : ""}
          </p>
        </div>
        <div className="text-xs text-muted-foreground sm:min-w-[12rem] sm:text-right">
          <p>{formatEvidenceDate(evidence.created_at)}</p>
          <p>{evidence.author_name ? `Par ${evidence.author_name}` : "Auteur non renseigné"}</p>
        </div>
      </div>

      {evidence.note ? (
        <p className="mt-3 text-sm leading-6 text-foreground-secondary">{evidence.note}</p>
      ) : null}

      {(evidence.supersedes_evidence_id || evidence.replaced_by_evidence_id) ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {evidence.supersedes_evidence_id ? (
            <span className="rounded-full bg-muted px-2.5 py-1">
              Remplace {evidence.supersedes_evidence_id.slice(0, 8)}
            </span>
          ) : null}
          {evidence.replaced_by_evidence_id ? (
            <span className="rounded-full bg-muted px-2.5 py-1">
              Remplacée par {evidence.replaced_by_evidence_id.slice(0, 8)}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function EvidenceKindSection({
  kind,
  entries,
}: {
  kind: TakeoffLineEvidence["kind"];
  entries: TakeoffLineEvidence[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {EVIDENCE_KIND_LABELS[kind]}s
        </h3>
        <Badge variant="neutral" size="sm">
          {entries.length}
        </Badge>
      </div>
      <div className="space-y-3">
        {entries.map((evidence) => (
          <EvidenceCard key={evidence.evidence_id} evidence={evidence} />
        ))}
      </div>
    </section>
  );
}

export function TakeoffLineEvidencePanel({
  open,
  onOpenChange,
  jobId,
  versionId,
  lineId,
  lineLabel,
  sourceFileName,
  sourcePage,
  surfaceLabel = "Panneau preuves",
}: TakeoffLineEvidencePanelProps) {
  const [panelData, setPanelData] = useState<TakeoffLineEvidencePanelResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, TakeoffLineEvidencePanelResponse>>({});
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestKey = `${jobId}:${versionId}:${lineId}`;

  const loadPanel = useCallback(
    async (force = false) => {
      if (!open) {
        return;
      }

      const cached = cacheRef.current[requestKey];
      if (cached && !force) {
        setPanelData(cached);
        setError(null);
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setIsLoading(true);
      setError(null);

      try {
        const nextData = await fetchTakeoffLineEvidencePanel(
          jobId,
          lineId,
          { version_id: versionId },
          { signal: abortController.signal }
        );

        if (abortController.signal.aborted) {
          return;
        }

        cacheRef.current[requestKey] = nextData;
        setPanelData(nextData);
      } catch (nextError) {
        if (abortController.signal.aborted) {
          return;
        }

        setError(
          isTakeoffApiError(nextError)
            ? nextError.message
            : "Impossible de charger les preuves détaillées."
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [jobId, lineId, open, requestKey, versionId]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadPanel();
  }, [loadPanel, open]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const activeEvidenceByKind = useMemo(() => {
    const grouped: Record<TakeoffLineEvidence["kind"], TakeoffLineEvidence[]> = {
      fact: [],
      hypothesis: [],
      inference: [],
    };

    for (const evidence of panelData?.evidences ?? []) {
      grouped[evidence.kind].push(evidence);
    }

    return grouped;
  }, [panelData]);

  const hasNoEvidence =
    !isLoading &&
    !error &&
    panelData !== null &&
    panelData.evidences.length === 0 &&
    panelData.history.length === 0;

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
      <SheetContent
        side="right"
        className="gap-0 overflow-hidden bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl"
        data-testid="takeoff-line-evidence-panel"
      >
        <div
          className="border-b border-border bg-surface-subtle px-5 py-5 pr-14 sm:px-6 sm:pr-14"
          data-testid="takeoff-line-evidence-panel-header"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
                {surfaceLabel}
              </p>
              <SheetTitle className="mt-2 text-xl font-semibold break-words">
                {lineLabel}
              </SheetTitle>
              <SheetDescription className="mt-1">
                {buildLineContextLabel({ sourceFileName, sourcePage })}
              </SheetDescription>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void loadPanel(true)}
              disabled={isLoading}
            >
              {isLoading ? "Actualisation…" : "Actualiser"}
            </Button>
          </div>

          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border-subtle bg-surface p-3">
              <dt className="text-xs text-muted-foreground">Actives</dt>
              <dd className="mt-1 text-lg font-semibold text-foreground">
                {panelData?.evidences.length ?? 0}
              </dd>
            </div>
            <div className="rounded-lg border border-border-subtle bg-surface p-3">
              <dt className="text-xs text-muted-foreground">Historique</dt>
              <dd className="mt-1 text-lg font-semibold text-foreground">
                {panelData?.history.length ?? 0}
              </dd>
            </div>
            <div className="rounded-lg border border-border-subtle bg-surface p-3">
              <dt className="text-xs text-muted-foreground">Analyse</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-foreground">
                {jobId.slice(0, 8)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain bg-surface-subtle px-5 py-5 sm:px-6">
          {isLoading && panelData === null ? (
            <div
              role="status"
              className="rounded-xl border border-dashed border-border bg-surface p-5 text-sm text-muted-foreground"
            >
              Chargement des preuves détaillées…
            </div>
          ) : null}

          {error ? <Alert variant="danger">{error}</Alert> : null}

          {hasNoEvidence ? (
            <div className="rounded-xl border border-dashed border-border bg-surface p-5 text-sm text-muted-foreground">
              Aucune preuve détaillée n&apos;est disponible pour cette ligne.
            </div>
          ) : null}

          {panelData !== null ? (
            <>
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <h3 className="text-base font-semibold text-foreground">
                    Preuves actives
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Les faits, hypothèses et inférences encore validés pour la ligne.
                  </p>
                </div>
                <div className="space-y-5">
                  {EVIDENCE_KIND_ORDER.map((kind) =>
                    activeEvidenceByKind[kind].length > 0 ? (
                      <EvidenceKindSection
                        key={kind}
                        kind={kind}
                        entries={activeEvidenceByKind[kind]}
                      />
                    ) : null
                  )}
                  {panelData.evidences.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-surface p-5 text-sm text-muted-foreground">
                      Aucune preuve active.
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <h3 className="text-base font-semibold text-foreground">
                    Historique
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Preuves remplacées ou invalidées, pour conserver la trace explicable.
                  </p>
                </div>
                {panelData.history.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-surface p-5 text-sm text-muted-foreground">
                    Aucun historique sur cette ligne.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {panelData.history.map((evidence) => (
                      <EvidenceCard key={evidence.evidence_id} evidence={evidence} />
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default TakeoffLineEvidencePanel;
