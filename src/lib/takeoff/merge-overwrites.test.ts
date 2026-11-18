import { describe, expect, it } from "vitest";

import {
  mergeOverwrites,
  writerMergeReach,
  type MergeSectionLine,
  type MergeSentLine,
} from "@/lib/takeoff/merge-overwrites";

// The re-check of 0fd09a20 (finding 1): on a version that holds a DPGF line the screen sends « merge », and the writer
// matches a takeoff line onto an ordinary line of the destination section by title and unit, then overwrites its quantity
// and provenance (private.takeoff_apply_v3_lines, 20261025134000:107-119 and 153-187; public.apply_takeoff_job for
// engines 1 and 2, 20260225133000:139-153 and 280-337). These cases are read from those SQL lines: the title trimmed of spaces, its runs of
// whitespace reduced (engine 3 only), lower-cased, accents kept; the unit as the referential resolves it (engine 3) or as
// written against the line's description (engines 1 and 2); duplicates paired rank to rank, the takeoff's lines by source
// order, the section's by position then identifier. Written before the module existed.

const SECTION = "55555555-5555-4555-8555-555555555555";
const OTHER_SECTION = "55555555-5555-4555-8555-555555555556";
const id = (n: number) => `77777777-7777-4777-8777-${String(n).padStart(12, "0")}`;
const sentId = (n: number) => `88888888-8888-4888-8888-${String(n).padStart(12, "0")}`;

const sent = (n: number, designation: string, extra: Partial<MergeSentLine> = {}): MergeSentLine => ({
  id: sentId(n), designation, unit: "ml", quantity: 10, sourceOrder: n, ...extra });
const line = (n: number, title: string | null, extra: Partial<MergeSectionLine> = {}): MergeSectionLine => ({
  id: id(n), title, unit_code: "ml", description: null, pricing_status: "priced", position: n, ...extra });

const reach = (sentLines: MergeSentLine[], section: MergeSectionLine[], writer: "engine3" | "legacy" = "engine3") =>
  Object.fromEntries(writerMergeReach(sentLines, section, writer));

describe("writerMergeReach, engine 3 (private.takeoff_apply_v3_lines)", () => {
  it("matches a title whatever its case and its spaces, on the unit the referential resolves", () => {
    expect(reach([sent(1, "tube   PVC", { unit: "m.l." })], [line(1, "  Tube PVC ")])).toEqual({ [id(1)]: [sentId(1)] });
  });

  it("keeps accents apart, as the SQL does not fold them", () => {
    expect(reach([sent(1, "Evier inox", { unit: "u" })], [line(1, "Évier inox", { unit_code: "u" })])).toEqual({});
  });

  it("never matches another unit, nor a unit the referential does not know (the application is then refused whole)", () => {
    expect(reach([sent(1, "Tube PVC", { unit: "m2" })], [line(1, "Tube PVC")])).toEqual({});
    expect(reach([sent(1, "Tube PVC", { unit: "brouette" })], [line(1, "Tube PVC")])).toEqual({});
  });

  it("matches a status mention on the line's pricing status", () => {
    expect(reach([sent(1, "Essais", { unit: "PM" })], [line(1, "Essais", { unit_code: null, pricing_status: "for_memory" })]))
      .toEqual({ [id(1)]: [sentId(1)] });
    expect(reach([sent(1, "Essais", { unit: "PM" })], [line(1, "Essais", { unit_code: null, pricing_status: "priced" })])).toEqual({});
  });

  it("never matches a line without a title", () => {
    expect(reach([sent(1, "Tube PVC")], [line(1, null)])).toEqual({});
  });

  it("pairs duplicates rank to rank: the takeoff's by source order, the section's by position then identifier", () => {
    const section = [line(3, "Tube PVC", { position: 1 }), line(1, "Tube PVC", { position: 2 }), line(2, "Tube PVC", { position: 1 })];
    // Handed in another order than their source order: the writer ranks by source order.
    expect(reach([sent(2, "Tube PVC"), sent(1, "Tube PVC")], section)).toEqual({ [id(2)]: [sentId(1)], [id(3)]: [sentId(2)] });
  });

  it("puts a line without a position after the others, as ORDER BY does", () => {
    expect(reach([sent(1, "Tube PVC")], [line(1, "Tube PVC", { position: null }), line(2, "Tube PVC", { position: 9 })]))
      .toEqual({ [id(2)]: [sentId(1)] });
  });

  // Where the database's locale decides (a capital beyond ASCII, a tab the SQL trims not), the client cannot tell which
  // lines the writer pairs: every line of that title may be reached, never fewer than the writer's.
  it("reaches every line of the title where the database's locale decides, never fewer", () => {
    expect(reach([sent(1, "évier", { unit: "u" })], [line(1, "ÉVIER", { unit_code: "u" }), line(2, "évier", { unit_code: "u" })]))
      .toEqual({ [id(1)]: [sentId(1)], [id(2)]: [sentId(1)] });
    expect(reach([sent(1, "Tube PVC")], [line(1, "\tTube PVC")])).toEqual({ [id(1)]: [sentId(1)] });
  });
});

describe("writerMergeReach, engines 1 and 2 (public.apply_takeoff_job)", () => {
  it("matches the title and the unit as written, against the line's description", () => {
    expect(reach([sent(1, "Tube PVC", { unit: " ML " })], [line(1, "tube pvc", { unit_code: null, description: "ml" })], "legacy"))
      .toEqual({ [id(1)]: [sentId(1)] });
    expect(reach([sent(1, "Tube PVC", { unit: "m.l." })], [line(1, "Tube PVC", { unit_code: "ml", description: "ml" })], "legacy"))
      .toEqual({});
  });

  it("pairs duplicates rank to rank", () => {
    const section = [line(1, "Tube PVC", { description: "ml" }), line(2, "Tube PVC", { description: "ml" })];
    expect(reach([sent(1, "Tube PVC")], section, "legacy")).toEqual({ [id(1)]: [sentId(1)] });
  });
});

describe("mergeOverwrites", () => {
  const item = (n: number, title: string, extra: Record<string, unknown> = {}) => ({ id: id(n), parent_id: SECTION, item_type: "line",
    title, unit_code: "ml", description: null, pricing_status: "priced", position: n, quantity: 17, source_provider: null, ...extra });

  it("names an ordinary line of the destination section the writer would overwrite, with the line sent onto it", () => {
    const overwrites = mergeOverwrites({ sent: [sent(1, "Tube PVC")], targetSectionId: SECTION, accounted: new Set(),
      estimateItems: [item(1, "Tube PVC")] });
    expect(overwrites).toEqual([{ line: expect.objectContaining({ id: id(1), quantity: 17 }), sent: [sent(1, "Tube PVC")] }]);
  });

  it("leaves out a DPGF line (refused by the database), a line the proposal accounts for, and lines elsewhere", () => {
    const overwrites = mergeOverwrites({
      sent: [sent(1, "Tube PVC"), sent(2, "Tube PVC"), sent(3, "Vanne", { unit: "u" }), sent(4, "Regard", { unit: "u" })],
      targetSectionId: SECTION,
      accounted: new Set([id(2)]),
      estimateItems: [
        item(1, "Tube PVC", { source_provider: "dpgf" }),
        item(2, "Tube PVC"),
        item(3, "Vanne", { unit_code: "u", parent_id: OTHER_SECTION }),
        item(4, "Regard", { unit_code: "u", item_type: "section" }),
      ],
    });
    expect(overwrites).toEqual([]);
  });

  it("reaches a line either writer would overwrite, the screen not knowing the version's engine", () => {
    // Engine 1/2 line: its unit in the description, no code.
    const overwrites = mergeOverwrites({ sent: [sent(1, "Tube PVC")], targetSectionId: SECTION, accounted: new Set(),
      estimateItems: [item(1, "Tube PVC", { unit_code: null, description: "ml" })] });
    expect(overwrites.map((overwrite) => overwrite.line.id)).toEqual([id(1)]);
  });
});
