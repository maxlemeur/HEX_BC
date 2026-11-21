import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  TAKEOFF_LAUNCH_DOSSIER_REASONS, TAKEOFF_LAUNCH_MANDATE_REASONS, TAKEOFF_LAUNCH_TRANSIENT_REASONS,
} from "@/lib/takeoff/launch-request";

// The reasons a launch request waits on are decided in SQL (the claim, the allowed gesture) and shown by the server:
// the TypeScript lists are the latest migration's definition (20261121170448_takeoff_launch_requests.sql, replaced by
// later ones such as 20261121180813_takeoff_item_lists.sql), in the same order, so that a reason added to one is added
// to the other.
const directory = path.resolve("supabase/migrations");
const migrations = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()
  .map((file) => readFileSync(path.join(directory, file), "utf8"));
function sqlList(name: string) {
  const pattern = new RegExp(`create (?:or replace )?function private\\.${name}\\(\\) returns text\\[\\][^$]*\\$\\$\\s*select array\\[([^\\]]*)\\]`);
  const body = migrations.map((migration) => pattern.exec(migration)).filter(Boolean).at(-1);
  if (!body) throw new Error(`${name} not found in the migrations.`);
  return [...body[1].matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
}

describe("launch request reasons", () => {
  it.each([
    ["takeoff_launch_mandate_reasons", TAKEOFF_LAUNCH_MANDATE_REASONS],
    ["takeoff_launch_dossier_reasons", TAKEOFF_LAUNCH_DOSSIER_REASONS],
    ["takeoff_launch_transient_reasons", TAKEOFF_LAUNCH_TRANSIENT_REASONS],
  ])("lists %s as the migration does", (name, list) => {
    expect([...list]).toEqual(sqlList(name));
  });
});
