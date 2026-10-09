"use client";

import { useCallback, useId, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  detectAnomalies,
  ANOMALY_LABELS,
} from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import { getTakeoffVerificationReadiness } from "@/lib/takeoff/guards";
import { ChevronLeftIcon, ChevronRightIcon, TriangleAlertIcon, XIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EvidencePanelProps = {
  item: ReviewItem;
  itemIndex: number;
  totalItems: number;
  onClose: () => void;
  onNavigate: (direction: "prev" | "next") => void;
  onUpdateEvidence: (itemId: string, evidence: string | null) => void;
  onUpdateSourcePage: (itemId: string, sourcePage: number | null) => void;
  onMarkVerified: (itemId: string) => void;
  requiresLocalizedProof?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfidenceLabel(confidence: number | null): {
  label: string;
  variant: "success" | "warning" | "danger" | "neutral";
} {
  if (confidence === null) return { label: "Non évaluée", variant: "neutral" };
  const pct = Math.round(confidence * 100);
  if (pct >= 80) return { label: "Élevée", variant: "success" };
  if (pct >= 50) return { label: "Moyenne", variant: "warning" };
  return { label: "Faible", variant: "danger" };
}

function getBarClass(confidence: number | null): string {
  if (confidence === null) return "bg-border-strong";
  const pct = confidence * 100;
  if (pct >= 80) return "bg-success";
  if (pct >= 50) return "bg-warning";
  return "bg-danger";
}

const SIGNED_DOCUMENT_URL_KEYS = [
  "signed_document_url",
  "source_signed_url",
  "source_document_url",
  "source_file_signed_url",
  "download_url",
  "signed_url",
] as const;

const SIGNED_DOCUMENT_NESTED_KEYS = [
  "source",
  "document",
  "signed_document",
  "source_document",
] as const;

const NESTED_URL_KEYS = [
  "signed_url",
  "signedUrl",
  "download_url",
  "downloadUrl",
  "url",
] as const;

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSafeHttpUrl(value: unknown): string | null {
  const normalized = toNonEmptyString(value);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function resolveSignedDocumentUrl(metadata: Record<string, unknown>): string | null {
  for (const key of SIGNED_DOCUMENT_URL_KEYS) {
    const directUrl = toSafeHttpUrl(metadata[key]);
    if (directUrl) return directUrl;
  }

  for (const containerKey of SIGNED_DOCUMENT_NESTED_KEYS) {
    const container = metadata[containerKey];
    if (!container || typeof container !== "object" || Array.isArray(container)) {
      continue;
    }
    const containerRecord = container as Record<string, unknown>;
    for (const nestedKey of NESTED_URL_KEYS) {
      const nestedUrl = toSafeHttpUrl(containerRecord[nestedKey]);
      if (nestedUrl) return nestedUrl;
    }
  }

  return null;
}

function buildSignedDocumentHref(url: string, sourcePage: number | null): string {
  if (!sourcePage || sourcePage < 1 || url.includes("#")) {
    return url;
  }

  try {
    const parsed = new URL(url);
    parsed.hash = `page=${sourcePage}`;
    return parsed.toString();
  } catch {
    return `${url}#page=${sourcePage}`;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const INVALID_SOURCE_PAGE_MESSAGE =
  "Saisissez un numéro de page entier supérieur à 0.";

function getSourcePageError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) {
    return INVALID_SOURCE_PAGE_MESSAGE;
  }
  return null;
}

export function EvidencePanel({
  item,
  itemIndex,
  totalItems,
  onClose,
  onNavigate,
  onUpdateEvidence,
  onUpdateSourcePage,
  onMarkVerified,
  requiresLocalizedProof = false,
}: EvidencePanelProps) {
  // NOTE: Parent must render with key={item.id} to reset state on item change
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.evidence ?? "");
  const [editPageValue, setEditPageValue] = useState(
    item.source_page?.toString() ?? ""
  );
  const [pageError, setPageError] = useState<string | null>(null);
  const evidenceInputId = useId();
  const sourcePageInputId = useId();
  const sourcePageHelpId = useId();
  const sourcePageErrorId = useId();
  const verificationStatusId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasInvalidSourcePage =
    requiresLocalizedProof && getSourcePageError(editPageValue) !== null;

  // Focus trap, Escape and focus restoration come from the Sheet (Base UI dialog).
  // Escape is ignored while editing so an unsaved proof is not lost.
  const handleOpenChange = useCallback(
    (open: boolean, details: { reason: string; cancel: () => void }) => {
      if (open) return;
      if (isEditing && details.reason === "escape-key") {
        details.cancel();
        return;
      }
      onClose();
    },
    [isEditing, onClose]
  );

  // Arrow keys move between items (not while editing)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isEditing) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onNavigate("prev");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onNavigate("next");
      }
    },
    [isEditing, onNavigate]
  );

  // Evidence edit handlers
  const handleStartEdit = useCallback(() => {
    const focusOrigin = document.activeElement;
    setEditValue(item.evidence ?? "");
    setEditPageValue(item.source_page?.toString() ?? "");
    setPageError(null);
    setIsEditing(true);
    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (
        activeElement === focusOrigin ||
        activeElement === document.body ||
        activeElement === panelRef.current
      ) {
        textareaRef.current?.focus();
      }
    });
  }, [item.evidence, item.source_page]);

  const handleSaveEvidence = useCallback(() => {
    const trimmed = editValue.trim();
    const nextEvidence = trimmed.length > 0 ? trimmed : null;
    let nextSourcePage = item.source_page;

    if (requiresLocalizedProof) {
      const trimmedPage = editPageValue.trim();
      const nextPageError = getSourcePageError(editPageValue);
      if (nextPageError) {
        setPageError(nextPageError);
        return;
      }
      if (trimmedPage.length === 0) {
        nextSourcePage = null;
      } else {
        nextSourcePage = Number(trimmedPage);
      }
    }

    if (nextEvidence !== item.evidence) {
      onUpdateEvidence(item.id, nextEvidence);
    }
    if (requiresLocalizedProof && nextSourcePage !== item.source_page) {
      onUpdateSourcePage(item.id, nextSourcePage);
    }
    setPageError(null);
    setIsEditing(false);
  }, [
    editPageValue,
    editValue,
    item.evidence,
    item.id,
    item.source_page,
    onUpdateEvidence,
    onUpdateSourcePage,
    requiresLocalizedProof,
  ]);

  const handleCancelEdit = useCallback(() => {
    setEditValue(item.evidence ?? "");
    setEditPageValue(item.source_page?.toString() ?? "");
    setPageError(null);
    setIsEditing(false);
  }, [item.evidence, item.source_page]);

  const anomalies = detectAnomalies(item);
  const { label: confLabel, variant: confVariant } = getConfidenceLabel(item.confidence);
  const pct = item.confidence !== null ? Math.round(item.confidence * 100) : null;
  const barClass = getBarClass(item.confidence);
  const signedDocumentUrl = resolveSignedDocumentUrl(item.metadata);
  const signedDocumentHref = signedDocumentUrl
    ? buildSignedDocumentHref(signedDocumentUrl, item.source_page)
    : null;
  const verificationReadiness = getTakeoffVerificationReadiness(item);
  const canVerify =
    !requiresLocalizedProof || verificationReadiness.canVerify;
  const hasInvalidRecordedVerification =
    requiresLocalizedProof && item.is_verified && !verificationReadiness.canVerify;

  return (
    <Sheet open onOpenChange={handleOpenChange}>
      <SheetContent
        ref={panelRef}
        side="right"
        showCloseButton={false}
        onKeyDown={handleKeyDown}
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        {/* ---- Header ---- */}
        <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-sm font-semibold">Preuve de l’item</SheetTitle>
              <span className="text-xs text-muted-foreground">
                {itemIndex + 1}/{totalItems}
              </span>
            </div>
            <SheetDescription className="truncate text-xs">
              {item.designation || "Item sans désignation"}
            </SheetDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label="Item précédent (flèche gauche)"
              icon={<ChevronLeftIcon aria-hidden="true" />}
              onClick={() => onNavigate("prev")}
              disabled={itemIndex === 0}
            />
            <IconButton
              label="Item suivant (flèche droite)"
              icon={<ChevronRightIcon aria-hidden="true" />}
              onClick={() => onNavigate("next")}
              disabled={itemIndex === totalItems - 1}
            />
            <SheetClose
              render={<Button variant="ghost" size="icon-sm" aria-label="Fermer (Échap)" />}
            >
              <XIcon aria-hidden="true" />
            </SheetClose>
          </div>
        </div>

        {/* ---- Scrollable body ---- */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* Designation */}
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Désignation
            </p>
            <p className="mt-1 break-words text-sm text-foreground">
              {item.designation || <span className="italic text-muted-foreground">Vide</span>}
            </p>
          </div>

          {/* Confidence gauge */}
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Confiance
            </p>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${barClass}`}
                  style={{ width: pct !== null ? `${pct}%` : "0%" }}
                />
              </div>
              <Badge variant={confVariant} size="sm">
                {pct !== null ? `${pct} %` : "—"}
              </Badge>
              <span className="text-xs text-muted-foreground">{confLabel}</span>
            </div>
          </div>

          {/* Source */}
          {(item.source_file_name || item.source_page !== null || signedDocumentHref) && (
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Source
              </p>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {item.source_file_name && (
                  <span>{item.source_file_name}</span>
                )}
                {item.source_page !== null && (
                  <span className="ml-1">
                    page {item.source_page}
                  </span>
                )}
              </p>
              {signedDocumentHref && (
                <a
                  href={signedDocumentHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex text-xs font-medium text-info hover:underline"
                >
                  Ouvrir le document source
                  <span className="sr-only"> (nouvel onglet)</span>
                </a>
              )}
            </div>
          )}

          {/* Anomalies */}
          {anomalies.length > 0 && (
            <div className="rounded-lg border border-warning-border bg-warning-subtle p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <TriangleAlertIcon aria-hidden="true" className="size-4" />
                Anomalies détectées
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-foreground-secondary">
                {anomalies.map((a) => (
                  <li key={a}>{ANOMALY_LABELS[a]}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Evidence text */}
          <div>
            <div className="flex items-center justify-between gap-2">
              {isEditing ? (
                <label
                  htmlFor={evidenceInputId}
                  className="text-xs font-medium uppercase text-muted-foreground"
                >
                  Preuve
                </label>
              ) : (
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Preuve
                </p>
              )}
              {!isEditing && (
                <Button variant="link" size="xs" onClick={handleStartEdit}>
                  {requiresLocalizedProof
                    ? "Modifier la preuve et la page"
                    : "Modifier"}
                </Button>
              )}
            </div>

            {isEditing ? (
              <div className="mt-2 space-y-2">
                <Textarea
                  id={evidenceInputId}
                  ref={textareaRef}
                  name="takeoff-item-evidence"
                  className="text-sm"
                  rows={5}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  maxLength={2000}
                  placeholder="Décrivez le fait observé dans le plan…"
                  autoComplete="off"
                />
                {requiresLocalizedProof ? (
                  <div>
                    <label
                      htmlFor={sourcePageInputId}
                      className="text-xs font-medium text-foreground-secondary"
                    >
                      Page source
                    </label>
                    <Input
                      id={sourcePageInputId}
                      name="takeoff-item-source-page"
                      type="number"
                      size="sm"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={editPageValue}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setEditPageValue(nextValue);
                        setPageError(getSourcePageError(nextValue));
                      }}
                      aria-invalid={pageError ? "true" : undefined}
                      aria-describedby={
                        pageError
                          ? `${sourcePageHelpId} ${sourcePageErrorId}`
                          : sourcePageHelpId
                      }
                      className="mt-1 w-28"
                      placeholder="Ex. 3"
                      autoComplete="off"
                    />
                    <p
                      id={sourcePageHelpId}
                      className="mt-1 text-xs text-muted-foreground"
                    >
                      Numéro de la page où cette quantité peut être contrôlée.
                    </p>
                    {pageError ? (
                      <p
                        id={sourcePageErrorId}
                        role="alert"
                        className="mt-1 text-xs font-medium text-danger"
                      >
                        {pageError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {editValue.length}/2000
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleCancelEdit}>
                      Annuler
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={hasInvalidSourcePage}
                      onClick={handleSaveEvidence}
                    >
                      Sauvegarder
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-2">
                {item.evidence ? (
                  <div className="whitespace-pre-wrap rounded-lg border border-border bg-surface-subtle px-3 py-2.5 text-sm leading-relaxed text-foreground-secondary">
                    {item.evidence}
                  </div>
                ) : (
                  <p className="text-sm italic text-muted-foreground">
                    Aucune preuve disponible.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {requiresLocalizedProof && !verificationReadiness.canVerify ? (
          <div
            id={verificationStatusId}
            className="mx-4 mb-3 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-xs text-foreground-secondary"
            role="status"
          >
            <span className="font-semibold">
              {item.is_verified ? "Validation à reprendre : " : "Validation impossible : "}
            </span>
            {verificationReadiness.message}
            {" "}
            Utilisez « Modifier la preuve et la page » pour compléter la source.
          </div>
        ) : null}

        {/* ---- Footer ---- */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span className="text-micro text-muted-foreground">
            ← → naviguer · Échap fermer
          </span>

          {item.is_verified ? (
            <Badge variant={hasInvalidRecordedVerification ? "warning" : "info"} size="sm">
              {hasInvalidRecordedVerification ? "Validation incomplète" : "Validé"}
            </Badge>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onMarkVerified(item.id)}
              disabled={!canVerify}
              aria-describedby={!canVerify ? verificationStatusId : undefined}
            >
              Valider cet item
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
