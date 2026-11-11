import { describe, expect, it } from "vitest";

import {
  ESTIMATE_LINE_NATURE_LABELS,
  ESTIMATE_LINE_NATURES,
  isPoseOnlyLine,
  lineNatureExpectsLabor,
  lineNatureExpectsSupply,
  POSE_ONLY_MENTION,
  poseOnlyDesignation,
  resolveEstimateLineNature,
  resolvePromotedEstimateLineNature,
  selectableEstimateLineNatures,
} from "@/lib/estimates/line-nature";

describe("resolveEstimateLineNature", () => {

  it("derives supply-only for a legacy priced line without labor", () => {
    expect(
      resolveEstimateLineNature({ unit_price_ht_cents: 1200, h_mo: 0 }),
    ).toBe("supply_only");
  });

  it("derives labor-only when a legacy line has labor and no supply", () => {
    expect(
      resolveEstimateLineNature({ unit_price_ht_cents: 0, h_mo: 2 }),
    ).toBe("labor_only");
  });
});

describe("resolvePromotedEstimateLineNature", () => {
  it("promotes a supply-only line when labor is entered", () => {
    expect(
      resolvePromotedEstimateLineNature(
        {
          line_nature: "supply_only",
          unit_price_ht_cents: 1200,
          h_mo: 0,
        },
        { h_mo: 0.5 },
      ),
    ).toBe("supply_and_labor");
  });

  it("promotes a labor-only line when supply is entered", () => {
    expect(
      resolvePromotedEstimateLineNature(
        {
          line_nature: "labor_only",
          unit_price_ht_cents: 0,
          h_mo: 2,
        },
        { unit_price_ht_cents: 1200 },
      ),
    ).toBe("supply_and_labor");
  });

  it("never demotes a mixed line when a component is cleared", () => {
    expect(
      resolvePromotedEstimateLineNature(
        {
          line_nature: "supply_and_labor",
          unit_price_ht_cents: 1200,
          h_mo: 2,
        },
        { h_mo: 0, labor_role_id: null },
      ),
    ).toBe("supply_and_labor");
  });

  it("keeps an explicit manual nature even when values disagree", () => {
    expect(
      resolvePromotedEstimateLineNature(
        {
          line_nature: "supply_and_labor",
          unit_price_ht_cents: 1200,
          h_mo: 2,
        },
        { line_nature: "supply_only" },
      ),
    ).toBe("supply_only");
  });

  it("does not promote an inconsistent legacy line on an unrelated edit", () => {
    expect(
      resolvePromotedEstimateLineNature(
        {
          line_nature: "supply_only",
          unit_price_ht_cents: 1200,
          h_mo: 2,
        },
        {},
      ),
    ).toBe("supply_only");
  });
});

// TI-539 : POSE SEULE est un choix explicite de l'utilisateur, imprimé sur le devis. Elle n'est jamais déduite
// d'un prix vide ou nul, et aucune saisie ne la retire à la place de l'utilisateur.
describe("POSE SEULE", () => {
  it("is never derived from an empty or zero supply price", () => {
    expect(resolveEstimateLineNature({ unit_price_ht_cents: 0, h_mo: 2 })).toBe("labor_only");
    expect(resolveEstimateLineNature({ unit_price_ht_cents: null, h_mo: 2, labor_role_id: "role" })).toBe("labor_only");
    expect(resolveEstimateLineNature({ line_nature: null, unit_price_ht_cents: 0, h_mo: 0 })).toBe("supply_only");
  });

  it("keeps the explicit choice of the user", () => {
    expect(resolveEstimateLineNature({ line_nature: "pose_only", unit_price_ht_cents: 0, h_mo: 2 })).toBe("pose_only");
    expect(isPoseOnlyLine({ item_type: "line", line_nature: "pose_only" })).toBe(true);
    expect(isPoseOnlyLine({ item_type: "line", line_nature: "labor_only" })).toBe(false);
    expect(isPoseOnlyLine({ item_type: "line", line_nature: null })).toBe(false);
    expect(isPoseOnlyLine({ item_type: "section", line_nature: null })).toBe(false);
  });

  it("allows a zero supply cost and keeps the labor expected", () => {
    expect(lineNatureExpectsSupply("pose_only")).toBe(false);
    expect(lineNatureExpectsLabor("pose_only")).toBe(true);
  });

  it("is not removed by an edit: a supply value on the line stays a visible inconsistency", () => {
    expect(
      resolvePromotedEstimateLineNature(
        { line_nature: "pose_only", unit_price_ht_cents: 0, h_mo: 2 },
        { unit_price_ht_cents: 1200 },
      ),
    ).toBe("pose_only");
    expect(
      resolvePromotedEstimateLineNature(
        { line_nature: "pose_only", unit_price_ht_cents: 0, h_mo: 2 },
        { h_mo: 3 },
      ),
    ).toBe("pose_only");
  });

  // The mention travels in the engine-3 client contract only: elsewhere it would show on the preview and not on
  // the issued PDF. A line that already carries it keeps the option, so its select stays truthful.
  it("is offered only where the issued quote prints it", () => {
    expect(selectableEstimateLineNatures({ printsPoseOnly: true, current: "labor_only" })).toEqual(ESTIMATE_LINE_NATURES);
    expect(selectableEstimateLineNatures({ printsPoseOnly: false, current: "labor_only" }))
      .toEqual(["supply_only", "supply_and_labor", "labor_only"]);
    expect(selectableEstimateLineNatures({ printsPoseOnly: false, current: "pose_only" })).toEqual(ESTIMATE_LINE_NATURES);
  });

  it("is written with the validated words", () => {
    expect(POSE_ONLY_MENTION).toBe("POSE SEULE");
    expect(ESTIMATE_LINE_NATURE_LABELS.pose_only).toBe("POSE SEULE");
  });

  // Réponse de Maxime du 11/11/2026 : pas de tiret long. La mention suit la désignation comme dans ses devis, et un
  // titre qui la porte déjà (lignes importées « Ballon ECS 30 litres POSE SEULE ») ne la répète pas.
  it("follows the designation without a long dash, and is not repeated on a title that already carries it", () => {
    expect(poseOnlyDesignation("pose radiateur client")).toBe("pose radiateur client POSE SEULE");
    expect(poseOnlyDesignation("Ballon ECS 30 litres POSE SEULE")).toBe("Ballon ECS 30 litres POSE SEULE");
    expect(poseOnlyDesignation("Pose seule d'un WC")).toBe("Pose seule d'un WC");
    expect(poseOnlyDesignation("Repose seulement")).toBe("Repose seulement POSE SEULE");
    expect(poseOnlyDesignation("pose radiateur client")).not.toMatch(/[\u2013\u2014]/);
  });
});
