import { describe, expect, it } from "vitest";

import { isAffaireOrder } from "./orders-model";

describe("isAffaireOrder", () => {
  // TI-691, delivery 3b-1 (review): the embedded affaire is hidden by RLS when the reader cannot read it; the order's
  // own project_id still says it belongs to one.
  it("knows an order of an affaire by its project_id, even when the affaire itself is not readable", () => {
    expect(isAffaireOrder({ project_id: "30000000-0000-4000-8000-000000000001", project: null })).toBe(true);
  });

  it("knows it by the embedded affaire when the row carries no project_id", () => {
    expect(isAffaireOrder({ project: { id: "30000000-0000-4000-8000-000000000001", name: "Affaire fictive" } })).toBe(true);
  });

  it("leaves an order without affaire free", () => {
    expect(isAffaireOrder({ project_id: null, project: null })).toBe(false);
  });
});
