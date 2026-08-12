import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeAffaireCounters } from "@/lib/affaires/status-counts";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260812012308_add_affaires_sending_counter.sql"
  ),
  "utf8"
);

describe("affaires sending counters", () => {
  it("returns a dedicated unfiltered sending bucket from PostgreSQL", () => {
    expect(migrationSql).toMatch(
      /returns table \([\s\S]*sending_count integer/i
    );
    expect(migrationSql).toMatch(
      /from searched where effective_status = 'sending'::public\.estimate_status/i
    );
    expect(migrationSql).toMatch(/set search_path = ''/i);
    expect(migrationSql).toMatch(
      /revoke all on function public\.get_affaires_counters\([\s\S]*from public, anon/i
    );
  });

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
