import { describe, expect, it } from "vitest";

import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import {
  pruneJustification,
  requiredAcceptanceReasons,
  verificationError,
  verificationJustificationReadSchema,
} from "@/lib/takeoff/rules/verification";

// TI-686 D9: accepting (V) a scale or printed-area failure needs a coded reason and a note, as a network failure
// already does. The same table runs in SQL against validate_takeoff_rule_acceptance
// (supabase/tests/database/takeoff-acceptance-reasons.test.sql): the route refuses before the database does, with a
// message the review shows, since a database refusal reaches the user as a generic error. All values are fictional.

const fail = (rule: TakeoffRuleResult["rule"], code: string, version: number, details?: TakeoffRuleResult["details"]) =>
  ({ rule, status: "fail", code, version, acceptable: true, reason: "Fictif.", ...(details ? { details } : {}) }) as TakeoffRuleResult;

const SCALE = fail("scale_dimension", "SCALE_DIMENSION_MISMATCH", 2, { scale_reason: "dimension_mismatch" });
const AREA = fail("area_printed", "AREA_PRINTED_MISMATCH", 3,
  { printed_m2: 20, measured_m2: 19.5, deviation: -0.025, expected_basis: "net_floor", cause: "basis_unknown" });
const NETWORK = fail("dn_network", "DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION", 3);
const GAS_PE = fail("dn_network", "DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION", 3);
const DUPLICATE = fail("zone_overlap", "ZONE_OVERLAP_DUPLICATE", 101, { overlap_m: 1 });

const NOTE = "Cotes 5,00 et 3,00 concordantes en travée 2.";
const NETWORK_REASON = { reason_code: "system_documented", system_reference: "Fabricant fictif, gamme G, certificat C" } as const;
const scale = (note: string = NOTE) => ({ scale_dimension: { reason_code: "scale_confirmed_by_other_dimensions", note } } as const);
const AREA_NOTE = "Tableau des surfaces du plan fictif, indice B.";
const area = <Basis extends string, Reason extends string = "printed_area_basis_identified">(retainedBasis: Basis, reasonCode?: Reason) =>
  ({ area_printed: { reason_code: reasonCode ?? "printed_area_basis_identified", retained_basis: retainedBasis, note: AREA_NOTE } } as const);
const AREA_WITHOUT_BASIS = { area_printed: { reason_code: "printed_area_basis_identified", note: AREA_NOTE } } as const;

const SCALE_MESSAGE = "Une cote de la page contredit l’échelle : un motif codé et ce qui a été vérifié (10 à 500 caractères) sont obligatoires.";
const AREA_MESSAGE = "Une surface écrite s’accepte avec un motif codé, la base de la surface écrite et une note (10 à 500 caractères).";
const D17_MESSAGE = "Même base que la prestation : les deux surfaces se comparent et la plus élevée est retenue. Retenez 20 m² avant d’accepter.";
const GAS_PE_NOT_APPLICABLE = "Ce motif ne vaut que pour une conduite de gaz en PE.";

describe("acceptance reasons required by a failure (TI-686 D9)", () => {
  it("names the failures that need a reason, never a duplicate, a room overlap or a closed box", () => {
    expect(requiredAcceptanceReasons([DUPLICATE, AREA, SCALE, NETWORK])).toEqual(["dn_network", "scale_dimension", "area_printed"]);
    expect(requiredAcceptanceReasons([DUPLICATE, fail("room_overlap", "ROOM_OVERLAP", 1), fail("closed_box", "CLOSED_BOX_LABEL", 1)]))
      .toEqual([]);
    expect(requiredAcceptanceReasons([{ ...SCALE, status: "pass", code: "SCALE_DIMENSION_CONSISTENT" } as TakeoffRuleResult])).toEqual([]);
  });
});

describe("scale failure", () => {
  it("refuses V without a reason", () => {
    expect(verificationError([SCALE], false, null, 5)).toBe(SCALE_MESSAGE);
    expect(verificationError([SCALE], false, NETWORK_REASON, 5)).toBe(SCALE_MESSAGE);
  });

  it.each([
    ["9 code points", "x".repeat(9), false],
    ["5 emoji (10 UTF-16 units)", "😀".repeat(5), false],
    ["10 emoji (10 code points)", "😀".repeat(10), true],
    ["500 code points", "é".repeat(500), true],
    ["501 code points", "é".repeat(501), false],
    ["9 code points between ASCII blanks", ` \t${"x".repeat(9)}\n\r\f\v`, false],
    ["9 code points after a no-break space, which is no blank", ` ${"x".repeat(9)}`, true],
  ])("counts the note in code points after the ASCII blanks: %s", (_name, note, accepted) => {
    expect(verificationError([SCALE], false, scale(note), 5)).toBe(accepted ? null : SCALE_MESSAGE);
  });

  it("refuses a reason outside the list and a key beside the reason and the note", () => {
    expect(verificationError([SCALE], false, { scale_dimension: { reason_code: "system_documented", note: NOTE } }, 5)).toBe(SCALE_MESSAGE);
    expect(verificationError([SCALE], false, { scale_dimension: { ...scale().scale_dimension, extra: true } }, 5)).toBe(SCALE_MESSAGE);
  });
});

describe("printed-area failure", () => {
  it("needs the basis of the printed surface", () => {
    expect(verificationError([AREA], false, AREA_WITHOUT_BASIS, 19.5)).toBe(AREA_MESSAGE);
    expect(verificationError([AREA], false, area("gross_floor"), 19.5)).toBe(AREA_MESSAGE);
    expect(verificationError([AREA], false, null, 19.5)).toBe(AREA_MESSAGE);
  });

  it("keeps the higher of two surfaces of the same basis (D17), never when the bases differ", () => {
    expect(verificationError([AREA], false, area("net_floor"), 19.5)).toBe(D17_MESSAGE);
    expect(verificationError([AREA], false, area("net_floor"), 19.999)).toBe(D17_MESSAGE);
    expect(verificationError([AREA], false, area("net_floor"), 20)).toBeNull();
    expect(verificationError([AREA], false, area("shab"), 19.5)).toBeNull();
    expect(verificationError([AREA], false, area("other"), 19.5)).toBeNull();
  });

  // TI-686 D21: « contour mesuré retenu » says the printed surface covers another outline. Even on the price line's
  // basis nothing compares: the quantity stays the measurement. Every other reason keeps D17 on that basis.
  it("keeps the measurement when the measured outline is retained, even on the price line's basis (D21)", () => {
    expect(verificationError([AREA], false, area("net_floor", "measured_outline_retained"), 19.5)).toBeNull();
    expect(verificationError([AREA], false, area("net_floor", "printed_area_basis_identified"), 19.5)).toBe(D17_MESSAGE);
    expect(verificationError([AREA], false, area("net_floor", "confirmed_by_other_document"), 19.5)).toBe(D17_MESSAGE);
    expect(verificationError([AREA], false, area("net_floor", "deviation_explained"), 19.5)).toBe(D17_MESSAGE);
  });

  it("compares nothing when the line's basis is unknown", () => {
    const unknownBasis = fail("area_printed", "AREA_PRINTED_MISMATCH", 3, { printed_m2: 20, measured_m2: 19.5, cause: "basis_unknown" });
    expect(verificationError([unknownBasis], false, area("net_floor"), 19.5)).toBeNull();
  });
});

describe("several failures", () => {
  it("asks for each failure's own reason", () => {
    expect(verificationError([NETWORK, SCALE], false, NETWORK_REASON, 5)).toBe(SCALE_MESSAGE);
    expect(verificationError([NETWORK, SCALE], false, { ...NETWORK_REASON, ...scale() }, 5)).toBeNull();
    expect(verificationError([NETWORK, SCALE, AREA], false, { ...NETWORK_REASON, ...scale() }, 20)).toBe(AREA_MESSAGE);
  });

  it("still refuses results to compute again and a failure V never settles", () => {
    expect(verificationError([SCALE], true, scale(), 5)).toBe("Recalculez les règles avant d’accepter la ligne.");
    expect(verificationError([SCALE, { ...NETWORK, code: "DN_NETWORK_MATERIAL_BLOCKED", acceptable: false } as TakeoffRuleResult],
      false, { ...NETWORK_REASON, ...scale() }, 5))
      .toBe("Cette ligne ne s’accepte pas en relecture. Corrigez-la ou demandez un forçage administrateur.");
  });
});

describe("PE gas reasons", () => {
  it("keeps the gas PE reasons for a PE gas pipe, both ways", () => {
    expect(verificationError([GAS_PE], false, NETWORK_REASON, 5))
      .toBe("Le PE gaz exige un motif de pose extérieure hors emprise ou de remontée en façade jusqu’au raccord métal/plastique.");
    expect(verificationError([GAS_PE], false, { ...NETWORK_REASON, reason_code: "gas_pe_buried_outside" }, 5)).toBeNull();
    expect(verificationError([NETWORK], false, { ...NETWORK_REASON, reason_code: "gas_pe_buried_outside" }, 5)).toBe(GAS_PE_NOT_APPLICABLE);
    expect(verificationError([NETWORK], false, { ...NETWORK_REASON, reason_code: "gas_pe_facade_transition" }, 5)).toBe(GAS_PE_NOT_APPLICABLE);
  });
});

describe("what the server stores", () => {
  it("keeps only the reasons of the failures the line has", () => {
    expect(pruneJustification([DUPLICATE], scale())).toBeNull();
    expect(pruneJustification([SCALE], { ...NETWORK_REASON, ...scale(), ...area("shab") })).toEqual(scale());
    expect(pruneJustification([NETWORK, AREA], { ...NETWORK_REASON, ...scale(), ...area("shab") }))
      .toEqual({ ...NETWORK_REASON, ...area("shab") });
    expect(pruneJustification([SCALE], null)).toBeNull();
  });
});

describe("what the reads accept", () => {
  it("reads a note the Data API stored beyond the write bounds, so that no job becomes unreadable", () => {
    const note = `x\n\n${"y".repeat(1997)}`;
    expect(verificationJustificationReadSchema.parse({ ...scale(note), ...area("other") }))
      .toEqual({ ...scale(note), ...area("other") });
  });

  it("reads the flat network justification written before D9", () => {
    expect(verificationJustificationReadSchema.parse(NETWORK_REASON)).toEqual(NETWORK_REASON);
  });
});
