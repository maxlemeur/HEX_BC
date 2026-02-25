"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  detectAnomalies,
  ANOMALY_LABELS,
} from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

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
  onMarkVerified: (itemId: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfidenceLabel(confidence: number | null): {
  label: string;
  variant: "success" | "warning" | "error" | "neutral";
} {
  if (confidence === null) return { label: "Non evaluee", variant: "neutral" };
  const pct = Math.round(confidence * 100);
  if (pct >= 80) return { label: "Fiable", variant: "success" };
  if (pct >= 50) return { label: "A verifier", variant: "warning" };
  return { label: "Problematique", variant: "error" };
}

function getBarColor(confidence: number | null): string {
  if (confidence === null) return "var(--slate-300)";
  const pct = confidence * 100;
  if (pct >= 80) return "var(--success)";
  if (pct >= 50) return "var(--warning)";
  return "var(--danger)";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EvidencePanel({
  item,
  itemIndex,
  totalItems,
  onClose,
  onNavigate,
  onUpdateEvidence,
  onMarkVerified,
}: EvidencePanelProps) {
  // NOTE: Parent must render with key={item.id} to reset state on item change
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.evidence ?? "");
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus panel on open
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    setEditValue(item.evidence ?? "");
    setIsEditing(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [item.evidence]);

  const handleSaveEvidence = useCallback(() => {
    const trimmed = editValue.trim();
    onUpdateEvidence(item.id, trimmed.length > 0 ? trimmed : null);
    setIsEditing(false);
  }, [editValue, item.id, onUpdateEvidence]);

  const handleCancelEdit = useCallback(() => {
    setEditValue(item.evidence ?? "");
    setIsEditing(false);
  }, [item.evidence]);

  const anomalies = detectAnomalies(item);
  const { label: confLabel, variant: confVariant } = getConfidenceLabel(item.confidence);
  const pct = item.confidence !== null ? Math.round(item.confidence * 100) : null;
  const barColor = getBarColor(item.confidence);

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
        aria-label={`Evidence item: ${item.designation}`}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="animate-slide-in-right fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[var(--border)] bg-white shadow-xl outline-none"
      >
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">
              Evidence item
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
              title="Item precedent (fleche gauche)"
              aria-label="Item precedent"
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
              title="Item suivant (fleche droite)"
              aria-label="Item suivant"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              type="button"
              className="ml-1 rounded p-1 text-[var(--slate-500)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-700)]"
              onClick={onClose}
              title="Fermer (Echap)"
              aria-label="Fermer"
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
            <label className="text-xs font-medium uppercase text-[var(--slate-500)]">
              Designation
            </label>
            <p className="mt-1 text-sm text-[var(--slate-800)]">
              {item.designation || <span className="italic text-[var(--slate-400)]">Vide</span>}
            </p>
          </div>

          {/* Confidence gauge */}
          <div>
            <label className="text-xs font-medium uppercase text-[var(--slate-500)]">
              Confiance
            </label>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--slate-100)]">
                <div
                  className="h-full rounded-full transition-all duration-300"
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
          {(item.source_file_name || item.source_page !== null) && (
            <div>
              <label className="text-xs font-medium uppercase text-[var(--slate-500)]">
                Source
              </label>
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
            </div>
          )}

          {/* Anomalies */}
          {anomalies.length > 0 && (
            <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-light)] p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--warning)]">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
                Anomalies detectees
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
              <label className="text-xs font-medium uppercase text-[var(--slate-500)]">
                Evidence
              </label>
              {!isEditing && (
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--info)] hover:underline"
                  onClick={handleStartEdit}
                >
                  Modifier
                </button>
              )}
            </div>

            {isEditing ? (
              <div className="mt-2 space-y-2">
                <textarea
                  ref={textareaRef}
                  className="block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  rows={5}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  maxLength={2000}
                  placeholder="Saisir l'evidence extraite..."
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--slate-400)]">
                    {editValue.length}/2000
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={handleCancelEdit}>
                      Annuler
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleSaveEvidence}>
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
                    Aucune evidence disponible.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ---- Footer ---- */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
          <span className="text-[10px] text-[var(--slate-400)]">
            ← → naviguer &middot; Echap fermer
          </span>

          {item.is_verified ? (
            <Badge variant="info" size="sm">
              Verifie
            </Badge>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onMarkVerified(item.id)}
            >
              Marquer verifie
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

