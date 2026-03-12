import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("EST-450 affaire register client clarification migration", () => {
  it("extends the register event constraint with clarify_with_client_requested", () => {
    const sql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "supabase/migrations/20260313003500_est450_affaire_register_client_clarification_event.sql"
      ),
      "utf8"
    );

    expect(sql).toMatch(/drop constraint if exists affaire_register_events_event_type_check/);
    expect(sql).toMatch(/'clarify_with_client_requested'/);
    expect(sql).toMatch(/'continued_with_hypothesis'/);
  });
});
