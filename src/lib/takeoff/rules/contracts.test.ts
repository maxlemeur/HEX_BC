import { describe, expect, it } from "vitest";

import { readRuleInputs, writableRuleInputs } from "@/lib/takeoff/rules/contracts";
import { ruleInputsFromDesignation } from "@/lib/takeoff/rules/inputs";

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
