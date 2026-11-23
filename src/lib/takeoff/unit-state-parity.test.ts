import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { deriveTakeoffRequestUnits, type TakeoffRequestManifest, type TakeoffRequestUnitJobRow } from "@/lib/takeoff/request-activity";

// The state of a unit is decided by the database (private.takeoff_unit_state) and derived again here for the activity
// centre's batched reads. Both read the matrix of supabase/tests/database/takeoff-unit-state-parity.test.sql: the pgTAP
// file runs it through the SQL rule, this test through the TypeScript derivation, and both require its expected states.
const MATRIX = path.join(process.cwd(), "supabase/tests/database/takeoff-unit-state-parity.test.sql");

function readMatrix() {
  const text = readFileSync(MATRIX, "utf8");
  const block = text.slice(text.indexOf("-- unit-state-matrix:begin"), text.indexOf("-- unit-state-matrix:end"));
  const value = (raw: string) => (raw === "null" ? null : raw.slice(1, -1));
  return [...block.matchAll(/\((\d+), ('[a-z_]+'), (null|'[a-z_]+'), (null|'[A-Z_]+'), (true|false), ('[a-z_]+')\)/g)].map((row) => ({
    n: Number(row[1]), status: value(row[2]) as string, outcome: value(row[3]), code: value(row[4]), started: row[5] === "true",
    expected: value(row[6]) as string,
  }));
}

describe("the state of a unit", () => {
  it("is derived by the activity centre as the database decides it, row for row", () => {
    const matrix = readMatrix();
    expect(matrix.length).toBe(20);
    const manifest: TakeoffRequestManifest = { formatVersion: 1, itemList: false, plans: new Map(), omitted: [],
      units: matrix.map((row) => ({ key: `unit:${row.n}`, ordinal: row.n, plans: [], pages: null })) };
    const jobs: TakeoffRequestUnitJobRow[] = matrix.map((row) => ({ id: `job-${row.n}`, launch_request_id: "request",
      launch_unit_key: `unit:${row.n}`, status: row.status, started_at: row.started ? "2026-11-21T08:00:00.000Z" : null,
      next_retry_at: null, analysis_outcome: row.outcome, error_code: row.code, updated_at: "2026-11-21T08:00:00.000Z" }));
    const units = deriveTakeoffRequestUnits({ requestId: "request", manifest, jobs });
    expect(units?.units.map((unit) => [Number(unit.key.slice("unit:".length)), unit.state]))
      .toEqual(matrix.map((row) => [row.n, row.expected]));
  });
});
