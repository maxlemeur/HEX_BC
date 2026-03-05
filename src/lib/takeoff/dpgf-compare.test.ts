import { describe, expect, it } from "vitest";

import { buildTakeoffDpgfComparison } from "@/lib/takeoff/dpgf-compare";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const DPGF_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const DPGF_ITEM_ID_2 = "44444444-4444-4444-8444-444444444444";
const TAKEOFF_ITEM_ID = "55555555-5555-4555-8555-555555555555";
const TAKEOFF_ITEM_ID_2 = "66666666-6666-4666-8666-666666666666";
const LINK_ID = "77777777-7777-4777-8777-777777777777";

describe("buildTakeoffDpgfComparison", () => {
  it("matches rows automatically and computes severity from delta percent", () => {
    const response = buildTakeoffDpgfComparison({
      versionId: VERSION_ID,
      jobId: JOB_ID,
      threshold: 0.6,
      dpgfLines: [
        {
          estimate_item_id: DPGF_ITEM_ID,
          title: "Faux plafond acoustique",
          description: null,
          quantity: 100,
          unit: "m2",
          source_page: 12,
          source_file_name: "dpgf.xlsx",
          position: 1,
        },
      ],
      takeoffLines: [
        {
          item_id: TAKEOFF_ITEM_ID,
          designation: "Faux plafond acoustique",
          quantity: 82,
          unit: "m2",
          source_page: 3,
          source_file_name: "plans.pdf",
          confidence: 0.92,
        },
      ],
    });

    expect(response.summary).toMatchObject({
      matches: 0,
      gaps: 1,
      missing_dpgf: 0,
      missing_takeoff: 0,
      manual_links: 0,
      critical_count: 0,
      warning_count: 1,
      total_rows: 1,
    });
    expect(response.rows[0]).toMatchObject({
      match_source: "auto",
      severity: "warning",
      delta_absolute: 18,
      delta_percent: 18,
    });
  });

  it("prioritizes persisted manual links over automatic matching", () => {
    const response = buildTakeoffDpgfComparison({
      versionId: VERSION_ID,
      jobId: JOB_ID,
      threshold: 0.9,
      dpgfLines: [
        {
          estimate_item_id: DPGF_ITEM_ID,
          title: "Cloison BA13",
          description: null,
          quantity: 10,
          unit: "m2",
          source_page: 1,
          source_file_name: "dpgf.xlsx",
          position: 1,
        },
      ],
      takeoffLines: [
        {
          item_id: TAKEOFF_ITEM_ID,
          designation: "Plafond metallique",
          quantity: 10,
          unit: "m2",
          source_page: 8,
          source_file_name: "plans.pdf",
          confidence: 0.5,
        },
      ],
      manualLinks: [
        {
          id: LINK_ID,
          tenant_id: "88888888-8888-4888-8888-888888888888",
          version_id: VERSION_ID,
          takeoff_job_id: JOB_ID,
          estimate_item_id: DPGF_ITEM_ID,
          takeoff_item_id: TAKEOFF_ITEM_ID,
          created_at: "2026-03-06T10:00:00.000Z",
          updated_at: "2026-03-06T10:00:00.000Z",
          linked_by: null,
        },
      ],
    });

    expect(response.summary.manual_links).toBe(1);
    expect(response.rows[0]).toMatchObject({
      match_source: "manual",
      manual_link_id: LINK_ID,
      severity: "ok",
    });
  });

  it("returns unmatched takeoff rows as missing_dpgf and paginates with an opaque cursor", () => {
    const firstPage = buildTakeoffDpgfComparison({
      versionId: VERSION_ID,
      jobId: JOB_ID,
      pageSize: 1,
      dpgfLines: [
        {
          estimate_item_id: DPGF_ITEM_ID,
          title: "Peinture mate",
          description: null,
          quantity: 20,
          unit: "m2",
          source_page: 2,
          source_file_name: "dpgf.xlsx",
          position: 1,
        },
        {
          estimate_item_id: DPGF_ITEM_ID_2,
          title: "Moquette",
          description: null,
          quantity: 5,
          unit: "m2",
          source_page: 3,
          source_file_name: "dpgf.xlsx",
          position: 2,
        },
      ],
      takeoffLines: [
        {
          item_id: TAKEOFF_ITEM_ID,
          designation: "Peinture mate",
          quantity: 20,
          unit: "m2",
          source_page: 4,
          source_file_name: "plans.pdf",
          confidence: 0.8,
        },
        {
          item_id: TAKEOFF_ITEM_ID_2,
          designation: "Reserve plafond",
          quantity: 2,
          unit: "u",
          source_page: 5,
          source_file_name: "plans.pdf",
          confidence: 0.6,
        },
      ],
    });

    expect(firstPage.rows).toHaveLength(1);
    expect(firstPage.pagination.next_cursor).toBeTruthy();
    expect(firstPage.summary).toMatchObject({
      matches: 1,
      missing_takeoff: 1,
      missing_dpgf: 1,
      total_rows: 3,
    });

    const secondPage = buildTakeoffDpgfComparison({
      versionId: VERSION_ID,
      jobId: JOB_ID,
      pageSize: 5,
      cursor: firstPage.pagination.next_cursor,
      dpgfLines: [
        {
          estimate_item_id: DPGF_ITEM_ID,
          title: "Peinture mate",
          description: null,
          quantity: 20,
          unit: "m2",
          source_page: 2,
          source_file_name: "dpgf.xlsx",
          position: 1,
        },
        {
          estimate_item_id: DPGF_ITEM_ID_2,
          title: "Moquette",
          description: null,
          quantity: 5,
          unit: "m2",
          source_page: 3,
          source_file_name: "dpgf.xlsx",
          position: 2,
        },
      ],
      takeoffLines: [
        {
          item_id: TAKEOFF_ITEM_ID,
          designation: "Peinture mate",
          quantity: 20,
          unit: "m2",
          source_page: 4,
          source_file_name: "plans.pdf",
          confidence: 0.8,
        },
        {
          item_id: TAKEOFF_ITEM_ID_2,
          designation: "Reserve plafond",
          quantity: 2,
          unit: "u",
          source_page: 5,
          source_file_name: "plans.pdf",
          confidence: 0.6,
        },
      ],
    });

    expect(secondPage.rows).toHaveLength(2);
    expect(secondPage.rows[0]?.severity).toBe("missing");
    expect(secondPage.rows[1]).toMatchObject({
      dpgf: null,
      takeoff: expect.objectContaining({ item_id: TAKEOFF_ITEM_ID_2 }),
      severity: "missing",
    });
  });
});
