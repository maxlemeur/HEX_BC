import { expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/job-read-server", () => ({ getAuthenticatedTakeoffContext: vi.fn() }));

import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { authenticatedContext, createSupabaseFake, filterValue, M3_PROJECT_ID } from "@/lib/takeoff/metre-m3.test-utils";
import { hasTakeoffAnalysisForProject } from "@/lib/takeoff/plans";

it("finds the analysis when an affaire's only job has no estimate version", async () => {
  const fake = createSupabaseFake({ tables: {
    takeoff_jobs: (query) => ({
      data: filterValue(query, "project_id") === M3_PROJECT_ID && !query.columns?.includes("estimate_versions")
        ? { id: "versionless-job" }
        : null,
      error: null,
    }),
  } });
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue(authenticatedContext(fake) as never);
  await expect(hasTakeoffAnalysisForProject(M3_PROJECT_ID)).resolves.toBe(true);
});
