import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  inspectPlanSetResourceBudget,
  PLAN_SET_MAX_FILES,
  PLAN_SET_MAX_TOTAL_SIZE_BYTES,
} from "@/lib/takeoff/plans";

const ROOT = process.cwd();
const MIB = 1024 * 1024;

async function readProjectFile(path: string) {
  return readFile(join(ROOT, path), "utf8");
}

describe("plan-set aggregate resource budget", () => {
  it("accepts the exact file and byte boundary", () => {
    const budget = inspectPlanSetResourceBudget(
      Array.from({ length: PLAN_SET_MAX_FILES }, () => ({
        file_size_bytes:
          PLAN_SET_MAX_TOTAL_SIZE_BYTES / PLAN_SET_MAX_FILES,
        page_count: 1,
      })),
      { maxPages: PLAN_SET_MAX_FILES }
    );

    expect(budget).toMatchObject({
      fileCount: PLAN_SET_MAX_FILES,
      totalSizeBytes: PLAN_SET_MAX_TOTAL_SIZE_BYTES,
      knownPageCount: PLAN_SET_MAX_FILES,
      violation: null,
    });
  });

  it("rejects excess cardinality before considering later limits", () => {
    const budget = inspectPlanSetResourceBudget(
      Array.from({ length: PLAN_SET_MAX_FILES + 1 }, () => ({
        file_size_bytes: MIB,
        page_count: 1,
      }))
    );

    expect(budget.violation).toBe("file_count");
  });

  it("rejects aggregate bytes even when every file is individually valid", () => {
    const budget = inspectPlanSetResourceBudget([
      { file_size_bytes: 40 * MIB, page_count: 1 },
      { file_size_bytes: 40 * MIB, page_count: 1 },
      { file_size_bytes: 40 * MIB, page_count: 1 },
    ]);

    expect(budget.violation).toBe("total_size");
  });

  it("rejects a known aggregate page count above the processing limit", () => {
    const budget = inspectPlanSetResourceBudget(
      [
        { file_size_bytes: MIB, page_count: 6 },
        { file_size_bytes: MIB, page_count: 5 },
      ],
      { maxPages: 10 }
    );

    expect(budget).toMatchObject({
      knownPageCount: 11,
      violation: "total_pages",
    });
  });

  it("preserves a legitimate multi-file set with incomplete page metadata", () => {
    const budget = inspectPlanSetResourceBudget(
      [
        { file_size_bytes: 2 * MIB, page_count: 4 },
        { file_size_bytes: 3 * MIB, page_count: null },
      ],
      { maxPages: 10 }
    );

    expect(budget).toMatchObject({
      fileCount: 2,
      totalSizeBytes: 5 * MIB,
      knownPageCount: 4,
      unknownPageCount: 1,
      violation: null,
    });
  });

  it("checks current metadata before job creation or Storage download", async () => {
    const [serverSource, processorSource] = await Promise.all([
      readProjectFile("src/lib/takeoff/server.ts"),
      readProjectFile("src/lib/takeoff/processor.ts"),
    ]);

    const serverFunction = serverSource.indexOf(
      "async function resolvePlanSetSourceFile"
    );
    const serverBudget = serverSource.indexOf(
      "inspectPlanSetResourceBudget(planFiles",
      serverFunction
    );
    const jobInsert = serverSource.indexOf(
      '.from("takeoff_jobs" as never)',
      serverBudget
    );
    expect(serverFunction).toBeGreaterThanOrEqual(0);
    expect(serverBudget).toBeGreaterThan(serverFunction);
    expect(jobInsert).toBeGreaterThan(serverBudget);

    const processorFunction = processorSource.indexOf(
      "async function downloadTakeoffSourceFile"
    );
    const metadataBudget = processorSource.indexOf(
      "const metadataBudget = inspectPlanSetResourceBudget",
      processorFunction
    );
    const firstDownload = processorSource.indexOf(
      ".download(sourcePath)",
      metadataBudget
    );
    expect(processorFunction).toBeGreaterThanOrEqual(0);
    expect(metadataBudget).toBeGreaterThan(processorFunction);
    expect(firstDownload).toBeGreaterThan(metadataBudget);
  });

  it("checks actual aggregate pages before allocating the merged PDF", async () => {
    const processorSource = await readProjectFile(
      "src/lib/takeoff/processor.ts"
    );
    const processorFunction = processorSource.indexOf(
      "async function downloadTakeoffSourceFile"
    );
    const actualPageCount = processorSource.indexOf(
      "actualBudgetEntry.page_count = sourcePdf.getPageCount()",
      processorFunction
    );
    const blobSizeCheck = processorSource.indexOf(
      "file_size_bytes: data.size",
      processorFunction
    );
    const byteLengthCheck = processorSource.indexOf(
      "actualBudgetEntry.file_size_bytes = sourceBytes.byteLength",
      processorFunction
    );
    const mergedPdfAllocation = processorSource.indexOf(
      "const mergedPdf = await PDFDocument.create()",
      processorFunction
    );

    expect(blobSizeCheck).toBeGreaterThan(processorFunction);
    expect(byteLengthCheck).toBeGreaterThan(blobSizeCheck);
    expect(actualPageCount).toBeGreaterThan(processorFunction);
    expect(mergedPdfAllocation).toBeGreaterThan(actualPageCount);
  });

  it("persists per-source page counts instead of the merged total", async () => {
    const processorSource = await readProjectFile(
      "src/lib/takeoff/processor.ts"
    );

    expect(processorSource).toContain(
      "sourcePlanFilePageCounts: validatedSources.map"
    );
    expect(processorSource).toContain(
      "const sourcePageCounts = input.sourceFile.sourcePlanFilePageCounts"
    );
    expect(processorSource).toContain("sourceFilePath: source.filePath");
    expect(processorSource).toContain("pageCount: source.pageCount");
  });

  it("serializes direct and concurrent plan-file writes in PostgreSQL", async () => {
    const migration = await readProjectFile(
      "supabase/migrations/20260713150322_enforce_plan_set_resource_budgets.sql"
    );

    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(migration).toMatch(/language plpgsql\r?\nsecurity definer\r?\nset search_path = ''/);
    expect(migration).toContain(
      "revoke all on function public.enforce_plan_set_resource_budget()"
    );
    expect(migration).toContain("new.plan_set_id::text");
    expect(migration).toContain("pg_catalog.count(*)");
    expect(migration).toContain("pg_catalog.sum(pf.file_size_bytes)");
    expect(migration).toContain("v_existing_file_count + 1 > 20");
    expect(migration).toContain(
      "v_existing_total_size_bytes + new.file_size_bytes > 104857600"
    );
    expect(migration).toContain("new.file_size_bytes > 52428800");
    expect(migration).toContain(
      "before insert or update of plan_set_id, file_size_bytes"
    );
  });
});
