"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui-legacy/Modal";
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
    <article className="rounded-3xl border border-border bg-surface p-4 shadow-sm">
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
        <div className="min-w-[12rem] text-right text-xs text-muted-foreground">
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
              Remplacee par {evidence.replaced_by_evidence_id.slice(0, 8)}
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
            : "Impossible de charger les preuves detaillees."
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
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content
        className="ml-auto flex h-full max-h-[calc(100vh-2rem)] max-w-3xl flex-col overflow-hidden rounded-[28px] p-0 sm:rounded-l-[28px] sm:rounded-r-none"
        data-testid="takeoff-line-evidence-panel"
      >
        <div
          className="border-b border-border bg-[linear-gradient(135deg,rgba(241,245,249,0.9),rgba(255,255,255,0.98))] px-5 py-5 sm:px-6"
          data-testid="takeoff-line-evidence-panel-header"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {surfaceLabel}
              </p>
              <Modal.Title className="mt-2 text-xl text-foreground">
                {lineLabel}
              </Modal.Title>
              <p className="mt-1 text-sm text-muted-foreground">
                {buildLineContextLabel({ sourceFileName, sourcePage })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void loadPanel(true)}
                disabled={isLoading}
              >
                {isLoading ? "Actualisation…" : "Actualiser"}
              </Button>
              <Modal.Close />
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/80 bg-surface/80 p-3">
              <p className="text-xs text-muted-foreground">Actives</p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {panelData?.evidences.length ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-surface/80 p-3">
              <p className="text-xs text-muted-foreground">Historique</p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {panelData?.history.length ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-surface/80 p-3">
              <p className="text-xs text-muted-foreground">Job</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {jobId.slice(0, 8)}
              </p>
            </div>
          </div>
        </div>

        <Modal.Body className="flex-1 space-y-5 overflow-y-auto bg-surface-subtle px-5 py-5 sm:px-6">
          {isLoading && panelData === null ? (
            <div className="rounded-3xl border border-dashed border-border bg-surface p-5 text-sm text-muted-foreground">
              Chargement des preuves detaillees...
            </div>
          ) : null}

          {error ? (
            <div className="rounded-3xl border border-danger-border bg-danger-subtle px-4 py-3 text-sm text-danger">
              {error}
            </div>
          ) : null}

          {hasNoEvidence ? (
            <div className="rounded-3xl border border-dashed border-border bg-surface p-5 text-sm text-muted-foreground">
              Aucune preuve détaillée n&apos;est disponible pour cette ligne.
            </div>
          ) : null}

          {panelData !== null ? (
            <>
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-foreground">
                    Preuves actives
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Les faits, hypothèses et inferences encore validés pour la ligne.
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
                    <div className="rounded-3xl border border-dashed border-border bg-surface p-5 text-sm text-muted-foreground">
                      Aucune preuve active.
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-foreground">
                    Historique
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Preuves remplacees ou invalidees, pour conserver la trace explicable.
                  </p>
                </div>
                {panelData.history.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-border bg-surface p-5 text-sm text-muted-foreground">
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
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

export default TakeoffLineEvidencePanel;
