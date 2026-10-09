"use client";

import { useState } from "react";

import type { AffaireIntakeDocumentKind } from "@/lib/affaires/intake";
import {
  AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS,
  isAffaireIntakePrimaryEligibleKind,
} from "@/lib/affaires/intake";
import { Badge } from "@/components/ui/badge";
import { IntakeDocumentCard, type IntakeDocumentData } from "./IntakeDocumentCard";
import { ChevronDownIcon, CircleAlertIcon, DownloadIcon, FileIcon, FileTextIcon, MailIcon, PanelsTopLeftIcon, PaperclipIcon } from "lucide-react";

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
  focusDocumentId?: string | null;
};

const CATEGORY_ICONS: Record<AffaireIntakeDocumentKind, React.ReactNode> = {
  dpgf: (
    <FileTextIcon aria-hidden="true" size={16} />
  ),
  plans: (
    <PanelsTopLeftIcon aria-hidden="true" size={16} />
  ),
  cctp: (
    <FileIcon aria-hidden="true" size={16} />
  ),
  bpu_dqe: (
    <FileTextIcon aria-hidden="true" size={16} />
  ),
  annexes: (
    <PaperclipIcon aria-hidden="true" size={16} />
  ),
  emails: (
    <MailIcon aria-hidden="true" size={16} />
  ),
  a_classer: (
    <CircleAlertIcon aria-hidden="true" size={16} />
  ),
};

const CATEGORY_COLORS: Record<AffaireIntakeDocumentKind, string> = {
  dpgf: "text-info",
  plans: "text-violet-600",
  cctp: "text-warning",
  bpu_dqe: "text-success",
  annexes: "text-muted-foreground",
  emails: "text-muted-foreground",
  a_classer: "text-warning",
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
  focusDocumentId = null,
}: IntakeCategoryCardProps) {
  const label = AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS[category];
  const icon = CATEGORY_ICONS[category];
  const colorClass = CATEGORY_COLORS[category];
  const count = documents.length;
  const primaryCount = documents.filter((document) => document.documentPriority === "primary").length;
  const secondaryCount = documents.filter(
    (document) => (document.documentPriority ?? "secondary") === "secondary"
  ).length;

  // Truncated file names for collapsed view
  const previewNames = documents.slice(0, 3).map((d) => d.fileName);
  const moreCount = count - previewNames.length;
  const shouldFocusDocument =
    focusDocumentId !== null &&
    documents.some((document) => document.documentId === focusDocumentId);
  const [expanded, setExpanded] = useState(shouldFocusDocument);
  const [previousShouldFocusDocument, setPreviousShouldFocusDocument] =
    useState(shouldFocusDocument);

  if (shouldFocusDocument !== previousShouldFocusDocument) {
    setPreviousShouldFocusDocument(shouldFocusDocument);
    if (shouldFocusDocument) {
      setExpanded(true);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface transition-shadow hover:shadow-sm">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2.5 p-3 text-left"
      >
        <span className={`mt-0.5 shrink-0 ${colorClass}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {label}
            </span>
            <Badge variant="neutral">
              {count}
            </Badge>
            {isAffaireIntakePrimaryEligibleKind(category) && primaryCount > 0 && (
              <Badge variant="success">Principal</Badge>
            )}
            {isAffaireIntakePrimaryEligibleKind(category) && secondaryCount > 0 && (
              <Badge variant="neutral">
                Autres {secondaryCount}
              </Badge>
            )}
            {/* Contextual badges */}
            {category === "dpgf" && dpgfAlreadyImported && (
              <Badge variant="success">Importée</Badge>
            )}
            {category === "plans" && plansSynced && (
              <Badge variant="success">Synchronisés</Badge>
            )}
          </div>
          {/* File name previews */}
          {!expanded && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {previewNames.join(", ")}
              {moreCount > 0 ? ` +${moreCount}` : ""}
            </p>
          )}
        </div>
        <ChevronDownIcon className={`mt-1 shrink-0 text-subtle-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" size={14} />
      </button>

      {/* DPGF contextual action */}
      {category === "dpgf" && !dpgfAlreadyImported && onBridgeDpgfImport && (
        <div className="border-t border-border-subtle px-3 py-2">
          <button
            type="button"
            onClick={onBridgeDpgfImport}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
          >
            <DownloadIcon aria-hidden="true" size={12} />
            Lancer l&apos;import structure
          </button>
        </div>
      )}

      {/* Expanded: show individual document cards */}
      {expanded && (
        <div className="border-t border-border-subtle p-3 space-y-2">
          {documents.map((doc) => (
            <IntakeDocumentCard
              key={doc.documentId}
              document={doc}
              projectId={projectId}
              onReclassified={onReclassified}
              isEmphasized={focusDocumentId === doc.documentId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
