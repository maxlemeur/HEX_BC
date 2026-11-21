import { describe, expect, it } from "vitest";

import {
  normalizePlanLocationValue,
  readPlanLocation,
  resolvePlanLocation,
  type PlanLocationAnnotationValues,
} from "@/lib/takeoff/plan-location";

const titleBlock = (page: number, text: string | null) => ({ page, titleBlockText: text });

describe("reading the building and the level of a plan", () => {
  it("proposes the title block and keeps a free level label as written, never as the RDC", () => {
    const reading = readPlanLocation({ documentName: "P-101 plomberie.pdf", pageCount: 1,
      pages: [titleBlock(1, "MAÎTRE D'OUVRAGE FICTIF\nBÂTIMENT A\nNIVEAU L00\nINDICE B")] });
    const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
    expect(location.building).toMatchObject({ value: "A", state: "proposed", origin: "title_block", pages: [1] });
    expect(location.level).toMatchObject({ value: "L00", state: "proposed", origin: "title_block", pages: [1] });
  });

  it("prefers the title block to a contradicting file name and keeps the contradiction visible", () => {
    const reading = readPlanLocation({ documentName: "BAT-B_R+1_plomberie.pdf", pageCount: 1,
      pages: [titleBlock(1, "Bâtiment : A Niveau : L00")] });
    const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
    expect(location.building).toMatchObject({ value: "A", state: "proposed", origin: "title_block" });
    expect(location.building.candidates).toEqual([
      { value: "A", source: "title_block", pages: [1] },
      { value: "B", source: "file_name", pages: [] },
    ]);
    expect(location.level.candidates).toEqual([
      { value: "L00", source: "title_block", pages: [1] },
      { value: "R+1", source: "file_name", pages: [] },
    ]);
  });

  it("says « several levels » for a PDF whose sheets show different levels, each page keeping its own", () => {
    const reading = readPlanLocation({ documentName: "plomberie-etages.pdf", pageCount: 2,
      pages: [titleBlock(1, "BÂTIMENT A NIVEAU R+1"), titleBlock(2, "BÂTIMENT A NIVEAU R+2")] });
    const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
    expect(location.building).toMatchObject({ value: "A", state: "proposed", pages: [1, 2] });
    expect(location.level).toMatchObject({ value: null, state: "multiple", origin: null });
    expect(location.level.candidates).toEqual([
      { value: "R+1", source: "title_block", pages: [1] },
      { value: "R+2", source: "title_block", pages: [2] },
    ]);
  });

  it("says « several levels » for one sheet that names several", () => {
    const reading = readPlanLocation({ documentName: "coupe.pdf", pageCount: 1, pages: [titleBlock(1, "NIVEAUX : R+1 et R+2")] });
    expect(resolvePlanLocation({ reading, annotation: null, carryOver: null }).level.state).toBe("multiple");
  });

  it("leaves both fields « À préciser » for a plan without text and a neutral name", () => {
    const reading = readPlanLocation({ documentName: "plan-sans-texte.pdf", pageCount: 1, pages: [titleBlock(1, "")] });
    const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
    expect(location.building).toEqual({ value: null, state: "unknown", origin: null, pages: [], candidates: [] });
    expect(location.level).toEqual({ value: null, state: "unknown", origin: null, pages: [], candidates: [] });
    expect(reading.unreadable_pages).toEqual([1]);
  });

  it("reads the usual level spellings of a title block", () => {
    const level = (text: string) => resolvePlanLocation({
      reading: readPlanLocation({ documentName: "plan.pdf", pageCount: 1, pages: [titleBlock(1, text)] }),
      annotation: null, carryOver: null }).level.value;
    expect(level("PLAN DU REZ DE CHAUSSÉE")).toBe("RDC");
    expect(level("Niveau : SS1")).toBe("SS1");
    expect(level("Sous-sol 2")).toBe("SS2");
    expect(level("ÉTAGE R+3")).toBe("R+3");
    expect(level("NIVEAU GANTRY")).toBe("GANTRY");
  });

  it("uses an unambiguous file name only when the title block says nothing", () => {
    const reading = readPlanLocation({ documentName: "P-101_BAT-C_RDC.pdf", pageCount: 1, pages: [titleBlock(1, null)] });
    const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
    expect(location.building).toMatchObject({ value: "C", state: "proposed", origin: "file_name" });
    expect(location.level).toMatchObject({ value: "RDC", state: "proposed", origin: "file_name" });
    const several = readPlanLocation({ documentName: "reseaux_R+1_R+2.pdf", pageCount: 1, pages: [titleBlock(1, null)] });
    expect(resolvePlanLocation({ reading: several, annotation: null, carryOver: null }).level.state).toBe("multiple");
  });

  it("does not read a building or a level in ordinary words of a name", () => {
    const reading = readPlanLocation({ documentName: "batterie-surpresseur_niveau-haut.pdf", pageCount: 1, pages: [titleBlock(1, null)] });
    const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
    expect([location.building.state, location.level.state]).toEqual(["unknown", "unknown"]);
  });

  it("records which pages were read and which were not", () => {
    const reading = readPlanLocation({ documentName: "long.pdf", pageCount: 30, pages: [titleBlock(1, "NIVEAU R+1"), titleBlock(2, null)] });
    expect([reading.pages_total, reading.pages_read, reading.unreadable_pages]).toEqual([30, [1, 2], [2]]);
  });
});

describe("the correction of a revision", () => {
  const reading = readPlanLocation({ documentName: "BAT-B_R+1.pdf", pageCount: 1, pages: [titleBlock(1, "BÂTIMENT A NIVEAU L00")] });
  const annotation = (values: Partial<PlanLocationAnnotationValues>): PlanLocationAnnotationValues =>
    ({ building: "A", level: "L00", ...values });

  it("is confirmed when it keeps the proposal and corrected when it changes it", () => {
    const location = resolvePlanLocation({ reading, annotation: annotation({ level: "R+1" }), carryOver: null });
    expect(location.building).toMatchObject({ value: "A", state: "confirmed", origin: "operator" });
    expect(location.level).toMatchObject({ value: "R+1", state: "corrected", origin: "operator" });
  });

  it("can leave a field « À préciser » on purpose, which the reading no longer fills", () => {
    const location = resolvePlanLocation({ reading, annotation: annotation({ level: null }), carryOver: null });
    expect(location.level).toMatchObject({ value: null, state: "unknown", origin: "operator" });
  });

  it("stands without a reading, for bytes that can no longer be read", () => {
    expect(resolvePlanLocation({ reading: null, annotation: annotation({}), carryOver: null }).building)
      .toMatchObject({ value: "A", state: "corrected", origin: "operator" });
  });

  it("of an earlier revision is only a proposal to check on other bytes, the new reading staying visible", () => {
    const next = readPlanLocation({ documentName: "P-101_B.pdf", pageCount: 1, pages: [titleBlock(1, "BÂTIMENT A NIVEAU R+2")] });
    const location = resolvePlanLocation({ reading: next, annotation: null, carryOver: annotation({ level: "L00" }) });
    expect(location.level).toMatchObject({ value: "L00", state: "proposed", origin: "previous_revision" });
    expect(location.level.candidates).toEqual([{ value: "R+2", source: "title_block", pages: [1] }]);
    // A field the earlier correction left « À préciser » falls back to the reading of these bytes.
    expect(resolvePlanLocation({ reading: next, annotation: null, carryOver: annotation({ building: null }) }).building)
      .toMatchObject({ value: "A", state: "proposed", origin: "title_block" });
  });

  it("of this revision makes an earlier one irrelevant", () => {
    const location = resolvePlanLocation({ reading, annotation: annotation({ level: "R+1" }), carryOver: annotation({ level: "L01" }) });
    expect(location.level).toMatchObject({ value: "R+1", origin: "operator" });
  });
});

describe("the values an operator types", () => {
  it("are trimmed, spaces collapsed, an empty value meaning « À préciser »", () => {
    expect(normalizePlanLocationValue("  Bâtiment   Nord ")).toBe("Bâtiment Nord");
    expect(normalizePlanLocationValue("   ")).toBeNull();
    expect(normalizePlanLocationValue("L00")).toBe("L00");
    expect(() => normalizePlanLocationValue("A".repeat(41))).toThrow();
    expect(() => normalizePlanLocationValue("R+1\u0007")).toThrow();
  });
});
