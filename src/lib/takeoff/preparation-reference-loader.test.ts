import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import { AFFAIRE_INTAKE_BUCKET } from "@/lib/affaires/intake";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { TakeoffErrorCode } from "@/lib/takeoff/errors";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot, type TakeoffPreparationSource } from "@/lib/takeoff/preparation";
import { loadPreparationReferenceFiles } from "@/lib/takeoff/preparation-reference-loader";
import { toPreparationIntakeSource, type PreparationIntakeDocument } from "@/lib/takeoff/preparation-sources";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const DOCUMENT_ID = "55555555-5555-4555-8555-555555555555";
const job = {
  id: "66666666-6666-4666-8666-666666666666", tenant_id: TENANT_ID,
  estimate_version_id: VERSION_ID,
} as TakeoffJobProcessingRow;

type Document = PreparationIntakeDocument & {
  tenant_id: string; project_id: string; upload_status: string;
  deleted_at: string | null; deletion_token: string | null;
};

function fixture(bytes: Buffer, overrides: Partial<Document> = {}) {
  const document: Document = {
    id: DOCUMENT_ID, tenant_id: TENANT_ID, project_id: PROJECT_ID,
    file_name: "CCTP plomberie.pdf", storage_path: `${TENANT_ID}/${PROJECT_ID}/cctp.pdf`,
    size_bytes: bytes.byteLength, mime_type: "application/pdf", document_kind: "cctp",
    updated_at: "2026-10-29T09:00:00.000Z", upload_status: "uploaded",
    deleted_at: null, deletion_token: null, ...overrides,
  };
  const source: TakeoffPreparationSource = {
    ...toPreparationIntakeSource(document), active: true, confirmed: true,
    revision: "B", content_hash: createHash("sha256").update(bytes).digest("hex"),
  };
  return { document, source };
}

function snapshot(sources: TakeoffPreparationSource[]) {
  const preparation = createEmptyTakeoffPreparation();
  preparation.objective = "extract_quantities";
  preparation.objective_confirmed = true;
  preparation.scope.inclusions = ["Quantités documentaires de plomberie"];
  preparation.scope.confirmed = true;
  preparation.sources = sources;
  preparation.conventions.unit = "u";
  preparation.conventions.confirmed = true;
  preparation.destination.confirmed = true;
  return createTakeoffPreparationSnapshot({
    preparation, revision: 1, confirmedBy: TENANT_ID, confirmedAt: "2026-10-29T10:00:00.000Z",
  });
}

function database(documents: Document[], bytes: Buffer, options: {
  missingVersion?: boolean; missingFile?: boolean; onDownload?: () => void;
  downloadBytes?: Buffer; downloadSize?: number;
} = {}) {
  const download = vi.fn(async () => {
    options.onDownload?.();
    const blob = new Blob([Uint8Array.from(options.downloadBytes ?? bytes)]);
    if (options.downloadSize !== undefined) Object.defineProperty(blob, "size", { value: options.downloadSize });
    return { data: options.missingFile ? null : blob, error: null };
  });
  const storageFrom = vi.fn(() => ({ download }));
  const from = vi.fn((table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const rows = () => (table === "estimate_versions"
      ? options.missingVersion ? [] : [{ id: VERSION_ID, tenant_id: TENANT_ID, project_id: PROJECT_ID }]
      : documents).filter((row) => filters.every((filter) => filter(row)));
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
      is: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
      order: () => builder,
      abortSignal: () => builder,
      range: async (start: number, end: number) => ({ data: rows().slice(start, end + 1), error: null, count: rows().length }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
    };
    return builder;
  });
  return { supabase: { from, storage: { from: storageFrom } } as unknown as AuthenticatedTenantContext["supabase"], download, storageFrom, from };
}

async function pdfBytes() {
  const pdf = await PDFDocument.create();
  for (const width of [101, 202, 303]) pdf.addPage([width, 500]);
  return Buffer.from(await pdf.save());
}

describe("confirmed preparation reference contents", () => {
  it("passes a complete verified PDF unchanged and identifies its original pages", async () => {
    const bytes = await pdfBytes();
    const { document, source } = fixture(bytes);
    const db = database([document], bytes);
    const result = await loadPreparationReferenceFiles({ ...db, job, snapshot: snapshot([source]) });
    expect(result.files).toEqual([{ data: bytes.toString("base64"), mimeType: "application/pdf" }]);
    expect(result.sourceHints[0]).toContain(DOCUMENT_ID);
    expect(result.sourceHints[0]).toContain("1→1, 2→2, 3→3");
    expect(db.storageFrom).toHaveBeenCalledWith(AFFAIRE_INTAKE_BUCKET);
    expect(db.download).toHaveBeenCalledExactlyOnceWith(document.storage_path);
  });

  it("physically includes only selected PDF pages in their confirmed order", async () => {
    const bytes = await pdfBytes();
    const { document, source } = fixture(bytes);
    source.pages = [3, 1];
    const result = await loadPreparationReferenceFiles({ ...database([document], bytes), job, snapshot: snapshot([source]) });
    const selected = await PDFDocument.load(Buffer.from(result.files[0].data, "base64"));
    expect(selected.getPages().map((page) => page.getWidth())).toEqual([303, 101]);
    expect(result.sourceHints[0]).toContain("1→3, 2→1");
  });

  it("converts a semicolon CSV without losing quoted labels, accents or quantities", async () => {
    const csv = '\uFEFFRéférence;Quantité;Unité\n"Tube, Ø32";2031;ml\nRobinet;0;u';
    const bytes = Buffer.from(csv, "utf8");
    const { document, source } = fixture(bytes, { file_name: "DPGF.csv", mime_type: "text/csv", document_kind: "dpgf" });
    const result = await loadPreparationReferenceFiles({ ...database([document], bytes), job, snapshot: snapshot([source]) });
    const text = Buffer.from(result.files[0].data, "base64").toString("utf8");
    expect(result.files[0].mimeType).toBe("text/plain");
    expect(text).toContain("Référence,Quantité,Unité");
    expect(text).toContain('"Tube, Ø32",2031,ml');
    expect(text).toContain("Robinet,0,u");
  });

  it.each(["xls", "xlsx"] as const)("converts every %s sheet and retains values beyond an intake snippet", async (bookType) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Désignation", "Quantité"], ...Array.from({ length: 25 }, (_, index) => [`Tube ${index}`, index + 1]),
    ]), "Plomberie");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Vannes", 37.5]]), "Chauffage");
    const bytes = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType, compression: true }));
    const { document, source } = fixture(bytes, { file_name: `DPGF.${bookType}`, mime_type: null, document_kind: "dpgf" });
    const result = await loadPreparationReferenceFiles({ ...database([document], bytes), job, snapshot: snapshot([source]) });
    const text = Buffer.from(result.files[0].data, "base64").toString("utf8");
    expect(text).toContain('Feuille "Plomberie"');
    expect(text).toContain("Tube 24,25");
    expect(text).toContain('Feuille "Chauffage"');
    expect(text).toContain("Vannes,37.5");
  });

  it("decodes BOM-labelled UTF-16 text in full", async () => {
    const text = "Déductions : aucune.\nQuantité : 12,5 ml.";
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    const { document, source } = fixture(bytes, { file_name: "conventions.txt", mime_type: "text/plain" });
    const result = await loadPreparationReferenceFiles({ ...database([document], bytes), job, snapshot: snapshot([source]) });
    expect(Buffer.from(result.files[0].data, "base64").toString("utf8")).toBe(text);
  });

  it("preserves leading worksheet rows and columns so CSV coordinates match the source", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_aoa(sheet, [["Vannes", 12]], { origin: "C4" });
    XLSX.utils.book_append_sheet(workbook, sheet, "DPGF");
    const bytes = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
    const { document, source } = fixture(bytes, { file_name: "DPGF.xlsx", mime_type: null });
    const result = await loadPreparationReferenceFiles({ ...database([document], bytes), job, snapshot: snapshot([source]) });
    const csv = Buffer.from(result.files[0].data, "base64").toString("utf8").split("\n").slice(1);
    expect(csv).toEqual([",,,", ",,,", ",,,", ",,Vannes,12"]);
  });

  it.each(["tenant_id", "project_id", "updated_at", "storage_path", "document_kind", "deleted_at", "deletion_token", "upload_status"])("rejects a changed %s without loading a substitute", async (field) => {
    const bytes = await pdfBytes();
    const { document, source } = fixture(bytes);
    Object.assign(document, { [field]: "changed" });
    const db = database([document], bytes);
    await expect(loadPreparationReferenceFiles({ ...db, job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT, retryable: false });
    expect(db.download).not.toHaveBeenCalled();
  });

  it("does not replace a missing confirmed ID with a document of the same name", async () => {
    const bytes = await pdfBytes();
    const { document, source } = fixture(bytes);
    document.id = "77777777-7777-4777-8777-777777777777";
    const db = database([document], bytes);
    await expect(loadPreparationReferenceFiles({ ...db, job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT });
    expect(db.download).not.toHaveBeenCalled();
  });

  it("requires access to the job's estimate version before loading references", async () => {
    const bytes = await pdfBytes();
    const { document, source } = fixture(bytes);
    const db = database([document], bytes, { missingVersion: true });
    await expect(loadPreparationReferenceFiles({ ...db, job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT });
    expect(db.download).not.toHaveBeenCalled();
  });

  it("requires a confirmed content digest before downloading", async () => {
    const bytes = await pdfBytes();
    const { document, source } = fixture(bytes);
    source.content_hash = null;
    const db = database([document], bytes);
    await expect(loadPreparationReferenceFiles({ ...db, job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT });
    expect(db.download).not.toHaveBeenCalled();
  });

  it.each(["missing", "truncated", "same-size-changed"])("rejects %s confirmed bytes", async (failure) => {
    const bytes = await pdfBytes();
    const { document, source } = fixture(bytes);
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] ^= 1;
    const db = database([document], bytes, {
      missingFile: failure === "missing", downloadBytes: failure === "same-size-changed" ? changed : bytes,
      downloadSize: failure === "truncated" ? bytes.length - 1 : undefined,
    });
    await expect(loadPreparationReferenceFiles({ ...db, job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT, retryable: false });
  });

  it("rejects metadata revised while the confirmed file is downloading", async () => {
    const bytes = await pdfBytes();
    const { document, source } = fixture(bytes);
    const db = database([document], bytes, { onDownload: () => { document.updated_at = "2026-10-29T12:00:00Z"; } });
    await expect(loadPreparationReferenceFiles({ ...db, job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT });
  });

  it.each([
    { file_name: "CCTP.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID },
    { file_name: "CCTP.pdf", mime_type: "application/pdf", code: TakeoffErrorCode.TAKEOFF_PDF_CORRUPTED },
    { file_name: "DPGF.xlsx", mime_type: null, code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID },
    { file_name: "DPGF.xls", mime_type: null, code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID },
  ])("fails explicitly for unsupported or invalid $file_name contents", async ({ code, ...overrides }) => {
    const bytes = Buffer.from("not a valid document");
    const { document, source } = fixture(bytes, overrides);
    await expect(loadPreparationReferenceFiles({ ...database([document], bytes), job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code, retryable: false });
  });

  it("rejects an original PDF page that is outside the confirmed file", async () => {
    const bytes = await pdfBytes();
    const { document, source } = fixture(bytes);
    source.pages = [4];
    await expect(loadPreparationReferenceFiles({ ...database([document], bytes), job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT });
  });

  it("rejects over-budget metadata before downloading an oversized reference", async () => {
    const bytes = Buffer.from("text");
    const { document, source } = fixture(bytes, { size_bytes: 20 * 1024 * 1024 + 1 });
    const db = database([document], bytes);
    await expect(loadPreparationReferenceFiles({ ...db, job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE });
    expect(db.download).not.toHaveBeenCalled();
  });

  it("bounds the number of active references before any database or file reads", async () => {
    const bytes = Buffer.from("text");
    const sources = Array.from({ length: 21 }, (_, index) => fixture(bytes, {
      id: `reference-${index}`, file_name: `reference-${index}.txt`, mime_type: "text/plain",
    }).source);
    const db = database([], bytes);
    await expect(loadPreparationReferenceFiles({ ...db, job, snapshot: snapshot(sources) })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("bounds UTF-8 context bytes after text decoding expands the original encoding", async () => {
    const bytes = Buffer.alloc(11 * 1024 * 1024, 0xe9);
    const { document, source } = fixture(bytes, { file_name: "conventions.txt", mime_type: "text/plain; charset=windows-1252" });
    await expect(loadPreparationReferenceFiles({ ...database([document], bytes), job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE });
  });

  it("allows a retained page from a large PDF while rejecting its entire over-budget scope", async () => {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 201; index += 1) pdf.addPage([100 + index, 500]);
    const bytes = Buffer.from(await pdf.save());
    const { document, source } = fixture(bytes);
    source.pages = [201];
    const selected = await loadPreparationReferenceFiles({ ...database([document], bytes), job, snapshot: snapshot([source]) });
    expect((await PDFDocument.load(Buffer.from(selected.files[0].data, "base64"))).getPage(0).getWidth()).toBe(300);
    source.pages = [];
    await expect(loadPreparationReferenceFiles({ ...database([document], bytes), job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE });
  });

  it("bounds actual XLSX inflation even when the central directory understates it", async () => {
    const compressed = deflateRawSync(Buffer.alloc(32 * 1024 * 1024 + 1));
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(8, 8);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(1, 24);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(header.length + compressed.length, 16);
    const bytes = Buffer.concat([header, compressed, directory, end]);
    const { document, source } = fixture(bytes, { file_name: "DPGF.xlsx", mime_type: null });
    await expect(loadPreparationReferenceFiles({ ...database([document], bytes), job, snapshot: snapshot([source]) })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID, retryable: false });
  });
});
