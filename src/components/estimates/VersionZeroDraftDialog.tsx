"use client";

import { startTransition, useEffect, useMemo, useState } from "react";

import {
  fetchVersionZeroReview,
  generateVersionZeroDraft,
  materializeVersionZeroDraft,
  reviewVersionZeroLine,
  type VersionZeroDraftSummary,
  type VersionZeroReview,
  type VersionZeroReviewLine,
} from "@/lib/estimates/client";

type ReviewFilter =
  | "all"
  | "pending"
  | "accepted"
  | "edited"
  | "rejected"
  | "low_confidence"
  | "missing";

export type VersionZeroDraftDialogProps = {
  isOpen: boolean;
  versionId: string;
  summary: VersionZeroDraftSummary | null;
  onClose: (result?: { materialized?: boolean }) => void;
};

const FILTER_LABELS: Record<ReviewFilter, string> = {
  all: "Tout",
  pending: "A revoir",
  accepted: "Valide",
  edited: "Edite",
  rejected: "Rejete",
  low_confidence: "Confiance faible",
  missing: "Manquant",
};

function lineMatchesFilter(line: VersionZeroReviewLine, filter: ReviewFilter) {
  switch (filter) {
    case "pending":
    case "accepted":
    case "edited":
    case "rejected":
      return line.reviewStatus === filter;
    case "low_confidence":
      return line.confidence < 0.55;
    case "missing":
      return line.missingSignals.length > 0;
    case "all":
    default:
      return true;
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "generated":
    case "accepted":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "partial":
    case "edited":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "missing":
    case "rejected":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function confidenceText(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function VersionZeroDraftDialog({
  isOpen,
  versionId,
  summary,
  onClose,
}: VersionZeroDraftDialogProps) {
  const [selectedLots, setSelectedLots] = useState<string[]>([]);
  const [review, setReview] = useState<VersionZeroReview | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [editingByLineId, setEditingByLineId] = useState<
    Record<
      string,
      {
        title: string;
        description: string;
        quantity: string;
        unit: string;
      }
    >
  >({});

  useEffect(() => {
    if (!isOpen) {
      setSelectedLots(summary?.availableLots ?? []);
      setReview(null);
      setIsBusy(false);
      setErrorMessage(null);
      setFilter("all");
      setEditingByLineId({});
      return;
    }

    setSelectedLots(summary?.activeDraft?.selectedLots ?? summary?.availableLots ?? []);
    setErrorMessage(null);

    if (!summary?.activeDraft) {
      setReview(null);
      return;
    }

    setIsBusy(true);
    void fetchVersionZeroReview(versionId, summary.activeDraft.id)
      .then((result) => {
        startTransition(() => {
          setReview(result);
        });
      })
      .catch((error: unknown) => {
        setErrorMessage(
          error instanceof Error ? error.message : "Impossible de charger la V0."
        );
      })
      .finally(() => {
        setIsBusy(false);
      });
  }, [isOpen, summary, versionId]);

  const visibleLots = useMemo(() => {
    if (!review) return [];
    return review.lots
      .map((lot) => ({
        ...lot,
        lines: lot.lines.filter((line) => lineMatchesFilter(line, filter)),
      }))
      .filter((lot) => lot.lines.length > 0 || filter === "all" || filter === "missing");
  }, [filter, review]);

  if (!isOpen) {
    return null;
  }

  const activeDraft = review?.draft ?? null;
  const canMaterialize = Boolean(activeDraft) && activeDraft.counts.pending === 0;

  async function handleGenerate() {
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const nextReview = await generateVersionZeroDraft(versionId, {
        briefId: summary?.confirmedBriefId ?? null,
        selectedLots,
      });
      startTransition(() => {
        setReview(nextReview);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Impossible de generer la V0.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReviewLine(
    line: VersionZeroReviewLine,
    reviewStatus: "accepted" | "edited" | "rejected"
  ) {
    if (!review) return;

    setIsBusy(true);
    setErrorMessage(null);
    try {
      const edits = editingByLineId[line.id];
      const nextReview = await reviewVersionZeroLine(
        versionId,
        review.draft.id,
        line.id,
        reviewStatus === "edited"
          ? {
              reviewStatus,
              editedValues: {
                title: edits?.title ?? line.effective.title,
                description: edits?.description ?? line.effective.description,
                quantity:
                  edits?.quantity && edits.quantity.trim().length > 0
                    ? Number.parseFloat(edits.quantity)
                    : null,
                unit: edits?.unit ?? line.effective.unit,
              },
            }
          : { reviewStatus }
      );
      startTransition(() => {
        setReview(nextReview);
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Impossible de mettre a jour la ligne."
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleMaterialize() {
    if (!review) return;
    setIsBusy(true);
    setErrorMessage(null);
    try {
      await materializeVersionZeroDraft(versionId, review.draft.id);
      onClose({ materialized: true });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Impossible de materialiser la V0."
      );
      setIsBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 overscroll-contain"
      data-testid="version-zero-draft-dialog"
    >
      <div className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-[var(--slate-200)] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--slate-200)] px-6 py-5">
          <div className="space-y-2">
            <div className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
              IA - a revoir
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--slate-900)]">
                Version zero assistee
              </h2>
              <p className="text-sm text-[var(--slate-600)]">
                Fait: aucune suggestion n&apos;est appliquee sans validation humaine explicite.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onClose()}
          >
            Fermer
          </button>
        </div>

        <div className="max-h-[calc(92vh-88px)] overflow-y-auto px-6 py-5">
          {errorMessage ? (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
            >
              {errorMessage}
            </div>
          ) : null}

          {!review ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-5">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-[var(--slate-900)]">
                    Generation V0
                  </h3>
                  <p className="text-sm text-[var(--slate-600)]">
                    Hypothese: la version courante est vide et un brief confirme est disponible.
                  </p>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {(summary?.availableLots ?? []).map((lot) => {
                    const checked = selectedLots.includes(lot);
                    return (
                      <label
                        key={lot}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
                          checked
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-[var(--slate-200)] bg-white text-[var(--slate-700)]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedLots((current) =>
                              checked
                                ? current.filter((entry) => entry !== lot)
                                : [...current, lot]
                            );
                          }}
                        />
                        <span>{lot}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-sm text-[var(--slate-600)]">
                    Provenance: brief confirme
                    {summary?.confirmedBriefId ? ` (${summary.confirmedBriefId})` : ""}.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleGenerate()}
                    disabled={isBusy || selectedLots.length === 0 || !summary?.canGenerate}
                  >
                    {isBusy ? "Generation..." : "Generer V0"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-[var(--slate-200)] bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-[var(--slate-500)]">
                    Lignes
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-[var(--slate-900)]">
                    {review.draft.counts.lines}
                  </div>
                </div>
                <div className="rounded-2xl border border-[var(--slate-200)] bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-[var(--slate-500)]">
                    En attente
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-amber-700">
                    {review.draft.counts.pending}
                  </div>
                </div>
                <div className="rounded-2xl border border-[var(--slate-200)] bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-[var(--slate-500)]">
                    Lots manquants
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-rose-700">
                    {review.draft.counts.missingLots}
                  </div>
                </div>
                <div className="rounded-2xl border border-[var(--slate-200)] bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-[var(--slate-500)]">
                    Confiance faible
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-[var(--slate-900)]">
                    {review.draft.counts.lowConfidenceLines}
                  </div>
                </div>
              </div>

              {review.draft.summaryText ? (
                <div className="rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3 text-sm text-[var(--slate-700)]">
                  Inference: {review.draft.summaryText}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(FILTER_LABELS) as ReviewFilter[]).map((filterKey) => (
                  <button
                    key={filterKey}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-sm ${
                      filter === filterKey
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                        : "border-[var(--slate-200)] bg-white text-[var(--slate-700)]"
                    }`}
                    onClick={() => setFilter(filterKey)}
                  >
                    {FILTER_LABELS[filterKey]}
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                {visibleLots.map((lot) => (
                  <section
                    key={lot.id}
                    className="rounded-2xl border border-[var(--slate-200)] bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-[var(--slate-900)]">
                            {lot.label}
                          </h3>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(
                              lot.status
                            )}`}
                          >
                            {lot.status}
                          </span>
                          {lot.confidence !== null ? (
                            <span className="text-xs text-[var(--slate-500)]">
                              Confiance {confidenceText(lot.confidence)}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-[var(--slate-600)]">
                          Provenance: {lot.provenance.join(" • ") || "Non renseignee"}
                        </p>
                      </div>
                    </div>

                    {lot.riskSignals.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {lot.riskSignals.map((signal) => (
                          <span
                            key={signal}
                            className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs text-rose-700"
                          >
                            Risque: {signal}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-4 space-y-3">
                      {lot.lines.map((line) => {
                        const edits = editingByLineId[line.id] ?? {
                          title: line.effective.title,
                          description: line.effective.description ?? "",
                          quantity:
                            line.effective.quantity === null
                              ? ""
                              : String(line.effective.quantity),
                          unit: line.effective.unit ?? "",
                        };

                        return (
                          <article
                            key={line.id}
                            className="rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="font-semibold text-[var(--slate-900)]">
                                    {line.proposed.title}
                                  </h4>
                                  <span
                                    className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClass(
                                      line.reviewStatus
                                    )}`}
                                  >
                                    {line.reviewStatus}
                                  </span>
                                  <span className="text-xs text-[var(--slate-500)]">
                                    {line.confidenceLabel} {confidenceText(line.confidence)}
                                  </span>
                                </div>
                                {line.proposed.description ? (
                                  <p className="mt-1 text-sm text-[var(--slate-600)]">
                                    {line.proposed.description}
                                  </p>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => void handleReviewLine(line, "accepted")}
                                  disabled={isBusy}
                                >
                                  Accepter
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => void handleReviewLine(line, "rejected")}
                                  disabled={isBusy}
                                >
                                  Rejeter
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => void handleReviewLine(line, "edited")}
                                  disabled={isBusy}
                                >
                                  Valider l&apos;edition
                                </button>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              <label className="text-sm">
                                <span className="mb-1 block text-[var(--slate-600)]">Libelle</span>
                                <input
                                  className="form-input w-full"
                                  name={`version-zero-title-${line.id}`}
                                  autoComplete="off"
                                  value={edits.title}
                                  onChange={(event) =>
                                    setEditingByLineId((current) => ({
                                      ...current,
                                      [line.id]: {
                                        ...edits,
                                        title: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                              <label className="text-sm">
                                <span className="mb-1 block text-[var(--slate-600)]">Description</span>
                                <input
                                  className="form-input w-full"
                                  name={`version-zero-description-${line.id}`}
                                  autoComplete="off"
                                  value={edits.description}
                                  onChange={(event) =>
                                    setEditingByLineId((current) => ({
                                      ...current,
                                      [line.id]: {
                                        ...edits,
                                        description: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                              <label className="text-sm">
                                <span className="mb-1 block text-[var(--slate-600)]">Quantite</span>
                                <input
                                  className="form-input w-full"
                                  name={`version-zero-quantity-${line.id}`}
                                  autoComplete="off"
                                  inputMode="decimal"
                                  value={edits.quantity}
                                  onChange={(event) =>
                                    setEditingByLineId((current) => ({
                                      ...current,
                                      [line.id]: {
                                        ...edits,
                                        quantity: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                              <label className="text-sm">
                                <span className="mb-1 block text-[var(--slate-600)]">Unite</span>
                                <input
                                  className="form-input w-full"
                                  name={`version-zero-unit-${line.id}`}
                                  autoComplete="off"
                                  value={edits.unit}
                                  onChange={(event) =>
                                    setEditingByLineId((current) => ({
                                      ...current,
                                      [line.id]: {
                                        ...edits,
                                        unit: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                            </div>

                            <div className="mt-4 grid gap-3 lg:grid-cols-2">
                              <div className="rounded-xl border border-[var(--slate-200)] bg-white p-3 text-sm text-[var(--slate-700)]">
                                <div className="font-medium text-[var(--slate-900)]">Faits</div>
                                <ul className="mt-2 space-y-1">
                                  {line.facts.map((entry) => (
                                    <li key={entry}>• {entry}</li>
                                  ))}
                                </ul>
                              </div>
                              <div className="rounded-xl border border-[var(--slate-200)] bg-white p-3 text-sm text-[var(--slate-700)]">
                                <div className="font-medium text-[var(--slate-900)]">Hypotheses / inferences</div>
                                <ul className="mt-2 space-y-1">
                                  {[...line.hypotheses, ...line.inferences].map((entry) => (
                                    <li key={entry}>• {entry}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>

                            {line.missingSignals.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {line.missingSignals.map((signal) => (
                                  <span
                                    key={signal}
                                    className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800"
                                  >
                                    Manquant: {signal}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--slate-200)] bg-white py-4">
                <p className="text-sm text-[var(--slate-600)]">
                  Fait: la materialisation reste bloquee tant qu&apos;il reste des lignes en attente.
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleMaterialize()}
                  disabled={isBusy || !canMaterialize}
                >
                  {isBusy ? "Application..." : "Materialiser dans le devis"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
