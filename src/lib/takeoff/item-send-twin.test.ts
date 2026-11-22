import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseQuantity } from "@/lib/numeric-input/parsers";
import { composeDpgfTarget } from "@/lib/takeoff/dpgf-composition";
import { round4 } from "@/lib/takeoff/dpgf-quantity-policy";
import { itemSendDiameter, itemSendFolded } from "@/lib/takeoff/item-send-plan";
import { lengthFactor, roundedMeasure } from "@/lib/takeoff/page-replacement";

// Lot 4, PR 5b: the writer (migration C) computes again in SQL what the planner computes here; the vectors both run are
// the data of the writer's pgTAP file, read from it, so that one rule is written once for both sides: the arithmetic of
// a target, the number rule of a DPGF quantity (parseQuantity), the comparison forms of an identity.

const SQL = readFileSync(path.join(process.cwd(), "supabase/tests/database/takeoff-item-send.test.sql"), "utf8");
const vectors = <T>(tag: string): T[] => {
  const match = new RegExp(`\\$${tag}\\$(\\[[\\s\\S]*?\\])\\$${tag}\\$`).exec(SQL);
  if (!match) throw new Error(`Vecteurs ${tag} introuvables.`);
  return JSON.parse(match[1]) as T[];
};

describe("the writer's twin vectors", () => {
  it("computes each target's quantity as the writer does: the protective maximum, a length rounded once", () => {
    const rows = vectors<{ position: number; unit: string; reference: number | null; measured: number; protective: number; written: number }>("vectors");
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) {
      const composed = composeDpgfTarget(row.reference, [{ job_id: "job", item_ids: ["answer"], quantity: row.measured,
        protective: row.protective, printed_gap: 0 }]);
      expect([row.position, round4(roundedMeasure(round4(composed.priced), lengthFactor({ unit_code: row.unit, description: null })))])
        .toEqual([row.position, row.written]);
    }
  });

  it("reads a DPGF quantity with one number rule on both sides (point 11)", () => {
    const rows = vectors<{ position: number; value: unknown; read: number | null }>("quantities");
    expect(rows.length).toBeGreaterThanOrEqual(16);
    for (const row of rows) expect([row.position, parseQuantity(row.value)]).toEqual([row.position, row.read]);
  });

  it("compares an identity's basis, qualifiers and diameter in the writer's forms", () => {
    const rows = vectors<{ position: number; value: string; folded: string | null; diameter: string | null }>("identities");
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      expect([row.position, itemSendFolded(row.value), itemSendDiameter(row.value)]).toEqual([row.position, row.folded, row.diameter]);
    }
  });
});
