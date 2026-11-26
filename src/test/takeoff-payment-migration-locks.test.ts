import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

it.each(["takeoff_personal_api_mandate", "takeoff_personal_api_mark_publication"])(
  "bounds lock acquisition for the %s migration inside its own transaction",
  (migration) => {
    const directory = new URL("../../supabase/migrations/", import.meta.url);
    const names = readdirSync(directory).filter((name) => name.slice(15) === `${migration}.sql`);
    expect(names).toHaveLength(1);
    const sql = readFileSync(new URL(names[0], directory), "utf8").replace(/^--[^\n]*\n/gm, "").trim();
    expect(sql).toMatch(/^begin;\s+set local lock_timeout = '5s';/);
    expect(sql).toMatch(/commit;$/);
    expect(sql).not.toMatch(/^\s*set lock_timeout\b/im);
  },
);
