"use client";

import { useCallback, useState, useTransition } from "react";

import { Badge } from "@/components/ui/Badge";
import type { AffaireIntakeDocumentKind, AffaireIntakeExtractedMetadata } from "@/lib/affaires/intake";
import { reclassifyAffaireDocument } from "@/app/dashboard/affaires/_actions/intake";

export type IntakeDocumentData = {
  documentId: string;
  fileName: string;
  detectedCategory: AffaireIntakeDocumentKind;
  confidence: number;
  extractedMetadata: AffaireIntakeExtractedMetadata;
  issues: string[];
};

type IntakeDocumentCardProps = {
  document: IntakeDocumentData;
  projectId: string;
  onReclassified: () => void;
  compact?: boolean;
};

function getFileTypeIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return { label: "PDF", color: "text-red-600" };
  if (["xlsx", "xls", "csv"].includes(ext)) return { label: "XLS", color: "text-emerald-700" };
  if (["doc", "docx"].includes(ext)) return { label: "DOC", color: "text-blue-700" };
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return { label: "IMG", color: "text-purple-600" };
  if (["eml", "msg"].includes(ext)) return { label: "MSG", color: "text-slate-600" };
  return { label: "FILE", color: "text-slate-500" };
}

const CATEGORY_LABELS: Record<AffaireIntakeDocumentKind, string> = {
  dpgf: "DPGF",
  plans: "Plans",
  cctp: "CCTP",
  bpu_dqe: "BPU / DQE",
  annexes: "Annexes",
  emails: "Emails / Courriers",
  a_classer: "A classer",
};

const CATEGORY_OPTIONS: AffaireIntakeDocumentKind[] = [
  "dpgf",
  "plans",
  "cctp",
  "bpu_dqe",
  "annexes",
  "emails",
  "a_classer",
];

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "error";

function getConfidenceDisplay(confidence: number): { label: string; variant: BadgeVariant } {
  if (confidence >= 0.95) return { label: "Certain", variant: "success" };
  if (confidence >= 0.80) return { label: "Confiant", variant: "success" };
  if (confidence >= 0.65) return { label: "Probable", variant: "info" };
  if (confidence >= 0.40) return { label: "A verifier", variant: "warning" };
  return { label: "A confirmer", variant: "error" };
}

function getCategoryBadgeVariant(category: AffaireIntakeDocumentKind): BadgeVariant {
  if (category === "a_classer") return "warning";
  if (category === "dpgf" || category === "plans") return "info";
  return "neutral";
}

function MetadataLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-[var(--slate-500)]">
      <span className="font-medium text-[var(--slate-600)]">{label}:</span> {value}
    </span>
  );
}

export function IntakeDocumentCard({
  document: doc,
  projectId,
  onReclassified,
  compact = false,
}: IntakeDocumentCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(doc.detectedCategory);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isAmbiguous = doc.detectedCategory === "a_classer" || doc.confidence < 0.65;
  const isProcessing = doc.confidence === 0 && doc.detectedCategory === "a_classer" && doc.issues.length === 0;
  const confidenceDisplay = getConfidenceDisplay(doc.confidence);
  const fileType = getFileTypeIcon(doc.fileName);

  const handleReclassify = useCallback(() => {
    if (selectedCategory === doc.detectedCategory) {
      setIsEditing(false);
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await reclassifyAffaireDocument({
          projectId,
          documentId: doc.documentId,
          category: selectedCategory,
        });
        setIsEditing(false);
        onReclassified();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur lors de la reclassification.");
      }
    });
  }, [selectedCategory, doc.detectedCategory, doc.documentId, projectId, onReclassified]);

  const meta = doc.extractedMetadata;
  const hasMetadata = meta.projectName || meta.clientName || meta.deadlineAt || meta.detectedLots.length > 0 || meta.detectedVariants.length > 0;

  // Compact mode: single-line summary (name + badge only)
  if (compact && !isEditing) {
    return (
      <div
        className="flex items-center gap-3 rounded-lg border border-[var(--slate-200)] bg-surface px-3 py-2"
        data-document-id={doc.documentId}
      >
        <span className={`text-[10px] font-bold uppercase leading-none ${fileType.color}`}>{fileType.label}</span>
        <p className="min-w-0 flex-1 truncate text-sm text-[var(--slate-700)]" title={doc.fileName}>
          {doc.fileName}
        </p>
        <Badge variant={getCategoryBadgeVariant(doc.detectedCategory)} size="sm">
          {CATEGORY_LABELS[doc.detectedCategory]}
        </Badge>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border px-4 py-3 transition-colors ${
        isAmbiguous && !isProcessing
          ? "border-[var(--warning)]/40 bg-amber-50"
          : "border-[var(--slate-200)] bg-surface"
      }`}
      data-document-id={doc.documentId}
      data-needs-review={isAmbiguous && !isProcessing ? "true" : undefined}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-start gap-2.5">
          <span className={`mt-0.5 text-[10px] font-bold uppercase leading-none ${fileType.color}`}>{fileType.label}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--slate-800)]" title={doc.fileName}>
              {doc.fileName}
            </p>

            {/* Category + confidence badges */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {isProcessing ? (
                <Badge variant="neutral" size="sm">
                  <svg className="mr-1 h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                  </svg>
                  Classification en cours...
                </Badge>
              ) : (
                <>
                  <Badge variant={getCategoryBadgeVariant(doc.detectedCategory)} size="sm">
                    {CATEGORY_LABELS[doc.detectedCategory]}
                  </Badge>
                  <Badge variant={confidenceDisplay.variant} size="sm">
                    {confidenceDisplay.label} ({Math.round(doc.confidence * 100)}%)
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Reclassify button */}
        {!isProcessing && !isEditing && (
          <button
            type="button"
            onClick={() => { setSelectedCategory(doc.detectedCategory); setIsEditing(true); }}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[var(--brand-blue)] transition-colors hover:bg-[var(--brand-blue)]/5"
          >
            Reclasser
          </button>
        )}
      </div>

      {/* Inline reclassification */}
      {isEditing && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] p-2">
          <label htmlFor={`reclassify-${doc.documentId}`} className="sr-only">
            Nouvelle categorie
          </label>
          <select
            id={`reclassify-${doc.documentId}`}
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as AffaireIntakeDocumentKind)}
            disabled={isPending}
            className="flex-1 rounded-lg border border-[var(--slate-300)] bg-surface px-2 py-1.5 text-sm text-[var(--slate-800)] focus:border-[var(--brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-blue)]"
          >
            {CATEGORY_OPTIONS.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleReclassify}
            disabled={isPending}
            className="btn btn-primary btn-sm text-xs"
          >
            {isPending ? "..." : "Valider"}
          </button>
          <button
            type="button"
            onClick={() => { setIsEditing(false); setError(null); }}
            disabled={isPending}
            className="btn btn-secondary btn-sm text-xs"
          >
            Annuler
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs font-medium text-danger" role="alert">{error}</p>
      )}

      {/* Extracted metadata */}
      {hasMetadata && !isProcessing && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-6">
          <MetadataLine label="Projet" value={meta.projectName} />
          <MetadataLine label="Client" value={meta.clientName} />
          <MetadataLine label="Echeance" value={meta.deadlineAt ? new Date(meta.deadlineAt).toLocaleDateString("fr-FR") : null} />
          {meta.detectedLots.length > 0 && (
            <span className="text-xs text-[var(--slate-500)]">
              <span className="font-medium text-[var(--slate-600)]">Lots:</span>{" "}
              {meta.detectedLots.join(", ")}
            </span>
          )}
          {meta.detectedVariants.length > 0 && (
            <span className="text-xs text-[var(--slate-500)]">
              <span className="font-medium text-[var(--slate-600)]">Variantes:</span>{" "}
              {meta.detectedVariants.join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Issues */}
      {doc.issues.length > 0 && !isProcessing && (
        <ul className="mt-2 space-y-0.5 pl-6">
          {doc.issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--slate-600)]">
              <svg className="mt-0.5 h-3 w-3 shrink-0 text-[var(--warning)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
              </svg>
              {issue}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
