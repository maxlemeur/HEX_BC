import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createTakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";
import { loadPreparedPlanSource, parsePreparationSnapshot, assertPreparedUploadBytes } from "@/lib/takeoff/preparation-source-loader";
import { toPreparationPlanSource, type PreparationPlanFile } from "@/lib/takeoff/preparation-sources";
import { parseTakeoffJobRow } from "@/lib/takeoff/job-lifecycle";
import { createSupabaseFake, filterValue, takeoffJobRow, M3_PLAN_SET_ID, M3_TENANT_ID, M3_USER_ID } from "@/lib/takeoff/metre-m3.test-utils";

const FILE_ID = "77777777-7777-4777-8777-777777777777";
const digest = (bytes: Uint8Array | ArrayBuffer) => createHash("sha256").update(Buffer.from(bytes as Uint8Array)).digest("hex");

async function fixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 100]);
  pdf.addPage([200, 200]);
  pdf.addPage([300, 300]);
  const bytes = await pdf.save();
  const file: PreparationPlanFile = {
    id: FILE_ID, plan_set_id: M3_PLAN_SET_ID, file_path: `${M3_TENANT_ID}/plan.pdf`,
    file_name: "Plan fictif R+1.pdf", file_size_bytes: bytes.byteLength,
    file_hash: null, page_count: 3, updated_at: "2026-10-29T00:00:00.000Z", metadata: { revision: "A" },
  };
  const source = { ...toPreparationPlanSource(file), active: true, confirmed: true, pages: [2], content_hash: digest(bytes) };
  const prep = confirmedPreparationFixture().preparation;
  prep.objective = "count";
  prep.sources = [source];
  const snapshot = createTakeoffPreparationSnapshot({ preparation: prep, revision: 2, confirmedAt: "2026-10-29T00:01:00.000Z", confirmedBy: M3_USER_ID });
  const job = parseTakeoffJobRow(takeoffJobRow({ plan_set_id: M3_PLAN_SET_ID, preparation_snapshot: snapshot }));
  const fake = createSupabaseFake({
    tables: { plan_files: (query) => {
      const rows = [file].filter((row) => (filterValue(query, "id") as string[]).includes(row.id));
      return { data: rows, error: null, count: rows.length };
    } },
    storage: { "plan-files": () => ({ data: new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }), error: null }) },
  });
  return { file, bytes, source, snapshot, job, fake };
}

describe("confirmed preparation source loading", () => {
  it("physically copies only selected pages and retains the original page and document", async () => {
    const f = await fixture();
    const loaded = await loadPreparedPlanSource({ supabase: f.fake.client as never, job: f.job, snapshot: f.snapshot, maxPages: 50 });
    const actual = await PDFDocument.load(loaded.bytes);
    expect(actual.getPageCount()).toBe(1);
    expect(actual.getPage(0).getWidth()).toBe(200);
    expect(loaded.sourcePageNumbersByPage).toEqual([2]);
    expect(loaded.sourceDocumentsByPage).toEqual([{ kind: "plan_file", plan_file_id: FILE_ID }]);
    expect(loaded.sourcePlanFilePageCounts).toEqual([{ filePath: f.file.file_path, pageCount: 3 }]);
    expect(filterValue(f.fake.queries[0], "tenant_id")).toBe(M3_TENANT_ID);
    expect(filterValue(f.fake.queries[0], "id")).toEqual([FILE_ID]);
  });

  it("rejects a source metadata revision before downloading or calling a provider", async () => {
    const f = await fixture();
    f.file.updated_at = "2026-10-29T01:00:00.000Z";
    await expect(loadPreparedPlanSource({ supabase: f.fake.client as never, job: f.job, snapshot: f.snapshot, maxPages: 50 }))
      .rejects.toMatchObject({ status: 409, retryable: false, details: { reason: "PREPARATION_SOURCE_CHANGED" } });
    expect(f.fake.storageCalls).toEqual([]);
  });

  it("detects changed bytes even when path, size, timestamps and a caller hash stay the same", async () => {
    const f = await fixture();
    f.snapshot.preparation.sources[0].content_hash = "0".repeat(64);
    await expect(loadPreparedPlanSource({ supabase: f.fake.client as never, job: f.job, snapshot: f.snapshot, maxPages: 50 }))
      .rejects.toMatchObject({ status: 409, details: { reason: "PREPARATION_SOURCE_CHANGED" } });
  });

  it("rejects a disappeared source and a selected page that does not exist", async () => {
    const f = await fixture();
    f.source.document_id = "88888888-8888-4888-8888-888888888888";
    f.snapshot.preparation.sources[0].document_id = f.source.document_id;
    await expect(loadPreparedPlanSource({ supabase: f.fake.client as never, job: f.job, snapshot: f.snapshot, maxPages: 50 }))
      .rejects.toMatchObject({ status: 409 });
    f.snapshot.preparation.sources[0].document_id = FILE_ID;
    f.snapshot.preparation.sources[0].pages = [4];
    await expect(loadPreparedPlanSource({ supabase: f.fake.client as never, job: f.job, snapshot: f.snapshot, maxPages: 50 }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("retains legacy null snapshots while malformed or incomplete new snapshots fail closed", () => {
    expect(parsePreparationSnapshot(null)).toBeNull();
    expect(parsePreparationSnapshot(undefined)).toBeNull();
    const snapshot = confirmedPreparationFixture();
    snapshot.preparation.conventions.confirmed = false;
    expect(() => parsePreparationSnapshot(snapshot)).toThrow();
  });

  it("binds uploaded bytes to the confirmed content identity", async () => {
    const f = await fixture();
    f.snapshot.preparation.sources = [{ ...f.source, document_id: `upload:${digest(f.bytes)}`, plan_set_id: null, file_path: null }];
    expect(() => assertPreparedUploadBytes(f.job, f.snapshot, Uint8Array.from(f.bytes).buffer)).not.toThrow();
    expect(() => assertPreparedUploadBytes(f.job, f.snapshot, new ArrayBuffer(4))).toThrow();
  });
});
