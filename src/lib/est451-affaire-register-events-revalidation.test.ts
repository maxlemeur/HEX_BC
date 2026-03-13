import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("EST-451 affaire register revalidation migration", () => {
  it("extends the register event constraint with revalidation_requested", () => {
    const sql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "supabase/migrations/20260313005000_est451_affaire_register_revalidation_event.sql"
      ),
      "utf8"
    );

    expect(sql).toMatch(/drop constraint if exists affaire_register_events_event_type_check/);
    expect(sql).toMatch(/'continued_with_hypothesis'/);
    expect(sql).toMatch(/'clarify_with_client_requested'/);
    expect(sql).toMatch(/'revalidation_requested'/);
  });
});
