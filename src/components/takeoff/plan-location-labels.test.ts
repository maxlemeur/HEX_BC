import { describe, expect, it } from "vitest";

import { planLocationProvenanceLabel } from "@/components/takeoff/plan-location-labels";
import type { PlanLocationFieldView } from "@/lib/takeoff/plan-location";

const carried = (value: string): PlanLocationFieldView =>
  ({ value, state: "proposed", origin: "previous_revision", pages: [], candidates: [], title_block_read: true });

describe("the provenance of a value proposed from an earlier revision", () => {
  // Written first, failing: both fields were credited to the last editor of the earlier correction, at their date.
  it("names, per field, the member who set it and when", () => {
    const earlier = {
      building: { value: "A", set_by_name: "Alice Fictive", set_at: "2026-11-20T08:00:00Z" },
      level: { value: "L02", set_by_name: "Bob Fictif", set_at: "2026-11-21T09:00:00Z" },
    };
    expect(planLocationProvenanceLabel("building", carried("A"), null, earlier))
      .toBe("Repris de la correction d’une version précédente (Alice Fictive le 20 nov. 2026) · à vérifier");
    expect(planLocationProvenanceLabel("level", carried("L02"), null, earlier))
      .toBe("Repris de la correction d’une version précédente (Bob Fictif le 21 nov. 2026) · à vérifier");
  });
});
