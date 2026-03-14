import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("EST-452 affaire register follow-up event migration", () => {
  it("allows the follow_up_updated event type in affaire_register_events", async () => {
    const sql = await fs.readFile(
      path.join(
        process.cwd(),
        "supabase/migrations/20260314110000_est452_affaire_register_follow_up_event.sql"
      ),
      "utf8"
    );

    expect(sql).toMatch(/drop constraint if exists affaire_register_events_event_type_check/);
    expect(sql).toMatch(/follow_up_updated/);
    expect(sql).toMatch(/clarify_with_client_requested/);
  });
});
