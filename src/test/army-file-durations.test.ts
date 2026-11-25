import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { durationCeiling, durationWarnings, measuredSeconds } from "../../scripts/tester-army/file-durations";
import { readMeasurements, refreshDurations } from "../../scripts/tester-army/refresh-durations";
import { loadShardDurations } from "../../scripts/tester-army/select-journeys";

const { durations } = loadShardDurations(process.cwd());

describe("Army serial file durations", () => {
  it("keeps every checked-in measurement inside its documented ceiling", () => {
    expect(Object.entries(durations.seconds).filter(([file, seconds]) => seconds > durationCeiling(file))).toEqual([]);
    expect(durationCeiling("e2e/army/local/another-intake.e2e.ts")).toBe(600);
    expect(durationCeiling("e2e/army/local/chatgpt-local-intake.e2e.ts")).toBe(1000);
    expect(durationWarnings({ a: 400, b: 401 })).toEqual([expect.stringContaining("b — 401 s")]);
  });

  it("sums a file before rounding and excludes partial, retried and unselected results", () => {
    const pass = (file: string, durationMs: number) => ({ file, status: "passed", selected: true, attempts: [{ status: "passed", durationMs }] });
    expect(measuredSeconds([pass("a", 1050), pass("a", 1800), pass("b", 30), { ...pass("b", 5), attempts: [] },
      { ...pass("c", 100), selected: false }, { ...pass("d", 1), attempts: [pass("d", 1).attempts[0], pass("d", 2).attempts[0]] }]))
      .toEqual({ a: 3 });
  });

  it("reads the named suite from a green aggregate and refuses filtered or changed evidence", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-measurements-"));
    const source = { directory, revision: "revision", run: "123", suite: "critical" };
    const artifact = "army-critical-shard-1-evidence";
    const phase = path.join(directory, "units", artifact, "critical");
    const file = "e2e/army/local/example.e2e.ts";
    const sample = { file, selected: true, status: "passed", attempts: [{ status: "passed", durationMs: 1500 }] };
    const report = JSON.stringify({ run: { results: [sample, { ...sample, file: "e2e/army/critical/auth.setup.e2e.ts" }] } });
    const manifest = { schemaVersion: "army-ci-aggregate-1", status: "passed", scope: "critical", suite: "critical",
      revision: source.revision, units: [{ kind: "shard", artifact,
        reports: [{ path: "critical/report.json", sha256: createHash("sha256").update(report).digest("hex") }] }] };
    try {
      fs.mkdirSync(phase, { recursive: true });
      fs.writeFileSync(path.join(phase, "report.json"), report);
      fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest));
      expect(readMeasurements(source)).toEqual({ [file]: 2 });
      expect(() => readMeasurements({ ...source, revision: "different" })).toThrow(/whole critical aggregate/);
      fs.writeFileSync(path.join(phase, "report.json"), report + "\n");
      expect(() => readMeasurements(source)).toThrow(/checksum/);
      fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ ...manifest, scope: "filtered-critical" }));
      expect(() => readMeasurements(source)).toThrow(/whole critical aggregate/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("adds unknown files, filters noise, records threshold crossings and keeps a repeat idempotent", () => {
    const before = { ...durations, seconds: { a: 100, b: 400, c: 600, d: 30, e: 60 } };
    const measured = Object.entries({ a: 119, b: 401, c: 601, d: 20, f: 2 })
      .map(([file, seconds]) => ({ file, seconds, run: "123", suite: "critical" }));
    const after = refreshDurations(before, measured);
    expect(after.seconds).toEqual({ a: 100, b: 401, c: 601, d: 20, e: 60, f: 2 });
    expect(after.measured?.[0]).toContain("123, selected tests in seconds: b, c, d, f.");
    expect(refreshDurations(after, measured)).toBe(after);
  });
});
