import { describe, expect, it } from "vitest";

import {
  DEFAULT_TAX_RATE_BP,
  LOW_MARGIN_THRESHOLD_BP,
} from "@/lib/estimates/constants";
import {
  DEVIS_BUCKET,
  ESTIMATE_DOCUMENTS_BUCKET,
  PLAN_FILES_BUCKET,
} from "@/lib/storage/buckets";

describe("estimate and storage constants", () => {
  it("keeps the default VAT rate at 2000 basis points", () => {
    expect(DEFAULT_TAX_RATE_BP).toBe(2000);
    expect(LOW_MARGIN_THRESHOLD_BP).toBe(1000);
  });

  it("exposes non-empty storage bucket names", () => {
    expect(ESTIMATE_DOCUMENTS_BUCKET).toBe("estimate-documents");
    expect(PLAN_FILES_BUCKET).toBe("plan-files");
    expect(DEVIS_BUCKET).toBe("devis");
    expect(ESTIMATE_DOCUMENTS_BUCKET.length).toBeGreaterThan(0);
    expect(PLAN_FILES_BUCKET.length).toBeGreaterThan(0);
    expect(DEVIS_BUCKET.length).toBeGreaterThan(0);
  });
});
