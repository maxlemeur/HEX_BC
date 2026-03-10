"use client";

import { useState } from "react";

import type { AffaireIntakeDocumentKind } from "@/lib/affaires/intake";
import { AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS } from "@/lib/affaires/intake";
import { Badge } from "@/components/ui/Badge";
import { IntakeDocumentCard, type IntakeDocumentData } from "./IntakeDocumentCard";

type IntakeCategoryCardProps = {
  category: AffaireIntakeDocumentKind;
  documents: IntakeDocumentData[];
  projectId: string;
  onReclassified: () => void;
  // DPGF-specific
  onBridgeDpgfImport?: () => void;
  dpgfAlreadyImported?: boolean;
  // Plans-specific
  plansSynced?: boolean;
};

const CATEGORY_ICONS: Record<AffaireIntakeDocumentKind, React.ReactNode> = {
  dpgf: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" x2="8" y1="13" y2="13" />
      <line x1="16" x2="8" y1="17" y2="17" />
      <line x1="10" x2="8" y1="9" y2="9" />
    </svg>
  ),
  plans: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <line x1="3" x2="21" y1="9" y2="9" />
      <line x1="9" x2="9" y1="21" y2="9" />
    </svg>
  ),
  cctp: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  bpu_dqe: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" x2="8" y1="13" y2="13" />
      <line x1="16" x2="8" y1="17" y2="17" />
    </svg>
  ),
  annexes: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  ),
  emails: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  ),
  a_classer: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  ),
};

const CATEGORY_COLORS: Record<AffaireIntakeDocumentKind, string> = {
  dpgf: "text-blue-600",
  plans: "text-violet-600",
  cctp: "text-amber-600",
  bpu_dqe: "text-emerald-600",
  annexes: "text-slate-500",
  emails: "text-slate-500",
  a_classer: "text-amber-500",
};

/** Display order for categories in the grid. */
const CATEGORY_ORDER: AffaireIntakeDocumentKind[] = [
  "dpgf",
  "plans",
  "cctp",
  "bpu_dqe",
  "emails",
  "annexes",
  "a_classer",
];

export function categorySort(a: AffaireIntakeDocumentKind, b: AffaireIntakeDocumentKind) {
  return CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b);
}

export function IntakeCategoryCard({
  category,
  documents,
  projectId,
  onReclassified,
  onBridgeDpgfImport,
  dpgfAlreadyImported,
  plansSynced,
}: IntakeCategoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const label = AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS[category];
  const icon = CATEGORY_ICONS[category];
  const colorClass = CATEGORY_COLORS[category];
  const count = documents.length;

  // Truncated file names for collapsed view
  const previewNames = documents.slice(0, 3).map((d) => d.fileName);
  const moreCount = count - previewNames.length;

  return (
    <div className="rounded-xl border border-[var(--slate-200)] bg-surface transition-shadow hover:shadow-sm">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2.5 p-3 text-left"
      >
        <span className={`mt-0.5 shrink-0 ${colorClass}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--slate-800)]">
              {label}
            </span>
            <Badge variant="neutral" size="sm">
              {count}
            </Badge>
            {/* Contextual badges */}
            {category === "dpgf" && dpgfAlreadyImported && (
              <Badge variant="success" size="sm">Importe</Badge>
            )}
            {category === "plans" && plansSynced && (
              <Badge variant="success" size="sm">Synchronises</Badge>
            )}
          </div>
          {/* File name previews */}
          {!expanded && (
            <p className="mt-0.5 truncate text-xs text-[var(--slate-500)]">
              {previewNames.join(", ")}
              {moreCount > 0 ? ` +${moreCount}` : ""}
            </p>
          )}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`mt-1 shrink-0 text-[var(--slate-400)] transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* DPGF contextual action */}
      {category === "dpgf" && !dpgfAlreadyImported && onBridgeDpgfImport && (
        <div className="border-t border-[var(--slate-100)] px-3 py-2">
          <button
            type="button"
            onClick={onBridgeDpgfImport}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--brand-blue)] transition-colors hover:bg-[var(--brand-blue)]/5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
            Lancer l&apos;import structure
          </button>
        </div>
      )}

      {/* Expanded: show individual document cards */}
      {expanded && (
        <div className="border-t border-[var(--slate-100)] p-3 space-y-2">
          {documents.map((doc) => (
            <IntakeDocumentCard
              key={doc.documentId}
              document={doc}
              projectId={projectId}
              onReclassified={onReclassified}
            />
          ))}
        </div>
      )}
    </div>
  );
}
