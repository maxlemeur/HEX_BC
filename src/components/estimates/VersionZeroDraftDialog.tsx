"use client";

import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  fetchVersionZeroReview,
  generateVersionZeroDraft,
  materializeVersionZeroDraft,
  reviewVersionZeroLine,
  type VersionZeroDraftSummary,
  type VersionZeroReview,
  type VersionZeroReviewLine,
  type VersionZeroReviewLot,
} from "@/lib/estimates/client";
import { parseVersionZeroQuantityInput } from "@/lib/estimates/version-zero-utils";
import { cn } from "@/lib/utils";

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
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  ensureMutationCanProceed: (actionLabel: string) => Promise<boolean>;
  onClose: (result?: { materialized?: boolean }) => void;
};

const FILTER_LABELS: Record<ReviewFilter, string> = {
  all: "Tout",
  pending: "À revoir",
  accepted: "Validé",
  edited: "Édité",
  rejected: "Rejeté",
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

type StatusBadgeKey =
  | VersionZeroReviewLot["status"]
  | VersionZeroReviewLine["reviewStatus"];

const STATUS_BADGE: Record<
  StatusBadgeKey,
  { label: string; variant: "success" | "warning" | "danger" | "neutral" }
> = {
  generated: { label: "Généré", variant: "success" },
  accepted: { label: "Validé", variant: "success" },
  partial: { label: "Partiel", variant: "warning" },
  edited: { label: "Édité", variant: "warning" },
  missing: { label: "Manquant", variant: "danger" },
  rejected: { label: "Rejeté", variant: "danger" },
  pending: { label: "À revoir", variant: "neutral" },
};

const CONFIDENCE_LABELS: Record<VersionZeroReviewLine["confidenceLabel"], string> = {
  elevee: "Confiance élevée",
  moyenne: "Confiance moyenne",
  faible: "Confiance faible",
};

/** Native checkbox kept for keyboard and Playwright `check()`. */
const NATIVE_CHECKBOX_CLASS =
  "size-4 shrink-0 cursor-pointer rounded-sm accent-primary disabled:cursor-not-allowed disabled:opacity-50";

function confidenceText(value: number) {
  return `${Math.round(value * 100)}\u00a0%`;
}

export function VersionZeroDraftDialog({
  isOpen,
  versionId,
  summary,
  isMutationBlocked,
  mutationBlockedMessage,
  ensureMutationCanProceed,
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
  const isBusyRef = useRef(false);
  const mutationBlockRef = useRef({
    isBlocked: isMutationBlocked,
    message: mutationBlockedMessage,
  });

  useLayoutEffect(() => {
    mutationBlockRef.current = {
      isBlocked: isMutationBlocked,
      message: mutationBlockedMessage,
    };
  }, [isMutationBlocked, mutationBlockedMessage]);

  useEffect(() => {
    if (!isOpen) {
      isBusyRef.current = false;
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

    isBusyRef.current = true;
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
        isBusyRef.current = false;
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
  const canMaterialize = activeDraft?.counts.pending === 0;

  async function handleGenerate() {
    if (isMutationBlocked) {
      setErrorMessage(mutationBlockedMessage);
      return;
    }

    isBusyRef.current = true;
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
      setErrorMessage(error instanceof Error ? error.message : "Impossible de générer la V0.");
    } finally {
      isBusyRef.current = false;
      setIsBusy(false);
    }
  }

  async function handleReviewLine(
    line: VersionZeroReviewLine,
    reviewStatus: "accepted" | "edited" | "rejected"
  ) {
    if (!review) return;
    if (isMutationBlocked) {
      setErrorMessage(mutationBlockedMessage);
      return;
    }

    const edits = editingByLineId[line.id];
    let editedQuantity: number | null | undefined;
    if (reviewStatus === "edited") {
      const parsedQuantity = parseVersionZeroQuantityInput(
        edits?.quantity ??
          (line.effective.quantity === null ? "" : String(line.effective.quantity))
      );
      if (parsedQuantity.error) {
        setErrorMessage(parsedQuantity.error);
        return;
      }
      editedQuantity = parsedQuantity.quantity;
    }

    isBusyRef.current = true;
    setIsBusy(true);
    setErrorMessage(null);
    try {
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
                quantity: editedQuantity,
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
        error instanceof Error ? error.message : "Impossible de mettre à jour la ligne."
      );
    } finally {
      isBusyRef.current = false;
      setIsBusy(false);
    }
  }

  async function handleMaterialize() {
    if (!review) return;
    if (isMutationBlocked) {
      setErrorMessage(mutationBlockedMessage);
      return;
    }

    isBusyRef.current = true;
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const canProceed = await ensureMutationCanProceed(
        "matérialiser la version zéro"
      );
      if (!canProceed) {
        isBusyRef.current = false;
        setIsBusy(false);
        return;
      }

      if (mutationBlockRef.current.isBlocked) {
        setErrorMessage(mutationBlockRef.current.message);
        isBusyRef.current = false;
        setIsBusy(false);
        return;
      }

      await materializeVersionZeroDraft(versionId, review.draft.id);
      onClose({ materialized: true });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Impossible de matérialiser la V0."
      );
      isBusyRef.current = false;
      setIsBusy(false);
    }
  }

  function handleClose() {
    if (isBusyRef.current) return;
    onClose();
  }

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent
        size="xl"
        showCloseButton={false}
        className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-6xl sm:p-0"
        data-testid="version-zero-draft-dialog"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
          <DialogHeader className="min-w-0 flex-1 gap-2 pr-0">
            <Badge variant="warning" className="tracking-[0.18em] uppercase">
              IA – à revoir
            </Badge>
            <DialogTitle>Version zéro assistée</DialogTitle>
            <DialogDescription>
              Fait : aucune suggestion n&apos;est appliquée sans validation humaine explicite.
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleClose}
            disabled={isBusy}
          >
            Fermer
          </Button>
        </div>

        <DialogBody className="relative min-h-0 flex-1 gap-0 overflow-y-auto px-5 py-5 sm:px-6">
          {errorMessage ? (
            <Alert variant="danger" className="mb-4">
              {errorMessage}
            </Alert>
          ) : null}

          {!review ? (
            <div className="space-y-5">
              <section
                aria-labelledby="version-zero-generation-title"
                className="rounded-lg border border-border bg-surface-subtle p-5"
              >
                <div className="space-y-1">
                  <h3
                    id="version-zero-generation-title"
                    className="text-base font-semibold text-foreground"
                  >
                    Génération V0
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Hypothèse : la version courante est vide et un brief confirmé est disponible.
                  </p>
                </div>
                <fieldset className="mt-4">
                  <legend className="sr-only">Lots à générer</legend>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {(summary?.availableLots ?? []).map((lot) => {
                      const checked = selectedLots.includes(lot);
                      return (
                        <label
                          key={lot}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                            checked
                              ? "border-success-border bg-success-subtle text-success"
                              : "border-border bg-surface text-foreground-secondary"
                          )}
                        >
                          <input
                            type="checkbox"
                            className={NATIVE_CHECKBOX_CLASS}
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
                </fieldset>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Provenance : brief confirmé
                    {summary?.confirmedBriefId ? ` (${summary.confirmedBriefId})` : ""}.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={() => void handleGenerate()}
                    disabled={
                      isBusy ||
                      isMutationBlocked ||
                      selectedLots.length === 0 ||
                      !summary?.canGenerate
                    }
                  >
                    {isBusy ? "Génération…" : "Générer V0"}
                  </Button>
                </div>
              </section>
            </div>
          ) : (
            <div className="space-y-5">
              <dl className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                <StatTile label="Lignes" value={review.draft.counts.lines} />
                <StatTile
                  label="En attente"
                  value={review.draft.counts.pending}
                  valueClassName="text-warning"
                />
                <StatTile
                  label="Lots manquants"
                  value={review.draft.counts.missingLots}
                  valueClassName="text-danger"
                />
                <StatTile
                  label="Confiance faible"
                  value={review.draft.counts.lowConfidenceLines}
                />
              </dl>

              {review.draft.summaryText ? (
                <p className="rounded-lg border border-border bg-surface-subtle px-4 py-3 text-sm text-foreground-secondary">
                  Inférence : {review.draft.summaryText}
                </p>
              ) : null}

              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label="Filtrer les lignes"
              >
                {(Object.keys(FILTER_LABELS) as ReviewFilter[]).map((filterKey) => (
                  <button
                    key={filterKey}
                    type="button"
                    aria-pressed={filter === filterKey}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      filter === filterKey
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-border bg-surface text-foreground-secondary hover:bg-surface-subtle"
                    )}
                    onClick={() => setFilter(filterKey)}
                  >
                    {FILTER_LABELS[filterKey]}
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                {visibleLots.map((lot) => (
                  <Card key={lot.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-foreground">
                            {lot.label}
                          </h3>
                          <Badge variant={STATUS_BADGE[lot.status].variant}>
                            {STATUS_BADGE[lot.status].label}
                          </Badge>
                          {lot.confidence !== null ? (
                            <span className="text-xs text-muted-foreground">
                              Confiance {confidenceText(lot.confidence)}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Provenance : {lot.provenance.join(" • ") || "Non renseignée"}
                        </p>
                      </div>
                    </div>

                    {lot.riskSignals.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {lot.riskSignals.map((signal) => (
                          <span
                            key={signal}
                            className="rounded-full border border-danger-border bg-danger-subtle px-2.5 py-1 text-xs text-danger"
                          >
                            Risque : {signal}
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
                            className="rounded-lg border border-border bg-surface-subtle p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="font-semibold text-foreground">
                                    {line.proposed.title}
                                  </h4>
                                  <Badge variant={STATUS_BADGE[line.reviewStatus].variant}>
                                    {STATUS_BADGE[line.reviewStatus].label}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {CONFIDENCE_LABELS[line.confidenceLabel] ?? line.confidenceLabel}{" "}
                                    {confidenceText(line.confidence)}
                                  </span>
                                </div>
                                {line.proposed.description ? (
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {line.proposed.description}
                                  </p>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="md"
                                  onClick={() => void handleReviewLine(line, "accepted")}
                                  disabled={isBusy || isMutationBlocked}
                                >
                                  Accepter
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="md"
                                  onClick={() => void handleReviewLine(line, "rejected")}
                                  disabled={isBusy || isMutationBlocked}
                                >
                                  Rejeter
                                </Button>
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="md"
                                  onClick={() => void handleReviewLine(line, "edited")}
                                  disabled={isBusy || isMutationBlocked}
                                >
                                  Valider l&apos;édition
                                </Button>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              <div className="space-y-1.5">
                                <FieldLabel htmlFor={`version-zero-title-${line.id}`}>
                                  Libellé
                                </FieldLabel>
                                <Input
                                  id={`version-zero-title-${line.id}`}
                                  size="sm"
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
                              </div>
                              <div className="space-y-1.5">
                                <FieldLabel htmlFor={`version-zero-description-${line.id}`}>
                                  Description
                                </FieldLabel>
                                <Input
                                  id={`version-zero-description-${line.id}`}
                                  size="sm"
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
                              </div>
                              <div className="space-y-1.5">
                                <FieldLabel htmlFor={`version-zero-quantity-${line.id}`}>
                                  Quantité
                                </FieldLabel>
                                <Input
                                  id={`version-zero-quantity-${line.id}`}
                                  size="sm"
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
                              </div>
                              <div className="space-y-1.5">
                                <FieldLabel htmlFor={`version-zero-unit-${line.id}`}>
                                  Unité
                                </FieldLabel>
                                <Input
                                  id={`version-zero-unit-${line.id}`}
                                  size="sm"
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
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 lg:grid-cols-2">
                              <div className="rounded-lg border border-border bg-surface p-3 text-sm text-foreground-secondary">
                                <p className="font-medium text-foreground">Faits</p>
                                <ul className="mt-2 space-y-1">
                                  {line.facts.map((entry) => (
                                    <li key={entry}>• {entry}</li>
                                  ))}
                                </ul>
                              </div>
                              <div className="rounded-lg border border-border bg-surface p-3 text-sm text-foreground-secondary">
                                <p className="font-medium text-foreground">Hypothèses / inférences</p>
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
                                    className="rounded-full border border-warning-border bg-warning-subtle px-2.5 py-1 text-xs text-warning"
                                  >
                                    Manquant : {signal}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </Card>
                ))}
              </div>

              <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface py-4">
                <p className="text-sm text-muted-foreground">
                  Fait : la matérialisation reste bloquée tant qu&apos;il reste des lignes en attente.
                </p>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => void handleMaterialize()}
                  disabled={isBusy || isMutationBlocked || !canMaterialize}
                >
                  {isBusy ? "Application…" : "Matérialiser dans le devis"}
                </Button>
              </div>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function StatTile({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: number;
  valueClassName?: string;
}) {
  return (
    <Card className="p-4">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("mt-1 text-2xl font-semibold text-foreground tabular-nums", valueClassName)}>
        {value}
      </dd>
    </Card>
  );
}
