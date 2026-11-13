import { degrees, PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";

import { inferAffaireIntakeMimeType } from "@/lib/affaires/intake";
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
const utf8Length = (text: string) => new TextEncoder().encode(text).byteLength;

/** The longest start of `text` whose UTF-8 bytes fit in `limit`, never half a character. */
function fitBytes(text: string, limit: number) {
  if (utf8Length(text) <= limit) return text;
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const size = utf8Length(character);
    if (bytes + size > limit) break;
    bytes += size;
    end += character.length;
  }
  return text.slice(0, end);
}

/** What a text read may weigh once JSON-encoded, well within what one tool result may carry (see the loop). */
const TEXT_RESULT_CHARACTERS = 90_000;
const BUDGET_SPENT = "Limite de pages lues atteinte pour cette réponse. Réponds avec ce que tu as déjà lu, et dis ce qui reste à lire.";

/** The format a read sends, from the stored type or else the name (as the dossier's preview does); null when the assistant does not read it. */
export function documentReadType(fileName: string, mimeType: string | null) {
  const mime = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const type = mime && mime !== "application/octet-stream" ? mime : inferAffaireIntakeMimeType(fileName) ?? "";
  return type === "application/pdf" || IMAGE_TYPES.has(type) || TEXT_TYPES.has(type) ? type : null;
}

/** The charset a stored type declares (`text/csv; charset=windows-1252`), lowercased; null when it declares none. */
export function charsetOf(mimeType: string | null | undefined) {
  return mimeType?.match(/;\s*charset\s*=\s*["']?([^;\s"']+)/i)?.[1]?.toLowerCase() ?? null;
}

const UNDECODABLE_TEXT = "Le texte de cette pièce n’a pas pu être décodé (encodage non reconnu) : l’assistant ne l’a pas lu. L’utilisateur peut l’ouvrir dans le dossier.";

/**
 * The text of a text file, as written. A byte order mark decides first, then
 * the stored charset; with neither, UTF-8, else Windows-1252 (what a
 * spreadsheet exports a CSV in, and any byte decodes in it). Text that does
 * not decode, or that holds a NUL (binary, or UTF-16 without its mark), is
 * refused rather than sent garbled and recorded as read.
 */
function decodeDocumentText(bytes: Uint8Array, charset: string | null) {
  const mark = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be"
      : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "utf-8" : null;
  for (const encoding of mark ? [mark] : charset ? [charset] : ["utf-8", "windows-1252"]) {
    let text: string;
    try {
      // An unknown label throws as well: refused, not guessed.
      text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      continue;
    }
    if (text.includes("\0")) break;
    return text;
  }
  throw new AssistantToolError(UNDECODABLE_TEXT);
}

export const UNREADABLE_FORMAT = "Ce format n’est pas encore lu par l’assistant : seuls les PDF, les images (PNG, JPEG, WebP) et les fichiers texte le sont. "
  + "Pour une DPGF en tableur, lis plutôt le devis qui l’a importée. L’utilisateur peut ouvrir la pièce dans le dossier.";

/**
 * The page's number in the document, in the top-left corner as the page is
 * shown: on its visible box (a scan or a plan is often cropped) and turned with
 * the page when it is displayed rotated.
 */
function stamp(page: PDFPage, text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>) {
  const box = page.getCropBox();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const at = angle === 90 ? { x: box.x + 10, y: box.y + 6 }
    : angle === 180 ? { x: box.x + box.width - 6, y: box.y + 10 }
      : angle === 270 ? { x: box.x + box.width - 10, y: box.y + box.height - 6 }
        : { x: box.x + 6, y: box.y + box.height - 10 };
  page.drawText(text, { ...at, size: 7, font, color: rgb(0.45, 0.45, 0.45), rotate: degrees(angle) });
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
    stamp(page, `MergeOne - page ${from + offset} / ${total}`, font);
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
  const slice = async (pages: number) => {
    try {
      return await slicePdf(source, from, pages, total);
    } catch {
      // A page whose content cannot be copied: the same answer as a file that cannot be opened.
      throw new AssistantToolError(unreadable);
    }
  };
  let sliced = await slice(count);
  // Heavy pages (a detailed plan) are sent fewer at a time rather than not at all.
  while (sliced.byteLength > byteCap && count > 1) {
    count = Math.max(1, Math.floor(count / 2));
    cut = byteCap < input.limits.bytesPerRead ? "budget" : "bytes";
    sliced = await slice(count);
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
 * What the next read may send, refused once the answer has spent what it may
 * read or once one read's worth already waits for the next request. Checked
 * again before a document is fetched.
 */
export function assertDocumentBudget(ledger: AssistantDocumentLedger, limits: DocumentReadLimits = DOCUMENT_READ_LIMITS) {
  const budget = ledger.readAllowance(limits);
  if (budget.pagesLeft <= 0 || budget.bytesLeft <= 0) throw new AssistantToolError(BUDGET_SPENT);
  return budget;
}

/**
 * What one read of a document sends to the model, within the bounds of a read
 * and of the answer. A PDF is sent by page range; an image whole; a text file
 * as text. The read is recorded in the answer's ledger, whose pages alone may
 * then be cited. Anything refused sends nothing and spends nothing.
 */
export async function prepareDocumentRead(input: {
  documentId: string; fileName: string; mimeType: string | null; bytes: Uint8Array;
  /** The stored charset of a text file, when its stored type declared one; else read from `mimeType`. */
  charset?: string | null;
  pageStart?: number; pageEnd?: number; ledger: AssistantDocumentLedger; limits?: DocumentReadLimits;
}): Promise<PreparedDocumentRead> {
  const limits = input.limits ?? DOCUMENT_READ_LIMITS;
  const budget = assertDocumentBudget(input.ledger, limits);
  const type = documentReadType(input.fileName, input.mimeType);
  if (type === null) throw new AssistantToolError(UNREADABLE_FORMAT);

  let prepared: PreparedDocumentRead;
  if (type === "application/pdf") {
    prepared = await preparePdf({ bytes: input.bytes, pageStart: input.pageStart, pageEnd: input.pageEnd, budget, limits });
  } else {
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
      const whole = decodeDocumentText(input.bytes, input.charset ?? charsetOf(input.mimeType));
      let text = whole.slice(0, limits.textCharacters);
      // Quotes and control characters weigh several characters once encoded: what is recorded as read must reach the model.
      while (JSON.stringify(text).length > TEXT_RESULT_CHARACTERS) text = text.slice(0, Math.floor(text.length * 0.8));
      let cut: PreparedDocumentRead["cut"] = text.length < whole.length ? "characters" : null;
      // What the answer has left to send applies to text as to any file, cut on a whole character.
      const fitting = fitBytes(text, Math.min(limits.bytesPerRead, budget.bytesLeft));
      if (fitting.length < text.length) {
        if (!fitting) throw new AssistantToolError(BUDGET_SPENT);
        text = fitting;
        cut = "budget";
      }
      prepared = { pagesTotal: 1, from: 1, to: 1, cut, nextPage: null, bytes: utf8Length(text), parts: [], text };
    }
  }
  input.ledger.recordRead({
    documentId: input.documentId, fileName: input.fileName, pagesTotal: prepared.pagesTotal,
    from: prepared.from, to: prepared.to, pages: prepared.to - prepared.from + 1, bytes: prepared.bytes,
  });
  return prepared;
}
