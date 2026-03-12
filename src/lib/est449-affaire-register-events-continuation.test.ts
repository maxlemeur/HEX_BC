import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("EST-449 affaire register continuation migration", () => {
  it("extends the register event constraint with continued_with_hypothesis", () => {
    const sql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "supabase/migrations/20260313002000_est449_affaire_register_continue_with_hypothesis.sql"
      ),
      "utf8"
    );

    expect(sql).toMatch(/drop constraint if exists affaire_register_events_event_type_check/);
    expect(sql).toMatch(/'continued_with_hypothesis'/);
  });
});
