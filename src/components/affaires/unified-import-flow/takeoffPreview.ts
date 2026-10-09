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
    return "version précédente";
  }

  return null;
}

export function getTakeoffCarryOverPreviewCopy(
  summary: TakeoffCarryOverSummary,
): TakeoffCarryOverPreviewCopy {
  const sourceLabel = getTakeoffCarryOverSourceLabel(summary);

  if (summary.state === "not_applicable") {
    return {
      toneClassName: "border-border bg-surface-subtle",
      title: "Aucun carry-over takeoff à reprendre",
      description:
        "Cette création ne repart d'aucune version takeoff précédente.",
    };
  }

  if (summary.state === "empty") {
    return {
      toneClassName: "border-border bg-surface-subtle",
      title: sourceLabel
        ? `Aucune analyse takeoff à reprendre depuis ${sourceLabel}`
        : "Aucune analyse takeoff à reprendre",
      description:
        "La version sera créée sans reprise takeoff existante.",
    };
  }

  if (summary.state === "unavailable") {
    return {
      toneClassName: "border-amber-200 bg-amber-50",
      title: "État de reprise takeoff indisponible",
      description:
        "Le carry-over n'est pas prouve ici. La version reste creable, mais la reprise devra être vérifiée après création.",
    };
  }

  if (summary.state === "ready") {
    return {
      toneClassName: "border-emerald-200 bg-emerald-50",
      title: sourceLabel
        ? `Carry-over takeoff prêt depuis ${sourceLabel}`
        : "Carry-over takeoff prêt",
      description:
        "Les analyses déjà acquises restent visibles sur la nouvelle version.",
    };
  }

  return {
    toneClassName: "border-amber-200 bg-amber-50",
    title: sourceLabel
      ? `Carry-over takeoff à surveiller depuis ${sourceLabel}`
      : "Carry-over takeoff à surveiller",
    description:
      "Certaines analyses suivent, d'autres restent en cours ou devront être relancees.",
  };
}
