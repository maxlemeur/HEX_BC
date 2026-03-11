import type { TakeoffCarryOverSummary } from "@/lib/takeoff/types";

export type TakeoffCarryOverPreviewCopy = {
  toneClassName: string;
  title: string;
  description: string;
};

function getTakeoffCarryOverSourceLabel(summary: TakeoffCarryOverSummary): string | null {
  if (summary.sourceVersionNumber !== null) {
    return `V${summary.sourceVersionNumber}`;
  }

  if (summary.sourceVersionId) {
    return "version precedente";
  }

  return null;
}

export function getTakeoffCarryOverPreviewCopy(
  summary: TakeoffCarryOverSummary,
): TakeoffCarryOverPreviewCopy {
  const sourceLabel = getTakeoffCarryOverSourceLabel(summary);

  if (summary.state === "not_applicable") {
    return {
      toneClassName: "border-[var(--slate-200)] bg-[var(--slate-50)]",
      title: "Aucun carry-over takeoff a reprendre",
      description:
        "Cette creation ne repart d'aucune version takeoff precedente.",
    };
  }

  if (summary.state === "empty") {
    return {
      toneClassName: "border-[var(--slate-200)] bg-[var(--slate-50)]",
      title: sourceLabel
        ? `Aucune analyse takeoff a reprendre depuis ${sourceLabel}`
        : "Aucune analyse takeoff a reprendre",
      description:
        "La version sera creee sans reprise takeoff existante.",
    };
  }

  if (summary.state === "unavailable") {
    return {
      toneClassName: "border-amber-200 bg-amber-50",
      title: "Etat de reprise takeoff indisponible",
      description:
        "Le carry-over n'est pas prouve ici. La version reste creable, mais la reprise devra etre verifiee apres creation.",
    };
  }

  if (summary.state === "ready") {
    return {
      toneClassName: "border-emerald-200 bg-emerald-50",
      title: sourceLabel
        ? `Carry-over takeoff pret depuis ${sourceLabel}`
        : "Carry-over takeoff pret",
      description:
        "Les analyses deja acquises restent visibles sur la nouvelle version.",
    };
  }

  return {
    toneClassName: "border-amber-200 bg-amber-50",
    title: sourceLabel
      ? `Carry-over takeoff a surveiller depuis ${sourceLabel}`
      : "Carry-over takeoff a surveiller",
    description:
      "Certaines analyses suivent, d'autres restent en cours ou devront etre relancees.",
  };
}
