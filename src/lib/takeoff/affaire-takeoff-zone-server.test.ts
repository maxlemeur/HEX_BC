import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/takeoff/launch-request-server", () => ({ readAffaireTakeoffLaunchState: vi.fn() }));
vi.mock("@/lib/takeoff/preparation-repository", () => ({ assertPreparationProjectAccess: vi.fn() }));

import { toAffaireTakeoffCoverage } from "@/lib/takeoff/affaire-takeoff-zone-server";

// The manifest a request sealed holds digests, files, the budget and the plans' generations: a member's zone reads only
// how many plans it retained and the pieces it left out, by name and reason.
describe("toAffaireTakeoffCoverage", () => {
  it("projects names and reasons only, and drops an entry it does not know", () => {
    const manifest = {
      format_version: 1, budget: { tokens: 400000, cost_cents: 2500 },
      plans: [{ plan_file_id: "f1", content_sha256: "a".repeat(64), generation: "g1" }],
      references: [{ document_id: "d1", kind: "cctp", content_sha256: "b".repeat(64) }],
      coverage: {
        plans_retained: 1,
        plans_omitted: [{ id: "f2", name: "Plan RDC indice A.pdf", reason: "alternate", content_sha256: "c".repeat(64) },
          { id: "f3", name: "Inconnu.pdf", reason: "autre" }],
        references_omitted: [{ id: "d2", name: "CCTP.docx", reason: "unsupported_format", file_path: "tenant/affaire/cctp.docx" }],
      },
    };
    expect(toAffaireTakeoffCoverage(manifest)).toEqual({
      plansRetained: 1,
      plansOmitted: [{ id: "f2", name: "Plan RDC indice A.pdf", reason: "alternate" }],
      referencesOmitted: [{ id: "d2", name: "CCTP.docx", reason: "unsupported_format" }],
    });
    expect(JSON.stringify(toAffaireTakeoffCoverage(manifest))).not.toMatch(/sha256|cost_cents|file_path|generation/);
  });

  it("shows no coverage for a request without a sealed manifest", () => {
    expect(toAffaireTakeoffCoverage(null)).toBeNull();
    expect(toAffaireTakeoffCoverage({ coverage: {} })).toBeNull();
  });
});
