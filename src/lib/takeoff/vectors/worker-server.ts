import "server-only";

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
// it names that page. A page that fails or is raster gives no item; the level
// C reading of the same job is unchanged beside it (pipeline step 5), the
// rules of TI-664 decide between both.

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

/** conventions.calibration of a confirmed preparation, when complete and on this document's page (docs/metier/preparation-metre.md). */
export function preparationCalibration(snapshot: TakeoffPreparationSnapshot | undefined, document: TakeoffSourceDocumentRef, page: number): PageCalibration | null {
  const conventions = snapshot?.preparation.conventions;
  const calibration = conventions?.calibration;
  if (!conventions || conventions.measurement_basis !== "calibrated" || !calibration) return null;
  const id = document.kind === "plan_file" ? document.plan_file_id : null;
  if (id === null || calibration.document_id !== id || calibration.page !== page) return null;
  const { reference_length, reference_unit, measured_span, measured_span_unit } = calibration;
  if (!reference_length || !reference_unit || !measured_span || !measured_span_unit) return null;
  const metres = reference_length * (reference_unit === "m" ? 1 : reference_unit === "cm" ? 0.01 : 0.001);
  const sheetMm = measured_span_unit === "pdf_points" ? measured_span * (25.4 / 72) : measured_span;
  const denominator = (metres * 1000) / sheetMm;
  return Number.isFinite(denominator) && denominator > 0 ? { page, denominator, source: "conventions.calibration de la préparation" } : null;
}

export async function readTakeoffVectorPages(source: DownloadedTakeoffFile, options: { onPage?: () => Promise<void> } = {}): Promise<VectorPageOutcome[]> {
  const outcomes: VectorPageOutcome[] = [];
  for (const original of source.originalPdfSources ?? []) {
    const bytes = new Uint8Array(original.bytes);
    const pages = original.pages.length ? original.pages : Array.from({ length: await getPdfPageCount(original.bytes) }, (_, index) => index + 1);
    const location = locationFromFileName(original.fileName);
    for (const page of pages) {
      if (outcomes.length >= TAKEOFF_VECTOR_MAX_PAGES) return outcomes;
      await options.onPage?.();
      try {
        const extraction = await extractVectorPage(bytes, page);
        const reading = readVectorPage(extraction, { calibration: preparationCalibration(source.preparationSnapshot, original.document, page) });
        outcomes.push({ document: original.document, fileName: original.fileName, page, record: vectorPageRecord(reading, location),
          items: vectorItemRecords(reading, location), error: null });
      } catch (error) {
        if (!(error instanceof VectorExtractionError)) throw error;
        outcomes.push({ document: original.document, fileName: original.fileName, page, record: null, items: [], error: error.message });
      }
    }
  }
  return outcomes;
}
