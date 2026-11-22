import "server-only";

import { inflateRawSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";

import { AFFAIRE_INTAKE_BUCKET, isAffaireIntakeStorageKey } from "@/lib/affaires/intake";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { readAllRows } from "@/lib/supabase/read-all";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import type { TakeoffPreparationSnapshot, TakeoffPreparationSource } from "@/lib/takeoff/preparation";
import { getPreparationIntakeSourceVersion, type PreparationIntakeDocument } from "@/lib/takeoff/preparation-sources";
import { sha256Hex } from "@/lib/takeoff/sha256";

/**
 * The bounds of the references one analysis attaches: at most `files` pieces, `originalBytes` of stored files,
 * `retainedPages` PDF pages and `contextBytes` of what is attached (selected pages, decoded text, sheets as CSV). The
 * worker applies them below; the sealing of a preparation applies them through the same functions, so that a reference
 * it retains is one the worker reads.
 */
export const PREPARATION_REFERENCE_LIMITS = {
  files: 20, originalBytes: 20 * 1024 * 1024, retainedPages: 200, contextBytes: 20 * 1024 * 1024,
} as const;
const MAX_WORKSHEET_CELLS = 1_000_000;
const MAX_WORKBOOK_EXPANDED_BYTES = 32 * 1024 * 1024;
const REFERENCE_SELECT = "id,tenant_id,project_id,upload_id,file_name,storage_path,size_bytes,mime_type,document_kind,updated_at,extracted_metadata";

type Input = {
  supabase: AuthenticatedTenantContext["supabase"];
  job: TakeoffJobProcessingRow;
  snapshot: TakeoffPreparationSnapshot;
};
type ReferenceDocument = PreparationIntakeDocument & { tenant_id: string; project_id: string };
type ReferenceFile = { data: string; mimeType: string };

function rejectSource(job: TakeoffJobProcessingRow, message: string): never {
  throw new TakeoffError({
    status: 409, code: TakeoffErrorCode.CONFLICT, message,
    details: { reason: "PREPARATION_SOURCE_CHANGED" }, retryable: false, jobId: job.id,
  });
}

function rejectSize(job: TakeoffJobProcessingRow): never {
  throw new TakeoffError({
    code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
    message: "Les pièces de référence dépassent les limites de traitement (20 fichiers, 20 Mo ou 200 pages retenues). Réduisez le périmètre et confirmez à nouveau.",
    retryable: false, jobId: job.id,
  });
}

/** Bound actual ZIP inflation before SheetJS parses an XLSX, including forged size headers. */
function validateWorkbookArchive(bytes: Buffer) {
  let end = bytes.length - 22;
  const minimum = Math.max(0, bytes.length - 65_557);
  while (end >= minimum && bytes.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < minimum) throw new Error("Archive XLSX invalide.");
  const entries = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (entries > 512 || !entries || directoryOffset + directorySize > end) throw new Error("Archive XLSX hors limites.");
  let cursor = directoryOffset;
  let expanded = 0;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > directoryOffset + directorySize || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Archive XLSX invalide.");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const declaredSize = bytes.readUInt32LE(cursor + 24);
    const local = bytes.readUInt32LE(cursor + 42);
    if ((flags & 1) || (method !== 0 && method !== 8) || declaredSize > MAX_WORKBOOK_EXPANDED_BYTES - expanded || local + 30 > directoryOffset || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error("Archive XLSX hors limites.");
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressedSize > directoryOffset) throw new Error("Archive XLSX tronquée.");
    const compressed = bytes.subarray(start, start + compressedSize);
    const inflated = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, MAX_WORKBOOK_EXPANDED_BYTES - expanded) });
    if (inflated.byteLength !== declaredSize) throw new Error("Taille XLSX incohérente.");
    expanded += inflated.byteLength;
    cursor += 46 + bytes.readUInt16LE(cursor + 28) + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }
  if (cursor !== directoryOffset + directorySize) throw new Error("Répertoire XLSX incohérent.");
}

function decodeText(bytes: Buffer, mimeType: string | null): string {
  const charset = mimeType?.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : charset ?? "utf-8";
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (text.includes("\0") || !text.trim()) throw new Error("Contenu texte invalide ou vide.");
  return text;
}

function spreadsheetText(bytes: Buffer, document: Pick<PreparationIntakeDocument, "file_name" | "mime_type">, csv: boolean): string {
  if (!csv) {
    const signature = bytes.length >= 4 ? bytes.readUInt32LE(0) : null;
    if (signature === 0x04034b50) validateWorkbookArchive(bytes);
    else if (document.file_name.toLowerCase().endsWith(".xlsx") || document.mime_type?.split(";")[0] === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
             (signature !== 0xe011cfd0 && !bytes.toString("utf8", 0, 100).trimStart().startsWith("<"))) {
      throw new Error("Classeur Excel invalide.");
    }
  }
  const workbook = XLSX.read(csv ? decodeText(bytes, document.mime_type) : bytes, {
    type: csv ? "string" : "buffer", dense: true, raw: true, cellHTML: false,
  });
  if (!workbook.SheetNames.length || workbook.SheetNames.length > 32) throw new Error("Nombre de feuilles hors limites.");
  const sections: string[] = [];
  let size = 0;
  let cells = 0;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) throw new Error("Feuille introuvable.");
    if (sheet["!ref"]) {
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      cells += (range.e.r + 1) * (range.e.c + 1);
      if (!Number.isSafeInteger(cells) || cells > MAX_WORKSHEET_CELLS) throw new Error("Classeur hors limites.");
      // CSV starts at !ref; preserve leading blank rows/columns for original coordinates.
      sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: range.e });
    }
    const section = `Feuille ${JSON.stringify(name)} (CSV, lignes et colonnes d'origine conservées)\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: true })}`;
    size += Buffer.byteLength(section, "utf8") + 2;
    if (size > PREPARATION_REFERENCE_LIMITS.contextBytes) throw new Error("Contenu du classeur hors limites.");
    sections.push(section);
  }
  return sections.join("\n\n");
}

export function classifyPreparationReferenceFormat(document: Pick<PreparationIntakeDocument, "file_name" | "mime_type">): "pdf" | "csv" | "spreadsheet" | "text" | null {
  const extension = document.file_name.toLowerCase().split(".").pop();
  const mime = document.mime_type?.split(";")[0].trim().toLowerCase();
  if (extension === "pdf" || mime === "application/pdf") return "pdf";
  if (extension === "csv" || mime === "text/csv") return "csv";
  if (extension === "xls" || extension === "xlsx" || mime === "application/vnd.ms-excel" || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "spreadsheet";
  if (extension === "txt" || extension === "eml" || mime === "message/rfc822" || mime?.startsWith("text/")) return "text";
  return null;
}

export type PreparationReferenceFormat = NonNullable<ReturnType<typeof classifyPreparationReferenceFormat>>;

/**
 * Why the worker would not attach a reference read from its verified bytes: pages the PDF does not have, a page
 * selection on a piece that is not a PDF, the analysis's page or context bound, or content it cannot read (a corrupt or
 * protected PDF, an invalid workbook, undecodable or empty text).
 */
export class PreparationReferenceRefusal extends Error {
  constructor(readonly reason: "invalid_pages" | "pages_need_pdf" | "page_limit" | "context_limit" | "invalid_content") {
    super(reason);
    this.name = "PreparationReferenceRefusal";
  }
}

/** What the references of one analysis already take of its bounds: a reference is charged only once it is attached. */
export type PreparationReferenceBudget = { files: number; originalBytes: number; retainedPages: number; contextBytes: number };

export function createPreparationReferenceBudget(): PreparationReferenceBudget {
  return { files: 0, originalBytes: 0, retainedPages: 0, contextBytes: 0 };
}

/** A stored size the worker accepts for a reference. */
export function isPreparationReferenceSize(sizeBytes: number) {
  return Number.isSafeInteger(sizeBytes) && sizeBytes > 0;
}

/** The bound one more reference of `sizeBytes` stored bytes would pass (the number of pieces, their stored size), if any. */
export function preparationReferenceFileLimit(budget: PreparationReferenceBudget, sizeBytes: number): "files" | "original_bytes" | null {
  if (budget.files + 1 > PREPARATION_REFERENCE_LIMITS.files) return "files";
  if (budget.originalBytes + sizeBytes > PREPARATION_REFERENCE_LIMITS.originalBytes) return "original_bytes";
  return null;
}

/** Charges one more reference of `sizeBytes` stored bytes, unless the analysis's file or size bound would be passed. */
export function admitPreparationReferenceFile(budget: PreparationReferenceBudget, sizeBytes: number) {
  if (!isPreparationReferenceSize(sizeBytes) || preparationReferenceFileLimit(budget, sizeBytes)) return false;
  budget.files += 1;
  budget.originalBytes += sizeBytes;
  return true;
}

/**
 * The worker's reading of one reference from its verified bytes: what it attaches (the selected pages of a PDF, a text
 * decoded, every sheet of a workbook as CSV), with its provenance, within what `budget` has left of the page and context
 * bounds. Throws a `PreparationReferenceRefusal`, charging nothing, when the worker would not attach it.
 */
export async function readPreparationReference(input: {
  bytes: Buffer; format: PreparationReferenceFormat; document: Pick<PreparationIntakeDocument, "file_name" | "mime_type">;
  pages: readonly number[];
}, budget: PreparationReferenceBudget): Promise<{ data: Buffer; mimeType: "application/pdf" | "text/plain"; provenance: string }> {
  let data: Buffer;
  let provenance: string;
  let retained = 0;
  try {
    if (input.format === "pdf") {
      const pdf = await PDFDocument.load(input.bytes);
      const pages = input.pages.length ? [...input.pages] : Array.from({ length: pdf.getPageCount() }, (_, index) => index + 1);
      if (!pages.length || new Set(pages).size !== pages.length || pages.some((page) => !Number.isInteger(page) || page < 1 || page > pdf.getPageCount())) {
        throw new PreparationReferenceRefusal("invalid_pages");
      }
      if (budget.retainedPages + pages.length > PREPARATION_REFERENCE_LIMITS.retainedPages) throw new PreparationReferenceRefusal("page_limit");
      retained = pages.length;
      data = input.bytes;
      if (input.pages.length) {
        const selected = await PDFDocument.create();
        for (const page of await selected.copyPages(pdf, pages.map((page) => page - 1))) selected.addPage(page);
        data = Buffer.from(await selected.save());
      }
      provenance = `Pages du PDF joint → pages d'origine : ${pages.map((page, index) => `${index + 1}→${page}`).join(", ")}.`;
    } else {
      if (input.pages.length) throw new PreparationReferenceRefusal("pages_need_pdf");
      data = Buffer.from(input.format === "text" ? decodeText(input.bytes, input.document.mime_type)
        : spreadsheetText(input.bytes, input.document, input.format === "csv"), "utf8");
      provenance = input.format === "text" ? "Texte intégral décodé en UTF-8." : "Toutes les feuilles du classeur sont jointes en CSV, avec leurs noms d'origine.";
    }
  } catch (error) {
    if (error instanceof PreparationReferenceRefusal) throw error;
    throw new PreparationReferenceRefusal("invalid_content");
  }
  if (budget.contextBytes + data.byteLength > PREPARATION_REFERENCE_LIMITS.contextBytes) throw new PreparationReferenceRefusal("context_limit");
  budget.retainedPages += retained;
  budget.contextBytes += data.byteLength;
  return { data, mimeType: input.format === "pdf" ? "application/pdf" : "text/plain", provenance };
}

async function readReferenceDocuments(input: Input, projectId: string, sources: TakeoffPreparationSource[]) {
  try {
    const { data, error } = await readAllRows(() => input.supabase.from("affaire_intake_documents" as never)
      .select(REFERENCE_SELECT as never, { count: "exact" })
      .eq("tenant_id" as never, input.job.tenant_id as never).eq("project_id" as never, projectId as never)
      .eq("upload_status" as never, "uploaded" as never).is("deleted_at" as never, null).is("deletion_token" as never, null)
      .in("id" as never, sources.map((source) => source.document_id) as never).order("id" as never)
      .abortSignal(new AbortController().signal));
    if (error) rejectSource(input.job, "Impossible de vérifier les pièces de référence confirmées.");
    const documents = new Map((data as unknown as ReferenceDocument[] ?? []).map((document) => [document.id, document]));
    for (const source of sources) {
      const document = documents.get(source.document_id);
      const kind = document?.document_kind === "dpgf" || document?.document_kind === "cctp" ? document.document_kind : "other";
      if (!document || document.tenant_id !== input.job.tenant_id || document.project_id !== projectId ||
          document.document_kind === "plans" || document.document_kind === "plan" || source.kind !== kind ||
          source.source_version !== getPreparationIntakeSourceVersion(document) || source.file_path !== document.storage_path ||
          !document.storage_path || (!source.confirmed && !input.snapshot.preparation.provenance) || !source.content_hash) {
        rejectSource(input.job, `La pièce « ${source.document_name} » a changé ou n'est plus disponible. Confirmez à nouveau la préparation.`);
      }
      // The worker's own client is not bound by the bucket's policy: only the object the dossier wrote for this piece of
      // this affaire is read.
      if (!isAffaireIntakeStorageKey(document.storage_path!, { tenantId: input.job.tenant_id, projectId, uploadId: document.upload_id ?? null,
          documentId: document.id })) {
        rejectSource(input.job, `Le fichier de la pièce « ${source.document_name} » n’est pas celui que le dossier de cette affaire a enregistré. Confirmez à nouveau la préparation.`);
      }
    }
    return documents;
  } catch (error) {
    if (error instanceof TakeoffError) throw error;
    rejectSource(input.job, "Impossible de vérifier les pièces de référence confirmées.");
  }
}

/** Never replaces an unavailable reference with an intake snippet or another document. */
export async function loadPreparationReferenceFiles(input: Input): Promise<{ files: ReferenceFile[]; sourceHints: string[];
  /** Each file's kind, name and indice, in the files' order (lot 4: the reading against the list attaches the CCTP only). */
  references: Array<{ kind: "dpgf" | "cctp" | "other"; name: string; revision: string | null }> }> {
  const sources = input.snapshot.preparation.sources.filter((source) => source.active && source.kind !== "plan");
  if (!sources.length) return { files: [], sourceHints: [], references: [] };
  if (sources.length > PREPARATION_REFERENCE_LIMITS.files) rejectSize(input.job);
  if (new Set(sources.map((source) => source.document_id)).size !== sources.length) rejectSource(input.job, "Une pièce de référence est sélectionnée plusieurs fois.");
  let projectId = input.job.project_id;
  // Previously serialized historical jobs can still carry only their version.
  if (!projectId && input.job.estimate_version_id) {
    const { data: version, error } = await input.supabase.from("estimate_versions").select("project_id")
      .eq("tenant_id", input.job.tenant_id).eq("id", input.job.estimate_version_id).single();
    if (error) rejectSource(input.job, "L'affaire de l'analyse confirmée n'est plus accessible.");
    projectId = version?.project_id;
  }
  if (!projectId) rejectSource(input.job, "L'affaire de l'analyse confirmée n'est plus accessible.");
  const documents = await readReferenceDocuments(input, projectId, sources);
  for (const document of documents.values()) {
    if (!isPreparationReferenceSize(document.size_bytes)) rejectSource(input.job, "La taille d'une pièce de référence confirmée est invalide.");
  }
  const budget = createPreparationReferenceBudget();
  for (const document of documents.values()) {
    if (!admitPreparationReferenceFile(budget, document.size_bytes)) rejectSize(input.job);
  }
  const files: ReferenceFile[] = [];
  const sourceHints: string[] = [];
  const references: Array<{ kind: "dpgf" | "cctp" | "other"; name: string; revision: string | null }> = [];
  for (const source of sources) {
    const document = documents.get(source.document_id)!;
    const format = classifyPreparationReferenceFormat(document);
    if (!format) throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: `Le format de la pièce confirmée « ${source.document_name} » n'est pas exploitable pour cette analyse. Utilisez un PDF, un CSV, un classeur Excel ou un texte.`,
      retryable: false, jobId: input.job.id,
    });
    let blob: Blob;
    try {
      const downloaded = await input.supabase.storage.from(AFFAIRE_INTAKE_BUCKET).download(document.storage_path!);
      if (downloaded.error || !downloaded.data || downloaded.data.size !== document.size_bytes) rejectSource(input.job, `La pièce confirmée « ${source.document_name} » est introuvable ou incomplète.`);
      blob = downloaded.data;
    } catch (error) {
      if (error instanceof TakeoffError) throw error;
      rejectSource(input.job, `La pièce confirmée « ${source.document_name} » est introuvable.`);
    }
    let bytes: Buffer;
    try { bytes = Buffer.from(await blob.arrayBuffer()); } catch { rejectSource(input.job, `La pièce confirmée « ${source.document_name} » est illisible.`); }
    if (bytes.byteLength !== document.size_bytes || sha256Hex(bytes) !== source.content_hash!.toLowerCase()) {
      rejectSource(input.job, `Le contenu de la pièce « ${source.document_name} » ne correspond plus au fichier confirmé.`);
    }
    let reading: Awaited<ReturnType<typeof readPreparationReference>>;
    try {
      reading = await readPreparationReference({ bytes, format, document, pages: source.pages }, budget);
    } catch (error) {
      if (!(error instanceof PreparationReferenceRefusal)) throw error;
      if (error.reason === "invalid_pages") rejectSource(input.job, `Les pages retenues de « ${source.document_name} » sont invalides.`);
      if (error.reason === "pages_need_pdf") rejectSource(input.job, `La sélection de pages de « ${source.document_name} » nécessite un PDF.`);
      if (error.reason === "page_limit" || error.reason === "context_limit") rejectSize(input.job);
      throw new TakeoffError({
        code: format === "pdf" ? TakeoffErrorCode.TAKEOFF_PDF_CORRUPTED : TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
        message: `La pièce confirmée « ${source.document_name} » est invalide, protégée ou dépasse les limites de lecture.`,
        retryable: false, jobId: input.job.id,
      });
    }
    files.push({ data: reading.data.toString("base64"), mimeType: reading.mimeType });
    references.push({ kind: source.kind as "dpgf" | "cctp" | "other", name: document.file_name, revision: source.revision ?? null });
    sourceHints.push(`Pièce de référence jointe ${files.length} : ${JSON.stringify({ document_id: source.document_id, document_name: document.file_name, kind: source.kind, revision: source.revision })}. ${reading.provenance}`);
  }
  // A reference deleted or revised during its download must be confirmed again.
  await readReferenceDocuments(input, projectId, sources);
  return { files, sourceHints, references };
}
