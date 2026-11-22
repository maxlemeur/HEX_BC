import { describe, expect, it } from "vitest";

import { itemTableAddressParams, readItemTableAddress, withItemTableParams } from "./item-table-query";

const FOCUS = "00000000-0000-4000-A000-000000000001";

describe("the address of a view of the table of items", () => {
  it("reads a view: scope, filters, page and focus, with the page's prefix", () => {
    const params = new URLSearchParams(`postePlan=plan-a&posteState=measured,not_found&posteFamily=Plomberie%20%2F%20R%C3%A9seaux`
      + `&posteFamily=A,B&posteLocation=bat-a:rdc&posteDecision=pending&posteOffset=50&posteLimit=100&posteFocus=${FOCUS}&tab=jobs`);
    expect(readItemTableAddress(params, "poste")).toEqual({
      scope: { kind: "plan", planKey: "plan-a" },
      filter: { states: ["measured", "not_found"], families: ["Plomberie / Réseaux", "A,B"], locations: ["bat-a:rdc"],
        decisions: ["pending"] },
      offset: 50, limit: 100, focusItemId: FOCUS.toLowerCase(),
    });
  });

  it("leaves out what it does not understand, never an error, and never an action", () => {
    const params = new URLSearchParams("posteState=bogus&posteDecision=accept&posteOffset=-3&posteLimit=7&posteFocus=x&posteGesture=accept_measured");
    expect(readItemTableAddress(params, "poste")).toEqual({ scope: { kind: "affaire" }, filter: {}, offset: 0, limit: 50, focusItemId: null });
  });

  it("writes a view back, keeping the other parameters of the page", () => {
    const next = withItemTableParams("tab=jobs&posteOffset=50", itemTableAddressParams({
      scope: { kind: "plan", planKey: "plan-a" }, filter: { states: ["uncertain"] }, offset: 0 }, "poste"));
    expect(next.toString()).toBe("tab=jobs&postePlan=plan-a&posteState=uncertain");
    expect(readItemTableAddress(next, "poste")).toMatchObject({ scope: { kind: "plan", planKey: "plan-a" }, filter: { states: ["uncertain"] } });
  });
});
