import { describe, expect, it } from "vitest";

import { boundRuleResults, readRuleInputs, writableRuleInputs } from "@/lib/takeoff/rules/contracts";
import { ruleInputsFromDesignation } from "@/lib/takeoff/rules/inputs";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";

// The worker wrote rule inputs the reader rejects (a printed size of 41 characters or more), inserted their line stale,
// and the line was never computed (TI-664 L5b review): what the worker writes is what the reader reads.
describe("rule inputs written by the worker", () => {
  it("keeps an overlong printed size out of the inputs, so that the DN rule fails the line instead of never running", () => {
    const designation = `Tube cuivre EF DN ${"1".repeat(45)}`;
    const raw = ruleInputsFromDesignation({ designation, unit: "ml", quantity: 10 });
    expect(raw.dn?.length ?? 0).toBeGreaterThan(40);
    const written = writableRuleInputs(raw);
    expect(written).toMatchObject({ kind: "network", network: "EF", material: "cuivre", dn: null });
    expect(readRuleInputs({ rule_inputs: written })).toEqual(written);
  });

  it("clips an overlong room label and writes nothing that still does not parse", () => {
    const room = "Bureau ".repeat(30);
    const written = writableRuleInputs({ version: 1, source: "vector", kind: "surface", network: null, material: null, dn: null,
      non_observable: null, model_quantity: 12, room, printed_m2: 12 });
    expect(written?.room?.length).toBeLessThanOrEqual(120);
    expect(readRuleInputs({ rule_inputs: written })).toEqual(written);
    expect(writableRuleInputs({ ...(written as NonNullable<typeof written>), model_quantity: Number.NaN })).toBeNull();
  });
});

// TI-686 D9: the acceptance of a printed-area failure compares the declared basis with the one the price line expects
// (details.expected_basis). The last bound keeps only numbers and the level: it must keep the basis too, or a line with
// large results would be accepted without the comparison.
describe("rule results at the last bound", () => {
  it("keeps the basis the price line expects", () => {
    const area: TakeoffRuleResult = { rule: "area_printed", status: "fail", code: "AREA_PRINTED_MISMATCH", version: 3, acceptable: true,
      reason: "😀".repeat(500), details: { level: "R+1", printed_m2: 20, measured_m2: 19.5, expected_basis: "net_floor",
        cause: "😀".repeat(2000), scale_reason: "管".repeat(3000),
        overlapping_item_ids: Array.from({ length: 3000 }, (_, index) => `9f000000-0000-4000-8000-${String(index).padStart(12, "0")}`) } };
    const bounded = boundRuleResults(Array.from({ length: 16 }, () => area));
    for (const entry of bounded) {
      expect(entry.details).not.toHaveProperty("cause");
      expect(entry.details).toMatchObject({ level: "R+1", printed_m2: 20, measured_m2: 19.5, expected_basis: "net_floor" });
    }
  });
});

// TI-684: a partner drawn at the same place but read differently says what differs. The stored results are parsed
// before each write and after each read: a field the schema does not know would be dropped, and the review would show a
// copy read with another DN as a plain duplicate.
describe("a copy read differently in stored results", () => {
  const duplicate = (differs: unknown): TakeoffRuleResult => ({ rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE", version: 201,
    acceptable: true, reason: "Tronçon dessiné au même endroit sur une autre page.", details: { level: "R+1", overlap_m: 1, partner_count: 1,
      partners: [{ item_id: "9f000000-0000-4000-8000-000000000001", job_id: "9f000000-0000-4000-8000-000000009000", zone: "Z2",
        designation: "EF Inox 316L DN 28", overlap_m: 1, resolved: false, ...(differs === undefined ? {} : { differs }) } as never] } });

  it("keeps what the partner reads differently through the write bounds, and nothing on a plain duplicate", () => {
    expect(boundRuleResults([duplicate(["network", "dn"])])[0].details?.partners?.[0]).toMatchObject({ differs: ["network", "dn"] });
    expect(boundRuleResults([duplicate(undefined)])[0].details?.partners?.[0]).not.toHaveProperty("differs");
  });

  it("refuses a difference the rule does not know, or an empty list", () => {
    expect(() => boundRuleResults([duplicate(["colour"])])).toThrow();
    expect(() => boundRuleResults([duplicate([])])).toThrow();
  });
});
