import { describe, expect, it } from "vitest";

import { mapApplyTakeoffRpcError } from "@/lib/takeoff/apply-errors";
import { TakeoffErrorCode } from "@/lib/takeoff/errors";

// TI-682 lot B (D11): the refusal of private.assert_takeoff_single_quantity_source, as the route answers it. Ways it
// fails: the page conflict answers a server error, or a message that names no page; a detail the guard did not write
// (an older database, an unreadable text) breaks the answer instead of keeping the paired message.

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const conflict = (details: string | null) => mapApplyTakeoffRpcError(
  { code: "23514", message: "TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT", details, hint: null }, { jobId: JOB_ID });

describe("mapApplyTakeoffRpcError, alternative sources", () => {
  it("refuses both readings of one page with a 422 that names the page and what may stay beside a measure", () => {
    const error = conflict('{"scope": "page", "dimension": "length", "source_page": 3, "source_file_name": "plan-fictif.pdf"}');
    expect(error).toMatchObject({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false, jobId: JOB_ID });
    expect(error.message).toBe("Une mesure vectorielle et une ligne lue sur le plan de la page 3 de « plan-fictif.pdf » sont retenues ensemble. "
      + "Conservez une seule lecture par page : excluez l’une des deux dans la revue. "
      + "Seuls un comptage ou une mesure d’une autre nature, dans une unité connue, restent à côté d’une mesure.");
    expect(error.details).toMatchObject({ guard: "quantity_sources", scope: "page", dimension: "length", source_page: 3,
      source_file_name: "plan-fictif.pdf" });
  });

  it("names what the guard named, and nothing more", () => {
    expect(conflict('{"scope": "page", "source_page": null, "source_file_name": null}').message)
      .toContain("une ligne lue sur le plan d’une même page sont retenues ensemble");
  });

  it.each([
    ["two readings the worker paired", '{"scope": "group"}'],
    ["a guard that says nothing", null],
    ["a detail that is no JSON", "conflit"],
    ["a scope it does not know", '{"scope": "level"}'],
  ])("keeps the paired message for %s", (_label, details) => {
    const error = conflict(details);
    expect(error).toMatchObject({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED });
    expect(error.message).toBe("Deux lectures alternatives sont retenues pour la même quantité. Conservez une seule source par poste ou zone.");
    expect(error.details).toMatchObject({ guard: "quantity_sources" });
  });
});
