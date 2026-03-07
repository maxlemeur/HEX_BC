import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("EST-384 version zero materialization RPC regressions", () => {
  const migrationSql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260307224500_est384_version_zero_materialize_rpc.sql"
    ),
    "utf8"
  );

  it("materializes version zero drafts through a single SQL RPC", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.materialize_estimate_version_zero_draft\(/
    );
    expect(migrationSql).toMatch(/insert into public\.estimate_items \(/);
    expect(migrationSql).toMatch(
      /insert into public\.estimate_version_zero_applications \(/
    );
    expect(migrationSql).toMatch(
      /update public\.estimate_version_zero_lines l[\s\S]*materialized_estimate_item_id/
    );
    expect(migrationSql).toMatch(
      /update public\.estimate_version_zero_drafts[\s\S]*status = 'materialized'/
    );
  });

  it("rechecks the critical draft invariants inside the transaction", () => {
    expect(migrationSql).toMatch(/EST384_DRAFT_NOT_FOUND/);
    expect(migrationSql).toMatch(/EST384_DRAFT_NOT_REVIEWABLE/);
    expect(migrationSql).toMatch(/EST384_VERSION_NOT_EMPTY/);
    expect(migrationSql).toMatch(/EST384_PENDING_LINES/);
    expect(migrationSql).toMatch(/for update;/);
  });

  it("grants authenticated sessions access to the materialization RPC", () => {
    expect(migrationSql).toMatch(
      /grant execute on function public\.materialize_estimate_version_zero_draft\(/
    );
    expect(migrationSql).toMatch(/\) to authenticated;/);
  });
});
