import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
import { findPlanRevisionConflicts, inferPlanLogicalReference, readPlanTitleBlock } from "@/lib/takeoff/plan-revision-identity";

function plan(id: string, name: string, title?: string) {
  return { document_id: id, document_name: `${name}.pdf`, logical_document_id: null,
    content_hash: id.repeat(64), plan_identity: title ? readPlanTitleBlock(title) : null };
}

describe("plan revisions", () => {
  it("does not assert shared identity for an isolated plan with a generic filename", () => {
    expect(inferPlanLogicalReference(plan("a", "Plan"))).toBeNull();
    expect(inferPlanLogicalReference(plan("a", "Plan", "N° de plan : P-101\nBâtiment : A"))).toBe("plan:p-101:a");
  });
  it("matches filename variants without treating a date as a revision", () => {
    const left = plan("a", "Évacuation RDC - Indice A - 2026-10-03");
    const right = plan("b", "evacuation_rdc_2026-11-04_rev-B");
    expect(findPlanRevisionConflicts([left, right], [])).toEqual([[left, right]]);
    expect(readPlanTitleBlock("")).toBeNull();
    expect(findPlanRevisionConflicts([left], [])).toEqual([]);
  });

  it("reads explicit plan references and distinguishes identical names on different buildings", () => {
    const left = plan("a", "Plan RDC", "N° de plan : P-101\nBâtiment : A\nIndice : A");
    const right = plan("b", "Plan RDC", "N° de plan : P-101\nBâtiment : B\nIndice : B");
    const next = plan("c", "Nom différent", "N° de plan : P-101\nBâtiment : A\nIndice : B");
    expect(findPlanRevisionConflicts([left, right, next], [])).toEqual([[left, next]]);
  });

  it("leaves the index unknown for an isolated raster plan with no embedded text", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 400]);
    const png = await pdf.embedPng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAW9JTswAAAABJRU5ErkJggg==", "base64"));
    page.drawImage(png, { x: 0, y: 0, width: 600, height: 400 });
    const read = await renderPdfPages(await pdf.save(), { pages: [1], image: null,
      textRegion: { x0: 0.8, y0: 0.8, x1: 1, y1: 1, maxChars: 2000 } });
    expect(read.status).toBe("complete");
    const identity = readPlanTitleBlock(read.pages[0].regionText ?? "");
    expect(identity).toBeNull();
    expect(findPlanRevisionConflicts([{ ...plan("a", "Plan raster"), plan_identity: identity }], [])).toEqual([]);
  });

  it("does not read a finish description as a revision label", () => {
    expect(readPlanTitleBlock("Revêtement de sol")).toBeNull();
    expect(readPlanTitleBlock("Révision : B")?.revision).toBe("B");
  });

  it("flags suffixed drawing numbers without a readable title block", () => {
    const left = plan("a", "P-101_A");
    const right = plan("b", "P-101_B");
    expect(findPlanRevisionConflicts([left, right], [])).toEqual([[left, right]]);
    for (const [a, b] of [["P-101 A", "P-101 B"], ["P101_A", "P101-B"], ["CVC 2.04-A", "CVC 2.04-C"]]) {
      expect(findPlanRevisionConflicts([plan("a", a), plan("b", b)], [])).toHaveLength(1);
    }
    expect(findPlanRevisionConflicts([plan("a", "P-101_A"), plan("b", "P-102_A")], [])).toEqual([]);
    expect(findPlanRevisionConflicts([plan("a", "Plan RDC A"), plan("b", "Plan RDC B")], [])).toEqual([]);
  });

  it("groups identical bytes and invalidates decisions when bytes change", () => {
    const left = plan("a", "Plan RDC rev A");
    const right = plan("b", "Plan RDC rev B");
    const decision = { left: { document_id: "a", content_hash: left.content_hash },
      right: { document_id: "b", content_hash: right.content_hash }, choice: "distinct" as const };
    expect(findPlanRevisionConflicts([left, { ...right, content_hash: left.content_hash }], [])).toEqual([]);
    expect(findPlanRevisionConflicts([left, right], [decision])).toEqual([]);
    const changed = { ...right, content_hash: "c".repeat(64) };
    expect(findPlanRevisionConflicts([left, changed], [decision])).toEqual([[left, changed]]);
  });
});
