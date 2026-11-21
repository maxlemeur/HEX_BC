import { describe, expect, it } from "vitest";

import {
  normalizePlanLocationValue,
  planLocationCarriedFields,
  readPlanLocation,
  resolvePlanLocation,
  selectPlanLocationCarryOver,
  type PlanLocationAnnotationValues,
  type PlanLocationFieldChoice,
} from "@/lib/takeoff/plan-location";

const titleBlock = (page: number, text: string | null) => ({ page, titleBlockText: text });

describe("reading the building and the level of a plan", () => {
  it("proposes the title block and keeps a free level label as written, never as the RDC", () => {
    const reading = readPlanLocation({ originalName: "P-101 plomberie.pdf", pageCount: 1,
      pages: [titleBlock(1, "MAÎTRE D'OUVRAGE FICTIF\nBÂTIMENT A\nNIVEAU L00\nINDICE B")] });
    const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
    expect(location.building).toMatchObject({ value: "A", state: "proposed", origin: "title_block", pages: [1] });
    expect(location.level).toMatchObject({ value: "L00", state: "proposed", origin: "title_block", pages: [1] });
  });

  it("prefers the title block to a contradicting file name and keeps the contradiction visible", () => {
    const reading = readPlanLocation({ originalName: "BAT-B_R+1_plomberie.pdf", pageCount: 1,
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
    const reading = readPlanLocation({ originalName: "plomberie-etages.pdf", pageCount: 2,
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
    const reading = readPlanLocation({ originalName: "coupe.pdf", pageCount: 1, pages: [titleBlock(1, "NIVEAUX : R+1 et R+2")] });
    expect(resolvePlanLocation({ reading, annotation: null, carryOver: null }).level.state).toBe("multiple");
  });

  it("leaves both fields « À préciser » for a plan without text and a neutral name, its title block unread", () => {
    const reading = readPlanLocation({ originalName: "plan-sans-texte.pdf", pageCount: 1, pages: [titleBlock(1, "")] });
    const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
    expect(location.building).toEqual({ value: null, state: "unknown", origin: null, pages: [], candidates: [], title_block_read: false });
    expect(location.level).toEqual({ value: null, state: "unknown", origin: null, pages: [], candidates: [], title_block_read: false });
    expect(reading.unreadable_pages).toEqual([1]);
  });

  it("reads the usual level spellings of a title block", () => {
    const level = (text: string) => resolvePlanLocation({
      reading: readPlanLocation({ originalName: "plan.pdf", pageCount: 1, pages: [titleBlock(1, text)] }),
      annotation: null, carryOver: null }).level.value;
    expect(level("PLAN DU REZ DE CHAUSSÉE")).toBe("RDC");
    expect(level("Niveau : SS1")).toBe("SS1");
    expect(level("Sous-sol 2")).toBe("SS2");
    expect(level("ÉTAGE R+3")).toBe("R+3");
    expect(level("NIVEAU GANTRY")).toBe("GANTRY");
  });

  // The counterexample: a title block read with text but no level lets a known original name speak.
  it("uses an unambiguous original file name only when the title block was read and names neither field", () => {
    const silent = titleBlock(1, "PLAN DE PLOMBERIE FICTIF");
    const reading = readPlanLocation({ originalName: "P-101_BAT-C_RDC.pdf", pageCount: 1, pages: [silent] });
    const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
    expect(location.building).toMatchObject({ value: "C", state: "proposed", origin: "file_name" });
    expect(location.level).toMatchObject({ value: "RDC", state: "proposed", origin: "file_name" });
    const several = readPlanLocation({ originalName: "reseaux_R+1_R+2.pdf", pageCount: 1, pages: [silent] });
    expect(resolvePlanLocation({ reading: several, annotation: null, carryOver: null }).level.state).toBe("multiple");
  });

  it("never proposes the file name in place of a title block that was not read", () => {
    for (const pages of [[titleBlock(1, null)], []]) {
      const reading = readPlanLocation({ originalName: "BAT-B_R+1.pdf", pageCount: 1, pages });
      const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
      expect(reading.title_block_read).toBe(false);
      expect(location.building).toEqual({ value: null, state: "unknown", origin: null, pages: [], title_block_read: false,
        candidates: [{ value: "B", source: "file_name", pages: [] }] });
      expect(location.level).toMatchObject({ value: null, state: "unknown", title_block_read: false });
    }
  });

  // Written before the fix: a scan with no text in its title block counted as a title block read and got
  // the file name's values; a sanitized Storage name (« Plan R+1.pdf » stored as « Plan-R-1.pdf ») gave R-1.
  it("never takes the file name's values for a scan whose title block has no text", () => {
    const reading = readPlanLocation({ originalName: "BAT-B_R+1.pdf", pageCount: 1, pages: [titleBlock(1, "")] });
    const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
    expect(reading.title_block_read).toBe(false);
    expect([location.building.state, location.level.state]).toEqual(["unknown", "unknown"]);
    expect(location.level.candidates).toEqual([{ value: "R+1", source: "file_name", pages: [] }]);
  });

  it("reads no level in a Storage name when the original name is unknown", () => {
    const reading = readPlanLocation({ originalName: null, pageCount: 1, pages: [titleBlock(1, "PLAN DE PLOMBERIE FICTIF")] });
    expect([reading.title_block_read, reading.building, reading.level]).toEqual([true, [], []]);
  });

  it("does not read a building or a level in ordinary words of a name", () => {
    const reading = readPlanLocation({ originalName: "batterie-surpresseur_niveau-haut.pdf", pageCount: 1, pages: [titleBlock(1, null)] });
    const location = resolvePlanLocation({ reading, annotation: null, carryOver: null });
    expect([location.building.state, location.level.state]).toEqual(["unknown", "unknown"]);
  });

  it("records which pages were read and which were not", () => {
    const reading = readPlanLocation({ originalName: "long.pdf", pageCount: 30, pages: [titleBlock(1, "NIVEAU R+1"), titleBlock(2, null)] });
    expect([reading.pages_total, reading.pages_read, reading.unreadable_pages]).toEqual([30, [1, 2], [2]]);
  });
});

describe("the correction of a revision", () => {
  const reading = readPlanLocation({ originalName: "BAT-B_R+1.pdf", pageCount: 1, pages: [titleBlock(1, "BÂTIMENT A NIVEAU L00")] });
  const value = (text: string): PlanLocationFieldChoice => ({ choice: "value", value: text });
  const follow: PlanLocationFieldChoice = { choice: "reading", value: null };
  const unknown: PlanLocationFieldChoice = { choice: "unknown", value: null };
  const annotation = (fields: Partial<PlanLocationAnnotationValues>): PlanLocationAnnotationValues =>
    ({ building: value("A"), level: value("L00"), ...fields });

  it("is confirmed when it keeps the proposal and corrected when it changes it", () => {
    const location = resolvePlanLocation({ reading, annotation: annotation({ level: value("R+1") }), carryOver: null });
    expect(location.building).toMatchObject({ value: "A", state: "confirmed", origin: "operator" });
    expect(location.level).toMatchObject({ value: "R+1", state: "corrected", origin: "operator" });
  });

  it("follows the reading of these bytes, still to check, for a field the operator leaves to it", () => {
    const location = resolvePlanLocation({ reading, annotation: annotation({ level: follow }), carryOver: { building: null, level: "L01" } });
    expect(location.level).toMatchObject({ value: "L00", state: "proposed", origin: "title_block" });
    expect(location.building).toMatchObject({ value: "A", state: "confirmed", origin: "operator" });
  });

  // Catches a resolution that shows the reading again for a field marked « À préciser » (clearing the field used to
  // restore the plan's wrong reading), or that drops the reading kept beside it.
  it("withdraws a wrong reading when the operator marks the field to be specified, the reading kept as evidence", () => {
    const location = resolvePlanLocation({ reading, annotation: annotation({ level: unknown }), carryOver: null });
    expect(location.level).toEqual({ value: null, state: "unknown", origin: "operator", pages: [], title_block_read: true,
      candidates: [{ value: "L00", source: "title_block", pages: [1] }, { value: "R+1", source: "file_name", pages: [] }] });
  });

  it("stands without a reading, for bytes that can no longer be read", () => {
    expect(resolvePlanLocation({ reading: null, annotation: annotation({}), carryOver: null }).building)
      .toMatchObject({ value: "A", state: "corrected", origin: "operator" });
  });

  it("of an earlier revision is only a proposal to check on other bytes, the new reading staying visible", () => {
    const next = readPlanLocation({ originalName: "P-101_B.pdf", pageCount: 1, pages: [titleBlock(1, "BÂTIMENT A NIVEAU R+2")] });
    const location = resolvePlanLocation({ reading: next, annotation: null, carryOver: { building: "A", level: "L00" } });
    expect(location.level).toMatchObject({ value: "L00", state: "proposed", origin: "previous_revision" });
    expect(location.level.candidates).toEqual([{ value: "R+2", source: "title_block", pages: [1] }]);
    // A field the earlier correction did not set to a value falls back to the reading of these bytes.
    expect(resolvePlanLocation({ reading: next, annotation: null, carryOver: { building: null, level: "L00" } }).building)
      .toMatchObject({ value: "A", state: "proposed", origin: "title_block" });
  });

  it("of this revision makes an earlier one irrelevant", () => {
    const location = resolvePlanLocation({ reading, annotation: annotation({ level: value("R+1") }), carryOver: { building: null, level: "L01" } });
    expect(location.level).toMatchObject({ value: "R+1", origin: "operator" });
  });

  // A field is carried when it is set to the earlier correction's value. Catches a comparison of both fields together,
  // which dropped the origin as soon as one field differed.
  it("carries each field set to the earlier correction's value, and only those", () => {
    const carry = { building: "A", level: "L02" };
    expect(planLocationCarriedFields(carry, { building: value("A"), level: value("L02") })).toEqual(["building", "level"]);
    expect(planLocationCarriedFields(carry, { building: value("A"), level: value("L03") })).toEqual(["building"]);
    expect(planLocationCarriedFields(carry, { building: unknown, level: follow })).toEqual([]);
    expect(planLocationCarriedFields(null, { building: value("A"), level: value("L02") })).toEqual([]);
  });
});

describe("the values an operator types", () => {
  it("are trimmed, spaces collapsed, an empty value being none", () => {
    expect(normalizePlanLocationValue("  Bâtiment   Nord ")).toBe("Bâtiment Nord");
    expect(normalizePlanLocationValue("   ")).toBeNull();
    expect(normalizePlanLocationValue("L00")).toBe("L00");
    expect(() => normalizePlanLocationValue("A".repeat(41))).toThrow();
    expect(() => normalizePlanLocationValue("R+1\u0007")).toThrow();
  });
});

describe("the correction offered for a revision without its own", () => {
  const key = (source_id: string, content_hash: string, source_kind: "intake_document" | "plan_file" = "intake_document") =>
    ({ source_kind, source_id, content_hash });
  const rows = [
    { ...key("homonym", "h9"), id: "homonym-latest" },
    { ...key("piece", "h1"), id: "same-piece-earlier-bytes" },
    { ...key("replaced", "h0"), id: "replaced-piece" },
    { ...key("piece", "h2"), id: "this-revision" },
  ];

  it("is the latest correction of the same piece with other bytes, never this revision's own", () => {
    expect(selectPlanLocationCarryOver(rows, key("piece", "h2"), [])).toEqual({ row: rows[1], same_source: true });
  });

  it("can come from a piece the preparation says this one replaces, never from a homonym", () => {
    expect(selectPlanLocationCarryOver(rows, key("other", "h5"), [key("replaced", "h0")])).toEqual({ row: rows[2], same_source: false });
    expect(selectPlanLocationCarryOver(rows, key("other", "h5"), [])).toBeNull();
    // A decision on other bytes of the replaced piece names another revision: nothing is offered.
    expect(selectPlanLocationCarryOver(rows, key("other", "h5"), [key("replaced", "h7")])).toBeNull();
  });
});
