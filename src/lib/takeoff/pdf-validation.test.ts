import { describe, expect, it } from "vitest";

import {
  resolveTakeoffPdfMimeType,
  validateTakeoffPdfUploadMetadata,
} from "@/lib/takeoff/pdf-validation";

describe("pdf-validation", () => {
  it("accepts application/pdf with MIME parameters", () => {
    expect(
      resolveTakeoffPdfMimeType({
        fileName: "plan.pdf",
        mimeType: "application/pdf; charset=utf-8",
      })
    ).toBe("application/pdf");
  });

  it("keeps upload metadata validation aligned with processor MIME handling", () => {
    expect(
      validateTakeoffPdfUploadMetadata({
        fileName: "plan.pdf",
        mimeType: "application/pdf; charset=utf-8",
        fileSizeBytes: 1024,
        maxFileSizeBytes: 10_000,
        maxFileSizeLabel: "10 Ko",
      })
    ).toEqual({
      valid: true,
      normalizedMimeType: "application/pdf",
    });
  });
});
