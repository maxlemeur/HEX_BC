

import { describe, expect, it } from "vitest";

import { normalizeAffaireCounters } from "@/lib/affaires/status-counts";

describe("affaires sending counters", () => {

  it("never derives sending from a status-filtered total", () => {
    expect(
      normalizeAffaireCounters({
        total_count: 12,
        filtered_count: 6,
        draft_count: 4,
        sending_count: 1,
        sent_count: 1,
        accepted_count: 2,
        archived_count: 0,
      })
    ).toEqual({
      totalCount: 12,
      filteredCount: 6,
      statusCounts: {
        draft: 4,
        sending: 1,
        sent: 1,
        accepted: 2,
        archived: 0,
      },
    });
  });
});
