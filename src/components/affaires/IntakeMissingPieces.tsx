"use client";

import { Badge } from "@/components/ui/Badge";
import type { AffaireIntakeWorkspaceMissingPiece } from "@/lib/affaires/intake";

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
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function IntakeMissingPieces({ pieces }: IntakeMissingPiecesProps) {
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
          : "border-[var(--warning)]/20 bg-[var(--warning)]/5"
      }`}
      role="region"
      aria-label="Pieces manquantes au dossier"
    >
      <div className="mb-2 flex items-center gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={hasCritical ? "text-danger" : "text-[var(--warning)]"}
          aria-hidden="true"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" x2="12" y1="9" y2="13" />
          <line x1="12" x2="12.01" y1="17" y2="17" />
        </svg>
        <h3 className="text-sm font-semibold text-[var(--slate-800)]">
          Pieces manquantes au dossier
        </h3>
      </div>

      <ul className="space-y-1.5">
        {sorted.map((piece, i) => (
          <li key={piece.code}>
            {i === criticalBoundary && (
              <div className="mb-1.5 border-t border-[var(--slate-200)]" />
            )}
            <div className="flex items-center gap-2">
              <Badge
                variant={SEVERITY_VARIANT[piece.severity] ?? "info"}
                size="sm"
              >
                {SEVERITY_LABEL[piece.severity] ?? piece.severity}
              </Badge>
              <span className="text-sm text-[var(--slate-700)]">{piece.label}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
