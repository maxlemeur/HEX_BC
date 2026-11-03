import "server-only";

import { createHash } from "node:crypto";

import { getPdfPageCount } from "@/lib/takeoff/chunking";
import type { TakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import type { DownloadedTakeoffFile, TakeoffSourceDocumentRef } from "@/lib/takeoff/source-loader";
import { extractVectorPage, VectorExtractionError } from "@/lib/takeoff/vectors/extraction";
import {
  locationFromFileName,
  vectorItemRecords,
  vectorPageRecord,
  type VectorItemRecord,
  type VectorPageRecord,
} from "@/lib/takeoff/vectors/persistence";
import { readVectorPage } from "@/lib/takeoff/vectors/pipeline";
import type { PageCalibration } from "@/lib/takeoff/vectors/scale";

// The vector reading in the takeoff worker (TI-662), opt-in with
// MERGEONE_TAKEOFF_VECTORS=1 and level C only: each retained page of each
// original PDF (never the merged copy, which loses its layer names) is
// extracted in its killable process and read with keywords. Decisions is not
// called (TI-663 shares its helper; until then unclassified groups stay « à
// revoir »). A page calibration comes from the preparation's conventions when
// it names that page of that document: its plan file, or for a direct upload
// `upload:` and the SHA-256 of the original bytes read (never the snapshot's
// word for it). A page that fails or is raster gives no item; the level C
// reading of the same job is unchanged beside it (pipeline step 5), the rules
// of TI-664 decide between both. Any error of a page fails that page only,
// logged: the vector reading never fails the level C job it joins.

export const TAKEOFF_VECTOR_MAX_PAGES = 60;

export function isTakeoffVectorReadingEnabled() {
  return process.env.MERGEONE_TAKEOFF_VECTORS === "1";
}

export type VectorPageOutcome = {
  document: TakeoffSourceDocumentRef;
  fileName: string;
  page: number;
  record: VectorPageRecord | null;
  items: VectorItemRecord[];
  error: string | null;
};

/**
 * The preparation's identity of an original PDF: its plan file, or for a direct upload `upload:` and the SHA-256 of
 * the bytes read (TakeoffUploadForm), the identity the loader already held them to (assertPreparedUploadBytes).
 */
export function preparationDocumentId(document: TakeoffSourceDocumentRef, bytes: ArrayBuffer): string {
  return document.kind === "plan_file" ? document.plan_file_id : `upload:${createHash("sha256").update(Buffer.from(bytes)).digest("hex")}`;
}

/** conventions.calibration of a confirmed preparation, when complete and on this document's page (docs/metier/preparation-metre.md). */
export function preparationCalibration(snapshot: TakeoffPreparationSnapshot | undefined, documentId: string | null, page: number): PageCalibration | null {
  const conventions = snapshot?.preparation.conventions;
  const calibration = conventions?.calibration;
  if (!conventions || conventions.measurement_basis !== "calibrated" || !calibration) return null;
  if (documentId === null || calibration.document_id !== documentId || calibration.page !== page) return null;
  const { reference_length, reference_unit, measured_span, measured_span_unit } = calibration;
  if (!reference_length || !reference_unit || !measured_span || !measured_span_unit) return null;
  const metres = reference_length * (reference_unit === "m" ? 1 : reference_unit === "cm" ? 0.01 : 0.001);
  const sheetMm = measured_span_unit === "pdf_points" ? measured_span * (25.4 / 72) : measured_span;
  const denominator = (metres * 1000) / sheetMm;
  return Number.isFinite(denominator) && denominator > 0 ? { page, denominator, source: "conventions.calibration de la préparation" } : null;
}

export async function readTakeoffVectorPages(source: DownloadedTakeoffFile, options: {
  onPage?: () => Promise<void>;
  /** Identity of the job, for the log of a failed page. */
  context?: { jobId: string; tenantId: string };
} = {}): Promise<VectorPageOutcome[]> {
  const outcomes: VectorPageOutcome[] = [];
  for (const original of source.originalPdfSources ?? []) {
    const bytes = new Uint8Array(original.bytes);
    // Hashed once per file, and only when a preparation may name it.
    const documentId = source.preparationSnapshot ? preparationDocumentId(original.document, original.bytes) : null;
    const pages = original.pages.length ? original.pages : Array.from({ length: await getPdfPageCount(original.bytes) }, (_, index) => index + 1);
    const location = locationFromFileName(original.fileName);
    for (const page of pages) {
      if (outcomes.length >= TAKEOFF_VECTOR_MAX_PAGES) return outcomes;
      // The lease renewal is the job's own: its failure stops the job, as everywhere else.
      await options.onPage?.();
      try {
        const extraction = await extractVectorPage(bytes, page);
        const reading = readVectorPage(extraction, { calibration: preparationCalibration(source.preparationSnapshot, documentId, page) });
        outcomes.push({ document: original.document, fileName: original.fileName, page, record: vectorPageRecord(reading, location),
          items: vectorItemRecords(reading, location), error: null });
      } catch (error) {
        const reason = error instanceof VectorExtractionError ? error.reason : "reading_failed";
        const message = error instanceof Error ? error.message : String(error);
        console.error("takeoff.vector.page_failed", { job_id: options.context?.jobId ?? null, tenant_id: options.context?.tenantId ?? null,
          document: original.document, page, reason, message: message.slice(0, 500) });
        outcomes.push({ document: original.document, fileName: original.fileName, page, record: null, items: [], error: `${reason}: ${message}`.slice(0, 500) });
      }
    }
  }
  return outcomes;
}
