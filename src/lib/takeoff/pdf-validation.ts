import { PDFDocument } from "pdf-lib";

type PdfUploadValidationResult =
  | {
      valid: true;
      normalizedMimeType: "application/pdf";
    }
  | {
      valid: false;
      reason: "empty" | "too_large" | "unsupported";
      message: string;
    };

type PdfInspectionResult =
  | {
      valid: true;
      pageCount: number;
    }
  | {
      valid: false;
      reason: "corrupted";
      message: string;
      details: Record<string, unknown>;
    };

const PDF_PRIMARY_MIME_TYPE = "application/pdf";
const PDF_UNRELIABLE_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-pdf",
  "application/acrobat",
  "applications/vnd.pdf",
  "text/pdf",
]);

function normalizeMimeType(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function isPdfFileName(fileName: string) {
  return fileName.trim().toLowerCase().endsWith(".pdf");
}

export function resolveTakeoffPdfMimeType(input: {
  fileName: string;
  mimeType: string | null | undefined;
}): "application/pdf" | null {
  const normalizedMimeType = normalizeMimeType(input.mimeType);

  if (normalizedMimeType === PDF_PRIMARY_MIME_TYPE) {
    return PDF_PRIMARY_MIME_TYPE;
  }

  if (isPdfFileName(input.fileName) && PDF_UNRELIABLE_MIME_TYPES.has(normalizedMimeType)) {
    return PDF_PRIMARY_MIME_TYPE;
  }

  return null;
}

export function validateTakeoffPdfUploadMetadata(input: {
  fileName: string;
  mimeType: string | null | undefined;
  fileSizeBytes: number;
  maxFileSizeBytes: number;
  maxFileSizeLabel: string;
}): PdfUploadValidationResult {
  if (input.fileSizeBytes <= 0) {
    return {
      valid: false,
      reason: "empty",
      message: "Le fichier est vide.",
    };
  }

  if (input.fileSizeBytes > input.maxFileSizeBytes) {
    return {
      valid: false,
      reason: "too_large",
      message: `Le fichier depasse ${input.maxFileSizeLabel}.`,
    };
  }

  const normalizedMimeType = resolveTakeoffPdfMimeType({
    fileName: input.fileName,
    mimeType: input.mimeType,
  });

  if (!normalizedMimeType) {
    return {
      valid: false,
      reason: "unsupported",
      message:
        "Le document doit etre un PDF (.pdf). Si le navigateur remonte un type MIME incorrect, verifiez l'extension ou reexportez le fichier.",
    };
  }

  return {
    valid: true,
    normalizedMimeType,
  };
}

function buildPdfInspectionMessage(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("encrypted") || message.includes("password")) {
    return {
      message:
        "Le PDF est protege et ne peut pas etre analyse. Exportez une version non protegee puis relancez.",
      details: {
        reason: "encrypted_pdf",
        provider_message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  return {
    message:
      "Le PDF est invalide ou corrompu. Reexportez-le depuis la source puis relancez l'analyse.",
    details: {
      reason: "corrupted_pdf",
      provider_message: error instanceof Error ? error.message : String(error),
    },
  };
}

export async function inspectTakeoffPdfBytes(
  bytes: ArrayBuffer
): Promise<PdfInspectionResult> {
  try {
    const pdf = await PDFDocument.load(bytes);
    const pageCount = pdf.getPageCount();

    if (!Number.isInteger(pageCount) || pageCount <= 0) {
      return {
        valid: false,
        reason: "corrupted",
        message:
          "Le PDF est invalide ou incomplet. Reexportez-le depuis la source puis relancez l'analyse.",
        details: {
          reason: "invalid_page_count",
          page_count: pageCount,
        },
      };
    }

    return {
      valid: true,
      pageCount,
    };
  } catch (error) {
    const failure = buildPdfInspectionMessage(error);
    return {
      valid: false,
      reason: "corrupted",
      message: failure.message,
      details: failure.details,
    };
  }
}

export function buildTakeoffPdfNotInterpretableMessage(level: "B" | "C") {
  if (level === "C") {
    return "Le PDF est lisible mais ne contient pas assez d'elements exploitables pour une pre-estimation. Importez un plan plus lisible ou un autre document.";
  }

  return "Le PDF est lisible mais aucun tableau exploitable n'a ete detecte. Importez un PDF mieux exporte ou essayez un autre document.";
}
