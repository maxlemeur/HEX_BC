import { describe, expect, it } from "vitest";

import { guessTargetFieldFromColumn } from "@/lib/mappings/server";

describe("guessTargetFieldFromColumn", () => {
  it("maps OPTIMA type headers to supply_type", () => {
    expect(guessTargetFieldFromColumn("Type FO")).toBe("supply_type");
    expect(guessTargetFieldFromColumn("Famille FO")).toBe("supply_type");
    expect(guessTargetFieldFromColumn("Type_FO")).toBe("supply_type");
  });

  it("maps OPTIMA majoration headers to h_mo_majoration", () => {
    expect(guessTargetFieldFromColumn("Majoration MO")).toBe("h_mo_majoration");
    expect(guessTargetFieldFromColumn("Temps majoré")).toBe("h_mo_majoration");
    expect(guessTargetFieldFromColumn("Temps majore")).toBe("h_mo_majoration");
  });

  it("keeps legacy famille/category heuristic when FO is not present", () => {
    expect(guessTargetFieldFromColumn("Famille")).toBe("category");
    expect(guessTargetFieldFromColumn("Famille produit")).toBe("category");
  });
});
