"use client";

import { useCallback, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import type {
  AffaireIntakeDocumentKind,
  AffaireIntakeDocumentPriority,
  AffaireIntakeExtractedMetadata,
} from "@/lib/affaires/intake";
import {
  AFFAIRE_INTAKE_DOCUMENT_PRIORITY_LABELS,
  isAffaireIntakePrimaryEligibleKind,
} from "@/lib/affaires/intake";
import {
  reclassifyAffaireDocument,
  setAffaireDocumentAsPrimary,
  deleteAffaireIntakeDocument,
} from "@/app/dashboard/affaires/_actions/intake";
import { CircleAlertIcon, CircleIcon, HardDriveIcon, Trash2Icon } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { DriveProvenance } from "@/lib/affaires/google-drive/contracts";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type IntakeDocumentData = {
  documentId: string;
  fileName: string;
  driveSource?: DriveProvenance;
  sizeBytes?: number;
  detectedCategory: AffaireIntakeDocumentKind;
  documentPriority?: AffaireIntakeDocumentPriority | null;
  confidence: number;
  extractedMetadata: AffaireIntakeExtractedMetadata;
  issues: string[];
};

type IntakeDocumentCardProps = {
  document: IntakeDocumentData;
  projectId: string;
  onReclassified: () => void;
  compact?: boolean;
  isEmphasized?: boolean;
  canManage?: boolean;
};

function getFileTypeIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return { label: "PDF", color: "text-danger" };
  if (["xlsx", "xls", "csv"].includes(ext)) return { label: "XLS", color: "text-success" };
  if (["doc", "docx"].includes(ext)) return { label: "DOC", color: "text-info" };
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return { label: "IMG", color: "text-purple-600" };
  if (["eml", "msg"].includes(ext)) return { label: "MSG", color: "text-muted-foreground" };
  return { label: "FILE", color: "text-muted-foreground" };
}

const CATEGORY_LABELS: Record<AffaireIntakeDocumentKind, string> = {
  dpgf: "DPGF",
  plans: "Plans",
  cctp: "CCTP",
  bpu_dqe: "BPU / DQE",
  annexes: "Annexes",
  emails: "Emails / Courriers",
  a_classer: "À classer",
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

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

function getConfidenceDisplay(confidence: number): { label: string; variant: BadgeVariant } {
  if (confidence >= 0.95) return { label: "Certain", variant: "success" };
  if (confidence >= 0.80) return { label: "Confiant", variant: "success" };
  if (confidence >= 0.65) return { label: "Probable", variant: "info" };
  if (confidence >= 0.40) return { label: "À vérifier", variant: "warning" };
  return { label: "À confirmer", variant: "danger" };
}

function getCategoryBadgeVariant(category: AffaireIntakeDocumentKind): BadgeVariant {
  if (category === "a_classer") return "warning";
  if (category === "dpgf" || category === "plans") return "info";
  return "neutral";
}

function MetadataLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className="font-medium text-muted-foreground">{label}:</span> {value}
    </span>
  );
}

export function IntakeDocumentCard({
  document: doc,
  projectId,
  onReclassified,
  compact = false,
  isEmphasized = false,
  canManage = true,
}: IntakeDocumentCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(doc.detectedCategory);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isAmbiguous = doc.detectedCategory === "a_classer" || doc.confidence < 0.65;
  const isProcessing = doc.confidence === 0 && doc.detectedCategory === "a_classer" && doc.issues.length === 0;
  const confidenceDisplay = getConfidenceDisplay(doc.confidence);
  const fileType = getFileTypeIcon(doc.fileName);
  const isPriorityEligible = isAffaireIntakePrimaryEligibleKind(doc.detectedCategory);
  const documentPriority = doc.documentPriority ?? "secondary";

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

  const handleSetPrimary = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        await setAffaireDocumentAsPrimary({
          projectId,
          documentId: doc.documentId,
        });
        onReclassified();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Erreur lors du changement de document principal."
        );
      }
    });
  }, [doc.documentId, onReclassified, projectId]);

  const meta = doc.extractedMetadata;
  const hasMetadata = meta.projectName || meta.clientName || meta.deadlineAt || meta.detectedLots.length > 0 || meta.detectedVariants.length > 0;

  // Compact mode: single-line summary (name + badge only)
  if (compact && !isEditing) {
    return (
      <div
        className={`flex items-center gap-3 rounded-lg border bg-surface px-3 py-2 transition-colors ${
          isEmphasized
            ? "border-primary/40 ring-2 ring-primary/15"
            : "border-border"
        }`}
        data-document-id={doc.documentId}
        data-highlighted={isEmphasized ? "true" : undefined}
      >
        <span className={`text-micro font-bold uppercase leading-none ${fileType.color}`}>{fileType.label}</span>
        <p className="min-w-0 flex-1 truncate text-sm text-foreground-secondary" title={doc.fileName}>
          {doc.fileName}
        </p>
        <Badge variant={getCategoryBadgeVariant(doc.detectedCategory)}>
          {CATEGORY_LABELS[doc.detectedCategory]}
        </Badge>
        {isPriorityEligible ? (
          <Badge variant={documentPriority === "primary" ? "success" : "neutral"}>
            {AFFAIRE_INTAKE_DOCUMENT_PRIORITY_LABELS[documentPriority]}
          </Badge>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border px-4 py-3 transition-colors ${
        isEmphasized
          ? "border-primary/40 bg-primary/6 ring-2 ring-primary/15"
          : isAmbiguous && !isProcessing
          ? "border-warning/40 bg-warning-subtle"
          : "border-border bg-surface"
      }`}
      data-document-id={doc.documentId}
      data-needs-review={isAmbiguous && !isProcessing ? "true" : undefined}
      data-highlighted={isEmphasized ? "true" : undefined}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-start gap-2.5">
          <span className={`mt-0.5 text-micro font-bold uppercase leading-none ${fileType.color}`}>{fileType.label}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground" title={doc.fileName}>
              {doc.fileName}
            </p>

            {/* Category + confidence badges */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {isProcessing ? (
                <Badge variant="neutral">
                  <CircleIcon className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                  Classification en cours…
                </Badge>
              ) : (
                <>
                  <Badge variant={getCategoryBadgeVariant(doc.detectedCategory)}>
                    {CATEGORY_LABELS[doc.detectedCategory]}
                  </Badge>
                  {isPriorityEligible ? (
                    <Badge
                      variant={documentPriority === "primary" ? "success" : "neutral"}
                    >
                      {AFFAIRE_INTAKE_DOCUMENT_PRIORITY_LABELS[documentPriority]}
                    </Badge>
                  ) : null}
                  <Badge variant={confidenceDisplay.variant}>
                    {confidenceDisplay.label} ({Math.round(doc.confidence * 100)}%)
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Reclassify button */}
        {!isProcessing && !isEditing && (
          <div className="flex shrink-0 items-center gap-1.5">
            {isPriorityEligible && documentPriority !== "primary" ? (
              <button
                type="button"
                onClick={handleSetPrimary}
                disabled={isPending}
                className="rounded-lg px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success-subtle disabled:opacity-60"
              >
                Définir comme principal
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => { setSelectedCategory(doc.detectedCategory); setIsEditing(true); }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
            >
              Reclasser
            </button>
          </div>
        )}
      </div>

      {/* Inline reclassification */}
      {isEditing && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-subtle p-2">
          <label htmlFor={`reclassify-${doc.documentId}`} className="sr-only">
            Nouvelle catégorie
          </label>
          <select
            id={`reclassify-${doc.documentId}`}
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as AffaireIntakeDocumentKind)}
            disabled={isPending}
            className="flex-1 rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
            className={buttonVariants({ variant: "primary", size: "sm" })}
          >
            {isPending ? "Validation…" : "Valider"}
          </button>
          <button
            type="button"
            onClick={() => { setIsEditing(false); setError(null); }}
            disabled={isPending}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
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
          <MetadataLine label="Échéance" value={meta.deadlineAt ? new Date(meta.deadlineAt).toLocaleDateString("fr-FR") : null} />
          {meta.detectedLots.length > 0 && (
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-muted-foreground">Lots:</span>{" "}
              {meta.detectedLots.join(", ")}
            </span>
          )}
          {meta.detectedVariants.length > 0 && (
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-muted-foreground">Variantes:</span>{" "}
              {meta.detectedVariants.join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Issues */}
      {doc.issues.length > 0 && !isProcessing && (
        <ul className="mt-2 space-y-0.5 pl-6">
          {doc.issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <CircleAlertIcon className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
              {issue}
            </li>
          ))}
        </ul>
      )}
      {doc.driveSource && <details className="mt-4 rounded-lg border border-border bg-surface-subtle p-3 text-xs">
        <summary className="flex cursor-pointer items-center gap-2 font-medium text-primary"><HardDriveIcon size={14} aria-hidden="true" />Fichier dans Google Drive</summary>
        <dl className="mt-3 grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 gap-y-2 text-muted-foreground">
          <dt>Fichier</dt><dd className="break-all"><a href={doc.driveSource.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">{doc.driveSource.sourceName}</a></dd>
          {doc.driveSource.folderId && <><dt>Dossier</dt><dd className="break-all"><a href={`https://drive.google.com/drive/folders/${doc.driveSource.folderId}`} target="_blank" rel="noreferrer" className="text-primary underline">{doc.driveSource.folderName ?? doc.driveSource.folderId}</a></dd></>}
          {doc.driveSource.revision && <><dt>Révision lue</dt><dd>{doc.driveSource.revision}</dd></>}<dt>Lié le</dt><dd>{new Date(doc.driveSource.linkedAt).toLocaleString("fr-FR")}</dd>
        </dl><p className="mt-3 text-muted-foreground">Le fichier reste dans Google Drive. MergeOne conserve son lien et peut garder une copie pour le métré ou l’import DPGF. Une modification dans Drive n’est pas réanalysée automatiquement.</p>
        {doc.detectedCategory === "plans" && <p className="mt-2 text-muted-foreground">Pour le métré, un plan PDF lié garde une copie de travail, retirée avec le lien.</p>}
        {!doc.driveSource.connectionAvailable && <p className="mt-2 text-warning">Le compte Google qui a lié ce fichier a été retiré : sélectionnez de nouveau ce fichier dans Google Drive pour le rattacher à votre compte.</p>}
      </details>}
      {canManage && <button type="button" className="mt-3 inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/5" disabled={isPending || isProcessing} onClick={() => setConfirmDelete(true)}><Trash2Icon size={14} aria-hidden="true" />{doc.driveSource ? "Retirer le lien" : "Supprimer la copie"}</button>}
      <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!isPending) setConfirmDelete(open); }}>
        <AlertDialogContent><AlertDialogTitle>{doc.driveSource ? "Retirer ce lien Google Drive de l’affaire ?" : "Supprimer cette copie de l’affaire ?"}</AlertDialogTitle><AlertDialogDescription>{doc.driveSource
            ? <>Le lien vers « {doc.fileName} » sera retiré du dossier de l’affaire{doc.detectedCategory === "plans" ? ", avec la copie de travail du plan pour le métré" : ""}. Le fichier reste dans Google Drive. Les lignes de chiffrage et les références historiques existantes restent conservées.</>
            : <>Le fichier « {doc.fileName} » et ses copies dans les plans seront retirés du stockage de l’affaire. Les lignes de chiffrage et les références historiques existantes restent conservées.</>}</AlertDialogDescription>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <AlertDialogFooter><button type="button" className="btn btn-secondary" disabled={isPending} onClick={() => setConfirmDelete(false)}>Annuler</button><button type="button" className="btn btn-primary" disabled={isPending} onClick={() => { setError(null); startTransition(async () => { try { await deleteAffaireIntakeDocument({ projectId, documentId: doc.documentId }); setConfirmDelete(false); onReclassified(); } catch (err) { setError(err instanceof Error ? err.message : "Suppression interrompue. Réessayez."); } }); }}>{isPending ? (doc.driveSource ? "Retrait…" : "Suppression…") : doc.driveSource ? "Confirmer le retrait" : "Confirmer la suppression"}</button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
