import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { AssistantDocumentLedger, DOCUMENT_READ_LIMITS, type DocumentReadLimits } from "@/lib/assistant/document-citations";
import { AssistantToolError } from "@/lib/assistant/loop";

export { DOCUMENT_READ_LIMITS };

export type PreparedDocumentRead = {
  pagesTotal: number;
  /** The pages of the document this read sends, inclusive. */
  from: number;
  to: number;
  /** Why fewer pages (or characters) than asked were sent, if so. */
  cut: "pages" | "bytes" | "budget" | "characters" | null;
  /** The first page not sent yet of the asked range, to ask for next. */
  nextPage: number | null;
  /** Bytes sent to the model (before base64). */
  bytes: number;
  /** The document's content parts, as the classification sends them: a PDF file or an image. */
  parts: Record<string, unknown>[];
  /** The content of a text file, given in the tool result itself. */
  text: string | null;
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const TEXT_TYPES = new Set(["text/plain", "text/csv"]);
const BUDGET_SPENT = "Limite de pages lues atteinte pour cette réponse. Réponds avec ce que tu as déjà lu, et dis ce qui reste à lire.";

function typeOf(fileName: string, mimeType: string | null) {
  const mime = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime && mime !== "application/octet-stream") return mime;
  const extension = fileName.toLowerCase().split(".").pop();
  return extension === "pdf" ? "application/pdf" : extension === "txt" ? "text/plain" : extension === "csv" ? "text/csv" : mime;
}

/**
 * The asked pages of a PDF as a new PDF. Each page keeps its content and gets
 * its number in the document stamped in a corner, so that the model reads the
 * page it cites even when the file it gets starts at page 11.
 */
async function slicePdf(source: PDFDocument, from: number, count: number, total: number) {
  const target = await PDFDocument.create();
  const font = await target.embedFont(StandardFonts.Helvetica);
  const indexes = Array.from({ length: count }, (_, offset) => from - 1 + offset);
  const pages = await target.copyPages(source, indexes);
  pages.forEach((page, offset) => {
    target.addPage(page);
    const box = page.getMediaBox();
    page.drawText(`MergeOne - page ${from + offset} / ${total}`, {
      x: box.x + 6, y: box.y + box.height - 10, size: 7, font, color: rgb(0.45, 0.45, 0.45),
    });
  });
  return target.save();
}

async function preparePdf(input: { bytes: Uint8Array; pageStart?: number; pageEnd?: number; budget: { pagesLeft: number; bytesLeft: number }; limits: DocumentReadLimits }) {
  const unreadable = "Ce PDF ne peut pas être lu (protégé ou abîmé). L’utilisateur peut l’ouvrir dans le dossier.";
  let source: PDFDocument;
  let total: number;
  try {
    // A broken file can load and fail only once its pages are asked for.
    source = await PDFDocument.load(input.bytes, { updateMetadata: false });
    total = source.getPageCount();
  } catch {
    throw new AssistantToolError(unreadable);
  }
  if (total === 0) throw new AssistantToolError(unreadable);
  const from = input.pageStart ?? 1;
  if (from > total) throw new AssistantToolError(`Cette pièce compte ${total} pages : demande une page de 1 à ${total}.`);
  const end = Math.min(input.pageEnd ?? total, total);
  if (end < from) throw new AssistantToolError("La page de fin précède la page de début.");

  const wanted = end - from + 1;
  let count = Math.min(wanted, input.limits.pagesPerRead, input.budget.pagesLeft);
  let cut: PreparedDocumentRead["cut"] = count === wanted ? null : count < input.limits.pagesPerRead ? "budget" : "pages";
  const byteCap = Math.min(input.limits.bytesPerRead, input.budget.bytesLeft);
  let sliced = await slicePdf(source, from, count, total);
  // Heavy pages (a detailed plan) are sent fewer at a time rather than not at all.
  while (sliced.byteLength > byteCap && count > 1) {
    count = Math.max(1, Math.floor(count / 2));
    cut = byteCap < input.limits.bytesPerRead ? "budget" : "bytes";
    sliced = await slicePdf(source, from, count, total);
  }
  if (sliced.byteLength > byteCap) {
    throw new AssistantToolError(byteCap < input.limits.bytesPerRead ? BUDGET_SPENT
      : `La page ${from} est trop lourde pour être lue par l’assistant (plan très détaillé). L’utilisateur peut l’ouvrir dans le dossier.`);
  }
  const to = from + count - 1;
  return {
    pagesTotal: total, from, to, cut, nextPage: to < end ? to + 1 : null, bytes: sliced.byteLength, text: null,
    parts: [{ type: "input_file", filename: "document.pdf", file_data: `data:application/pdf;base64,${Buffer.from(sliced).toString("base64")}` }],
  };
}

/**
 * What one read of a document sends to the model, within the bounds of a read
 * and of the answer. A PDF is sent by page range; an image whole; a text file
 * as text. The read is recorded in the answer's ledger, whose pages alone may
 * then be cited. Anything refused sends nothing and spends nothing.
 */
export async function prepareDocumentRead(input: {
  documentId: string; fileName: string; mimeType: string | null; bytes: Uint8Array;
  pageStart?: number; pageEnd?: number; ledger: AssistantDocumentLedger; limits?: DocumentReadLimits;
}): Promise<PreparedDocumentRead> {
  const limits = input.limits ?? DOCUMENT_READ_LIMITS;
  const budget = input.ledger.budget(limits);
  if (budget.pagesLeft <= 0 || budget.bytesLeft <= 0) throw new AssistantToolError(BUDGET_SPENT);
  const type = typeOf(input.fileName, input.mimeType);

  let prepared: PreparedDocumentRead;
  if (type === "application/pdf") {
    prepared = await preparePdf({ bytes: input.bytes, pageStart: input.pageStart, pageEnd: input.pageEnd, budget, limits });
  } else if (IMAGE_TYPES.has(type) || TEXT_TYPES.has(type)) {
    if ((input.pageStart ?? 1) > 1) throw new AssistantToolError("Cette pièce n’a qu’une page.");
    if (IMAGE_TYPES.has(type)) {
      if (input.bytes.byteLength > Math.min(limits.bytesPerRead, budget.bytesLeft)) {
        throw new AssistantToolError("Cette image est trop lourde pour être lue par l’assistant. L’utilisateur peut l’ouvrir dans le dossier.");
      }
      prepared = {
        pagesTotal: 1, from: 1, to: 1, cut: null, nextPage: null, bytes: input.bytes.byteLength, text: null,
        parts: [{ type: "input_image", image_url: `data:${type};base64,${Buffer.from(input.bytes).toString("base64")}` }],
      };
    } else {
      const whole = new TextDecoder().decode(input.bytes);
      const text = whole.slice(0, limits.textCharacters);
      prepared = {
        pagesTotal: 1, from: 1, to: 1, cut: text.length < whole.length ? "characters" : null, nextPage: null,
        bytes: new TextEncoder().encode(text).byteLength, parts: [], text,
      };
    }
  } else {
    throw new AssistantToolError("Ce format n’est pas encore lu par l’assistant : seuls les PDF, les images (PNG, JPEG, WebP) et les fichiers texte le sont. "
      + "Pour une DPGF en tableur, lis plutôt le devis qui l’a importée. L’utilisateur peut ouvrir la pièce dans le dossier.");
  }
  input.ledger.recordRead({
    documentId: input.documentId, fileName: input.fileName, pagesTotal: prepared.pagesTotal,
    from: prepared.from, to: prepared.to, pages: prepared.to - prepared.from + 1, bytes: prepared.bytes,
  });
  return prepared;
}
