import type { PlanFileListItem, TakeoffLevel } from "@/lib/takeoff/types";

export type TakeoffDocumentClass =
  | "structured"
  | "tabular_pdf"
  | "complex_plan"
  | "unsupported";

export type TakeoffRecommendationStrength = "high" | "low";

export type TakeoffRecommendationWarningCode =
  | "ambiguous_pdf"
  | "unsupported_override"
  | "mixed_pdf_signals";

export type TakeoffSelectionWarningCode =
  | TakeoffRecommendationWarningCode
  | "strong_mismatch"
  | "cost_warning";

export type TakeoffDocumentRecommendation = {
  documentClass: TakeoffDocumentClass;
  recommendedLevel: TakeoffLevel | null;
  compatibleLevels: TakeoffLevel[];
  recommendationStrength: TakeoffRecommendationStrength;
  warningCode: TakeoffRecommendationWarningCode | null;
  warningMessage: string | null;
  signals: {
    mimeType: string | null;
    extension: string;
    fileCount: number;
    totalPageCount: number | null;
    matchedTableHints: string[];
    matchedPlanHints: string[];
  };
};

export type TakeoffSelectionWarning = {
  code: TakeoffSelectionWarningCode;
  message: string;
  severity: "warning" | "critical";
};

export const TAKEOFF_LEVEL_BUSINESS_LABELS: Record<TakeoffLevel, string> = {
  A: "Rapide",
  B: "Standard",
  C: "Detaille",
};

type TakeoffFileSignal = {
  fileName: string;
  mimeType: string | null | undefined;
  pageCount?: number | null;
};

const STRUCTURED_EXTENSIONS = new Set(["csv", "xls", "xlsx"]);
const STRUCTURED_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const PDF_MIME_TYPES = new Set(["application/pdf"]);

const TABLE_HINTS = [
  "dpgf",
  "bpu",
  "dqe",
  "bordereau",
  "quantitatif",
  "estimatif",
  "metre",
  "metrage",
  "tableau",
  "decompte",
  "decomposition",
];

const PLAN_HINTS = [
  "plan",
  "coupe",
  "facade",
  "façade",
  "elevation",
  "élévation",
  "rdc",
  "niveau",
  "masse",
  "implantation",
];

function normalizeString(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function getFileExtension(fileName: string) {
  const trimmed = fileName.trim().toLowerCase();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return "";
  }

  return trimmed.slice(lastDot + 1);
}

function collectHints(input: string, hints: string[]) {
  return hints.filter((hint) => input.includes(hint));
}

function toTotalPageCount(files: Array<TakeoffFileSignal>) {
  let sawPageCount = false;
  const total = files.reduce((sum, file) => {
    if (typeof file.pageCount === "number" && Number.isFinite(file.pageCount)) {
      sawPageCount = true;
      return sum + Math.max(0, Math.trunc(file.pageCount));
    }

    return sum;
  }, 0);

  return sawPageCount ? total : null;
}

function buildRecommendation(input: {
  documentClass: TakeoffDocumentClass;
  recommendedLevel: TakeoffLevel | null;
  compatibleLevels: TakeoffLevel[];
  recommendationStrength: TakeoffRecommendationStrength;
  warningCode?: TakeoffRecommendationWarningCode | null;
  warningMessage?: string | null;
  signals: TakeoffDocumentRecommendation["signals"];
}): TakeoffDocumentRecommendation {
  return {
    documentClass: input.documentClass,
    recommendedLevel: input.recommendedLevel,
    compatibleLevels: input.compatibleLevels,
    recommendationStrength: input.recommendationStrength,
    warningCode: input.warningCode ?? null,
    warningMessage: input.warningMessage ?? null,
    signals: input.signals,
  };
}

function classifyTakeoffSignals(files: Array<TakeoffFileSignal>) {
  const firstFile = files[0];
  const fileName = firstFile?.fileName ?? "";
  const extension = getFileExtension(fileName);
  const mimeType = normalizeString(firstFile?.mimeType);
  const totalPageCount = toTotalPageCount(files);
  const normalizedNames = files
    .map((file) => normalizeString(file.fileName))
    .join(" ");
  const matchedTableHints = collectHints(normalizedNames, TABLE_HINTS);
  const matchedPlanHints = collectHints(normalizedNames, PLAN_HINTS);
  const signals = {
    mimeType: mimeType || null,
    extension,
    fileCount: files.length,
    totalPageCount,
    matchedTableHints,
    matchedPlanHints,
  } satisfies TakeoffDocumentRecommendation["signals"];

  const isStructured =
    files.length === 1 &&
    (STRUCTURED_EXTENSIONS.has(extension) || STRUCTURED_MIME_TYPES.has(mimeType));
  if (isStructured) {
    return buildRecommendation({
      documentClass: "structured",
      recommendedLevel: "A",
      compatibleLevels: ["A"],
      recommendationStrength: "high",
      signals,
    });
  }

  const allPdfLike =
    files.length > 0 &&
    files.every((file) => {
      const currentExtension = getFileExtension(file.fileName);
      const currentMimeType = normalizeString(file.mimeType);
      return (
        PDF_EXTENSIONS.has(currentExtension) || PDF_MIME_TYPES.has(currentMimeType)
      );
    });

  if (!allPdfLike) {
    return buildRecommendation({
      documentClass: "unsupported",
      recommendedLevel: null,
      compatibleLevels: ["B", "C"],
      recommendationStrength: "low",
      warningCode: "unsupported_override",
      warningMessage:
        "Le document n'a pas ete reconnu automatiquement. Verifiez le niveau choisi avant de lancer l'analyse.",
      signals,
    });
  }

  if (files.length > 1 || (totalPageCount !== null && totalPageCount > 6)) {
    return buildRecommendation({
      documentClass: "complex_plan",
      recommendedLevel: "C",
      compatibleLevels: ["B", "C"],
      recommendationStrength: "high",
      warningCode:
        matchedTableHints.length > 0 && matchedPlanHints.length > 0
          ? "mixed_pdf_signals"
          : null,
      warningMessage:
        matchedTableHints.length > 0 && matchedPlanHints.length > 0
          ? "Le lot melange indices de tableaux et de plans. Le niveau Detaille est recommande pour eviter une extraction partielle."
          : null,
      signals,
    });
  }

  if (matchedPlanHints.length > 0 && matchedTableHints.length === 0) {
    return buildRecommendation({
      documentClass: "complex_plan",
      recommendedLevel: "C",
      compatibleLevels: ["B", "C"],
      recommendationStrength: "high",
      signals,
    });
  }

  if (matchedTableHints.length > 0 && matchedPlanHints.length === 0) {
    return buildRecommendation({
      documentClass: "tabular_pdf",
      recommendedLevel: "B",
      compatibleLevels: ["B", "C"],
      recommendationStrength: "high",
      signals,
    });
  }

  if (matchedPlanHints.length > 0 && matchedTableHints.length > 0) {
    return buildRecommendation({
      documentClass: "complex_plan",
      recommendedLevel: "C",
      compatibleLevels: ["B", "C"],
      recommendationStrength: "high",
      warningCode: "mixed_pdf_signals",
      warningMessage:
        "Le PDF contient des indices de plans et de tableaux. Le niveau Detaille est recommande.",
      signals,
    });
  }

  return buildRecommendation({
    documentClass: "tabular_pdf",
    recommendedLevel: "B",
    compatibleLevels: ["B", "C"],
    recommendationStrength: "low",
    warningCode: "ambiguous_pdf",
    warningMessage:
      "Le PDF reste ambigu. Le niveau Standard est preselectionne par defaut; passez en Detaille si le document ressemble surtout a un plan.",
    signals,
  });
}

export function classifyTakeoffUploadSource(input: {
  fileName: string;
  mimeType?: string | null;
  sizeBytes: number;
}): TakeoffDocumentRecommendation {
  return classifyTakeoffSignals([
    {
      fileName: input.fileName,
      mimeType: input.mimeType,
    },
  ]);
}

export function classifyTakeoffPlanSetSource(input: {
  files: Array<
    Pick<PlanFileListItem, "file_name" | "file_type" | "page_count"> | TakeoffFileSignal
  >;
}): TakeoffDocumentRecommendation {
  if (input.files.length === 0) {
    return buildRecommendation({
      documentClass: "unsupported",
      recommendedLevel: null,
      compatibleLevels: ["B", "C"],
      recommendationStrength: "low",
      warningCode: "unsupported_override",
      warningMessage:
        "Aucun fichier exploitable n'a ete detecte dans ce jeu de plans. Choisissez un niveau explicitement avant de lancer l'analyse.",
      signals: {
        mimeType: null,
        extension: "",
        fileCount: 0,
        totalPageCount: null,
        matchedTableHints: [],
        matchedPlanHints: [],
      },
    });
  }

  return classifyTakeoffSignals(
    input.files.map((file) => ({
      fileName: "fileName" in file ? file.fileName : file.file_name,
      mimeType: "mimeType" in file ? file.mimeType : file.file_type,
      pageCount:
        "pageCount" in file
          ? file.pageCount
          : "page_count" in file
            ? file.page_count
            : null,
    }))
  );
}

export function isTakeoffLevelCompatible(
  recommendation: TakeoffDocumentRecommendation | null,
  level: TakeoffLevel
) {
  if (!recommendation) {
    return true;
  }

  return recommendation.compatibleLevels.includes(level);
}

export function getTakeoffSelectionWarning(input: {
  recommendation: TakeoffDocumentRecommendation | null;
  selectedLevel: TakeoffLevel | null;
}): TakeoffSelectionWarning | null {
  const { recommendation, selectedLevel } = input;
  if (!recommendation || !selectedLevel) {
    return null;
  }

  if (!isTakeoffLevelCompatible(recommendation, selectedLevel)) {
    return {
      code: "strong_mismatch",
      message:
        recommendation.documentClass === "structured"
          ? "Ce document ressemble a un metrage structure. Utilisez le niveau Rapide pour eviter un lancement incoherent."
          : "Ce document n'est pas compatible avec le niveau choisi.",
      severity: "critical",
    };
  }

  if (recommendation.recommendedLevel === null) {
    return {
      code: recommendation.warningCode ?? "unsupported_override",
      message:
        recommendation.warningMessage ??
        "Le document n'a pas ete reconnu automatiquement. Verifiez le niveau choisi avant de lancer l'analyse.",
      severity: "critical",
    };
  }

  if (selectedLevel === recommendation.recommendedLevel) {
    if (recommendation.warningCode && recommendation.warningMessage) {
      return {
        code: recommendation.warningCode,
        message: recommendation.warningMessage,
        severity: "warning",
      };
    }

    return null;
  }

  if (recommendation.recommendedLevel === "C" && selectedLevel === "B") {
    return {
      code: "strong_mismatch",
      message:
        "Le document ressemble plutot a un plan complexe. Le niveau Standard risque de produire une extraction incomplète.",
      severity: "critical",
    };
  }

  if (recommendation.recommendedLevel === "B" && selectedLevel === "C") {
    return {
      code: "cost_warning",
      message:
        "Le niveau Detaille reste possible, mais il sera plus couteux que la recommandation Standard.",
      severity: "warning",
    };
  }

  return {
    code: "strong_mismatch",
    message: "Le niveau choisi s'ecarte fortement de la recommandation detectee.",
    severity: "critical",
  };
}
