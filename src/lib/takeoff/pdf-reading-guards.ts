import {
  TakeoffError,
  TakeoffErrorCode,
} from "@/lib/takeoff/errors";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { buildTakeoffPdfNotInterpretableMessage } from "@/lib/takeoff/pdf-validation";
import type { DownloadedTakeoffFile } from "@/lib/takeoff/source-loader";

export function isPdfMimeType(mimeType: string) {
  const mediaType = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/pdf";
}

export function assertPdfResultIsInterpretable(input: {
  job: TakeoffJobProcessingRow;
  level: "B" | "C";
  sourceFile: DownloadedTakeoffFile;
  tablesCount: number;
  itemsCount: number;
  hasUnmeasuredQuantities?: boolean;
  providerMeta?: Record<string, unknown>;
}) {
  const isInterpretable =
    input.level === "C"
      ? input.itemsCount > 0 || (input.sourceFile.preparationSnapshot?.preparation.objective === "measure_all" && input.hasUnmeasuredQuantities === true)
      : input.tablesCount > 0 && input.itemsCount > 0;

  if (isInterpretable) {
    return;
  }

  throw new TakeoffError({
    code: TakeoffErrorCode.TAKEOFF_PDF_NOT_INTERPRETABLE,
    message: buildTakeoffPdfNotInterpretableMessage(input.level),
    retryable: false,
    jobId: input.job.id,
    level: input.level,
    details: {
      source_file_name: input.sourceFile.fileName,
      tables_count: input.tablesCount,
      items_count: input.itemsCount,
      provider_meta: input.providerMeta ?? null,
    },
  });
}
