import {
  isAffaireIntakeDocumentNeedingReview,
  type AffaireIntakeDocumentKind,
} from "@/lib/affaires/intake";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";

type ReviewDocument = AffaireIntakeWorkspace["documents"][number];
type MissingPiece = AffaireIntakeWorkspace["missingPieces"][number];

const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "csv"]);
const TEXT_DOCUMENT_EXTENSIONS = new Set(["doc", "docx"]);
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
]);
const MESSAGE_EXTENSIONS = new Set(["eml", "msg"]);

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function dedupe(values: string[]) {
  return [...new Set(values)];
}

export function getFileIllustrationTone(fileName: string) {
  const extension = getFileExtension(fileName);

  if (extension === "pdf") {
    return {
      label: "PDF",
      accent: "text-red-600",
      frame: "border-red-200 bg-red-50/90",
    };
  }

  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return {
      label: "XLS",
      accent: "text-emerald-700",
      frame: "border-emerald-200 bg-emerald-50/90",
    };
  }

  if (TEXT_DOCUMENT_EXTENSIONS.has(extension)) {
    return {
      label: "DOC",
      accent: "text-blue-700",
      frame: "border-blue-200 bg-blue-50/90",
    };
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return {
      label: "IMG",
      accent: "text-fuchsia-700",
      frame: "border-fuchsia-200 bg-fuchsia-50/90",
    };
  }

  if (MESSAGE_EXTENSIONS.has(extension)) {
    return {
      label: "MSG",
      accent: "text-slate-700",
      frame: "border-slate-200 bg-slate-50/90",
    };
  }

  return {
    label: "FILE",
    accent: "text-slate-600",
    frame: "border-slate-200 bg-white/90",
  };
}

export function getCategoryIllustrationLabel(category: string) {
  if (category === "dpgf") return "DPGF";
  if (category === "plans") return "Plans";
  if (category === "cctp") return "CCTP";
  if (category === "bpu_dqe") return "BPU/DQE";
  if (category === "emails") return "Courriers";
  if (category === "annexes") return "Annexes";
  return "A classer";
}

export function getReviewProbableCategories(
  document: ReviewDocument | null,
): AffaireIntakeDocumentKind[] {
  if (!document) {
    return ["plans", "cctp", "annexes"];
  }

  const extension = getFileExtension(document.fileName);

  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return ["dpgf", "bpu_dqe", "annexes"];
  }

  if (TEXT_DOCUMENT_EXTENSIONS.has(extension)) {
    return ["cctp", "annexes", "emails"];
  }

  if (MESSAGE_EXTENSIONS.has(extension)) {
    return ["emails", "annexes", "cctp"];
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return ["plans", "annexes", "cctp"];
  }

  return ["plans", "cctp", "annexes"];
}

function getMissingReviewKinds(missingPieces: MissingPiece[]) {
  const kinds = new Set<AffaireIntakeDocumentKind>();

  for (const piece of missingPieces) {
    const normalized = `${piece.code} ${piece.label}`.toLowerCase();
    if (normalized.includes("dpgf")) {
      kinds.add("dpgf");
    }
    if (normalized.includes("plan")) {
      kinds.add("plans");
    }
    if (normalized.includes("cctp")) {
      kinds.add("cctp");
    }
  }

  return kinds;
}

export function sortReviewDocuments(
  documents: ReviewDocument[],
  missingPieces: MissingPiece[],
) {
  const missingKinds = getMissingReviewKinds(missingPieces);

  return [...documents]
    .filter((document) => isAffaireIntakeDocumentNeedingReview(document))
    .sort((left, right) => {
      const leftResolvesCritical = getReviewProbableCategories(left).some(
        (category) => missingKinds.has(category),
      );
      const rightResolvesCritical = getReviewProbableCategories(right).some(
        (category) => missingKinds.has(category),
      );

      if (leftResolvesCritical !== rightResolvesCritical) {
        return leftResolvesCritical ? -1 : 1;
      }

      if (left.confidence !== right.confidence) {
        return left.confidence - right.confidence;
      }

      return left.fileName.localeCompare(right.fileName);
    });
}

export function getReviewEvidenceHints(
  document: ReviewDocument | null,
  missingPieces: MissingPiece[] = [],
) {
  if (!document) {
    return [
      "Piece recue",
      "Aucune categorie certaine",
      "Verification manuelle requise",
    ];
  }

  const extension = getFileExtension(document.fileName);
  const fileTypeHint =
    extension === "pdf"
      ? "PDF recu"
      : SPREADSHEET_EXTENSIONS.has(extension)
        ? "Tableur recu"
        : TEXT_DOCUMENT_EXTENSIONS.has(extension)
          ? "Document texte recu"
          : IMAGE_EXTENSIONS.has(extension)
            ? "Image recue"
            : "Piece recue";

  const missingKinds = getMissingReviewKinds(missingPieces);
  const liftedBlockingHint = getReviewProbableCategories(document).find(
    (category) => missingKinds.has(category),
  );
  const liftHint =
    liftedBlockingHint === "dpgf"
      ? "Peut lever: DPGF manquant"
      : liftedBlockingHint === "plans"
        ? "Peut lever: Plans manquants"
        : liftedBlockingHint === "cctp"
          ? "Peut lever: CCTP manquant"
          : "";

  return dedupe([
    fileTypeHint,
    `${Math.round(document.confidence * 100)}% de confiance`,
    document.confidence < 0.65 ? "Aucune categorie certaine" : "",
    liftHint,
    document.issues[0] ?? "",
  ]).filter(Boolean);
}

export function getReviewChoiceLabel(category: string) {
  return getCategoryIllustrationLabel(category);
}

export function getReviewChoiceSecondaryBadge(input: {
  category: string;
  hasPrimaryDpgf: boolean;
  hasPrimaryCctp: boolean;
}) {
  if (input.category === "dpgf" && input.hasPrimaryDpgf) {
    return "Complementaire";
  }
  if (input.category === "cctp" && input.hasPrimaryCctp) {
    return "Complementaire";
  }

  return null;
}

export function getReviewChoiceConsequence(input: {
  category: string;
  hasPrimaryDpgf: boolean;
  hasPrimaryCctp: boolean;
}) {
  const { category, hasPrimaryDpgf, hasPrimaryCctp } = input;
  if (category === "plans") {
    return "La piece integrera le centre plans et pourra nourrir le metre.";
  }
  if (category === "cctp") {
    return hasPrimaryCctp
      ? "La piece sera ajoutee comme CCTP complementaire sans remplacer le principal."
      : "La piece deviendra le CCTP principal pour le cadrage et le brief metier.";
  }
  if (category === "dpgf") {
    return hasPrimaryDpgf
      ? "La piece sera ajoutee comme DPGF complementaire sans remplacer le principal."
      : "La piece deviendra le DPGF principal pour la structure et le chiffrage.";
  }
  if (category === "bpu_dqe") {
    return "La piece restera exploitable comme base de prix ou de quantites.";
  }
  if (category === "emails") {
    return "La piece restera disponible comme contexte contractuel secondaire.";
  }
  return "La piece restera disponible comme document secondaire du dossier.";
}
