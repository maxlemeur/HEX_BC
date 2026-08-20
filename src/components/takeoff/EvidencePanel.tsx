"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Badge } from "@/components/ui-legacy/Badge";
import { Button } from "@/components/ui-legacy/Button";
import {
  detectAnomalies,
  ANOMALY_LABELS,
} from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import { getTakeoffVerificationReadiness } from "@/lib/takeoff/guards";

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
  variant: "success" | "warning" | "error" | "neutral";
} {
  if (confidence === null) return { label: "Non évaluée", variant: "neutral" };
  const pct = Math.round(confidence * 100);
  if (pct >= 80) return { label: "Élevée", variant: "success" };
  if (pct >= 50) return { label: "Moyenne", variant: "warning" };
  return { label: "Faible", variant: "error" };
}

function getBarColor(confidence: number | null): string {
  if (confidence === null) return "var(--slate-300)";
  const pct = confidence * 100;
  if (pct >= 80) return "var(--success)";
  if (pct >= 50) return "var(--warning)";
  return "var(--danger)";
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

  // Focus panel on open, restore focus to the trigger on close
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Piège de focus : Tab reste confiné au tiroir modal (sinon le focus
      // s'échappe vers la table sous-jacente, incohérent avec aria-modal).
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }

      if (isEditing) return; // Don't navigate while editing

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onNavigate("prev");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onNavigate("next");
      }
    },
    [isEditing, onClose, onNavigate]
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
  const barColor = getBarColor(item.confidence);
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
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Preuve de l’item : ${item.designation}`}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="animate-slide-in-right fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[var(--border)] bg-white shadow-xl outline-none"
      >
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">
              Preuve de l’item
            </h2>
            <span className="text-xs text-[var(--slate-500)]">
              {itemIndex + 1}/{totalItems}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded p-1 text-[var(--slate-500)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-700)] disabled:opacity-30"
              onClick={() => onNavigate("prev")}
              disabled={itemIndex === 0}
              aria-label="Item précédent (flèche gauche)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              type="button"
              className="rounded p-1 text-[var(--slate-500)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-700)] disabled:opacity-30"
              onClick={() => onNavigate("next")}
              disabled={itemIndex === totalItems - 1}
              aria-label="Item suivant (flèche droite)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              type="button"
              className="ml-1 rounded p-1 text-[var(--slate-500)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-700)]"
              onClick={onClose}
              aria-label="Fermer (Échap)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>

        {/* ---- Scrollable body ---- */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Designation */}
          <div>
            <p className="text-xs font-medium uppercase text-[var(--slate-500)]">
              Désignation
            </p>
            <p className="mt-1 text-sm text-[var(--slate-800)]">
              {item.designation || <span className="italic text-[var(--slate-400)]">Vide</span>}
            </p>
          </div>

          {/* Confidence gauge */}
          <div>
            <p className="text-xs font-medium uppercase text-[var(--slate-500)]">
              Confiance
            </p>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--slate-100)]">
                <div
                  className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                  style={{
                    width: pct !== null ? `${pct}%` : "0%",
                    backgroundColor: barColor,
                  }}
                />
              </div>
              <Badge variant={confVariant} size="sm">
                {pct !== null ? `${pct}%` : "-"}
              </Badge>
              <span className="text-xs text-[var(--slate-600)]">{confLabel}</span>
            </div>
          </div>

          {/* Source */}
          {(item.source_file_name || item.source_page !== null || signedDocumentHref) && (
            <div>
              <p className="text-xs font-medium uppercase text-[var(--slate-500)]">
                Source
              </p>
              <p className="mt-1 text-sm text-[var(--slate-600)]">
                {item.source_file_name && (
                  <span>{item.source_file_name}</span>
                )}
                {item.source_page !== null && (
                  <span className="ml-1 text-[var(--slate-400)]">
                    page {item.source_page}
                  </span>
                )}
              </p>
              {signedDocumentHref && (
                <a
                  href={signedDocumentHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex text-xs font-medium text-[var(--info)] hover:underline"
                >
                  Ouvrir le document source
                </a>
              )}
            </div>
          )}

          {/* Anomalies */}
          {anomalies.length > 0 && (
            <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-light)] p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--warning)]">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
                Anomalies détectées
              </div>
              <ul className="mt-2 space-y-1 text-xs text-[var(--slate-700)]">
                {anomalies.map((a) => (
                  <li key={a}>• {ANOMALY_LABELS[a]}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Evidence text */}
          <div>
            <div className="flex items-center justify-between">
              {isEditing ? (
                <label
                  htmlFor={evidenceInputId}
                  className="text-xs font-medium uppercase text-[var(--slate-500)]"
                >
                  Preuve
                </label>
              ) : (
                <p className="text-xs font-medium uppercase text-[var(--slate-500)]">
                  Preuve
                </p>
              )}
              {!isEditing && (
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--info)] hover:underline"
                  onClick={handleStartEdit}
                >
                  {requiresLocalizedProof
                    ? "Modifier la preuve et la page"
                    : "Modifier"}
                </button>
              )}
            </div>

            {isEditing ? (
              <div className="mt-2 space-y-2">
                <textarea
                  id={evidenceInputId}
                  ref={textareaRef}
                  name="takeoff-item-evidence"
                  className="block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
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
                      className="text-xs font-medium text-[var(--slate-700)]"
                    >
                      Page source
                    </label>
                    <input
                      id={sourcePageInputId}
                      name="takeoff-item-source-page"
                      type="number"
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
                      className="mt-1 block w-28 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                      placeholder="Ex. 3"
                      autoComplete="off"
                    />
                    <p
                      id={sourcePageHelpId}
                      className="mt-1 text-xs text-[var(--slate-500)]"
                    >
                      Numéro de la page où cette quantité peut être contrôlée.
                    </p>
                    {pageError ? (
                      <p
                        id={sourcePageErrorId}
                        role="alert"
                        className="mt-1 text-xs font-medium text-[var(--danger)]"
                      >
                        {pageError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--slate-400)]">
                    {editValue.length}/2000
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={handleCancelEdit}>
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
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--slate-50)] px-3 py-2.5 text-sm leading-relaxed text-[var(--slate-700)] whitespace-pre-wrap">
                    {item.evidence}
                  </div>
                ) : (
                  <p className="text-sm italic text-[var(--slate-400)]">
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
            className="mx-4 mb-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-3 py-2 text-xs text-[var(--slate-700)]"
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
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
          <span className="text-[10px] text-[var(--slate-400)]">
            ← → naviguer &middot; Échap fermer
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
      </div>
    </>
  );
}
