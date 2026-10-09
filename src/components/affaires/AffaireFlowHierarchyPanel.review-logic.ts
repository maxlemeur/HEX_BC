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
      accent: "text-foreground-secondary",
      frame: "border-border bg-surface-subtle/90",
    };
  }

  return {
    label: "FILE",
    accent: "text-slate-600",
    frame: "border-border bg-surface/90",
  };
}

export function getCategoryIllustrationLabel(category: string) {
  if (category === "dpgf") return "DPGF";
  if (category === "plans") return "Plans";
  if (category === "cctp") return "CCTP";
  if (category === "bpu_dqe") return "BPU/DQE";
  if (category === "emails") return "Courriers";
  if (category === "annexes") return "Annexes";
  return "À classer";
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
      "Pièce reçue",
      "Aucune catégorie certaine",
      "Vérification manuelle requise",
    ];
  }

  const extension = getFileExtension(document.fileName);
  const fileTypeHint =
    extension === "pdf"
      ? "PDF reçu"
      : SPREADSHEET_EXTENSIONS.has(extension)
        ? "Tableur reçu"
        : TEXT_DOCUMENT_EXTENSIONS.has(extension)
          ? "Document texte reçu"
          : IMAGE_EXTENSIONS.has(extension)
            ? "Image reçue"
            : "Pièce reçue";

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
    document.confidence < 0.65 ? "Aucune catégorie certaine" : "",
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
    return "Complémentaire";
  }
  if (input.category === "cctp" && input.hasPrimaryCctp) {
    return "Complémentaire";
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
    return "La pièce integrera le centre plans et pourra nourrir le métré.";
  }
  if (category === "cctp") {
    return hasPrimaryCctp
      ? "La pièce sera ajoutée comme CCTP complémentaire sans remplacer le principal."
      : "La pièce deviendra le CCTP principal pour le cadrage et le brief métier.";
  }
  if (category === "dpgf") {
    return hasPrimaryDpgf
      ? "La pièce sera ajoutée comme DPGF complémentaire sans remplacer le principal."
      : "La pièce deviendra le DPGF principal pour la structure et le chiffrage.";
  }
  if (category === "bpu_dqe") {
    return "La pièce restera exploitable comme base de prix ou de quantités.";
  }
  if (category === "emails") {
    return "La pièce restera disponible comme contexte contractuel secondaire.";
  }
  return "La pièce restera disponible comme document secondaire du dossier.";
}
