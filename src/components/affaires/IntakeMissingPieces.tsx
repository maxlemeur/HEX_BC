"use client";

import { Badge } from "@/components/ui-legacy/Badge";
import type { AffaireIntakeWorkspaceMissingPiece } from "@/lib/affaires/intake";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";

type BadgeVariant = "info" | "warning" | "error";

const SEVERITY_VARIANT: Record<string, BadgeVariant> = {
  critical: "error",
  warning: "warning",
  info: "info",
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critique",
  warning: "Attention",
  info: "Information",
};

type IntakeMissingPiecesProps = {
  pieces: AffaireIntakeWorkspaceMissingPiece[];
  onAddFile?: () => void;
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function IntakeMissingPieces({ pieces, onAddFile }: IntakeMissingPiecesProps) {
  if (pieces.length === 0) return null;

  const sorted = [...pieces].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );
  const hasCritical = sorted.some((p) => p.severity === "critical");
  const hasNonCritical = sorted.some((p) => p.severity !== "critical");
  const criticalBoundary = hasCritical && hasNonCritical
    ? sorted.findIndex((p) => p.severity !== "critical")
    : -1;

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        hasCritical
          ? "border-danger/20 bg-error-light"
          : "border-warning/20 bg-warning/5"
      }`}
      role="region"
      aria-label="Pieces manquantes au dossier"
    >
      <div className="mb-2 flex items-center gap-2">
        <TriangleAlertIcon className={hasCritical ? "text-danger" : "text-warning"} aria-hidden="true" size={16} />
        <h3 className="text-sm font-semibold text-slate-800">
          Pieces manquantes au dossier
        </h3>
      </div>

      <ul className="space-y-1.5">
        {sorted.map((piece, i) => (
          <li key={piece.code}>
            {i === criticalBoundary && (
              <div className="mb-1.5 border-t border-border" />
            )}
            <div className="flex items-center gap-2">
              <Badge
                variant={SEVERITY_VARIANT[piece.severity] ?? "info"}
                size="sm"
              >
                {SEVERITY_LABEL[piece.severity] ?? piece.severity}
              </Badge>
              <span className="text-sm text-foreground-secondary">{piece.label}</span>
            </div>
          </li>
        ))}
      </ul>

      {onAddFile && (
        <button
          type="button"
          onClick={onAddFile}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <PlusIcon aria-hidden="true" size={12} />
          Ajouter les pieces manquantes
        </button>
      )}
    </div>
  );
}
