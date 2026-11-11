// @vitest-environment node

// A calc-v3 group job runs several phases one after another on one owned stack
// (`run-tester-army-ci.ts calc-v3 --phase A,B`, docs/testing/tester-army-ci.md,
// "Jobs parallèles"). What no journey can show, each of which would lose
// coverage or let the aggregate vouch for the wrong phases:
// 1. a list the runner reads as something else: a repeated or unknown phase, an
//    empty item, `all` among phases, or a --grep spread over several phases;
// 2. a manifest whose scope and phase list are not the list that was asked, so
//    that the aggregate cannot tell which phases a group's evidence proves;
// 3. a red phase that stops the group: the phases after it would have no
//    result at all, where one job per phase used to give each its own.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runCalcV3Campaign } from "../../scripts/tester-army/calc-v3-campaign";
import { CALC_V3_PHASES, calcV3Scope, parseCalcV3Phases } from "../../scripts/tester-army/calc-v3-phases";

const root = process.cwd();
const RUNNER = path.join(root, "scripts", "run-tester-army-ci.ts");
const TSX = pathToFileURL(path.join(root, "node_modules", "tsx", "dist", "loader.mjs")).href;

const directories: string[] = [];
function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-calc-runner-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * The real runner, started in an empty directory: it parses its options, then
 * refuses the directory before any stack (no package.json to check the installed
 * dependencies against), and still retains its manifest. Nothing is started.
 */
function runRunner(args: string[]) {
  const directory = temporaryDirectory();
  const result = spawnSync(process.execPath, ["--import", TSX, RUNNER, "calc-v3", ...args], {
    cwd: directory, encoding: "utf8", timeout: 60_000, windowsHide: true,
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot, TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json") },
  });
  const runs = path.join(directory, ".e2e", "army", "ci");
  const manifests = fs.existsSync(runs)
    ? fs.readdirSync(runs).map((name) => JSON.parse(fs.readFileSync(path.join(runs, name, "manifest.json"), "utf8")) as Record<string, unknown>)
    : [];
  return { result, manifests };
}

describe("calc-v3 --phase list", () => {
  it("reads one phase or several distinct ones, in the order given", () => {
    expect(parseCalcV3Phases("access")).toEqual(["access"]);
    expect(parseCalcV3Phases("generated-atomic,access,mobile")).toEqual(["generated-atomic", "access", "mobile"]);
    expect(parseCalcV3Phases(CALC_V3_PHASES.join(","))).toEqual(CALC_V3_PHASES);
    for (const refused of ["", "access,access", "access,offers", "access,", ",access", "access, mobile", "all", "access,all", "access;mobile"]) {
      expect(() => parseCalcV3Phases(refused), JSON.stringify(refused)).toThrow(/--phase names one calc-v3 phase, or several distinct ones separated by commas: journeys\|/u);
    }
  });

  it("names the scope after the list, so that two lists never share a scope", () => {
    expect(calcV3Scope(undefined)).toBe("calc-v3");
    expect(calcV3Scope(["access"])).toBe("calc-v3-access");
    expect(calcV3Scope(["access", "generated-atomic"])).toBe("calc-v3-access,generated-atomic");
    expect(calcV3Scope(["generated-atomic", "access"])).not.toBe(calcV3Scope(["access", "generated-atomic"]));
  });

  it("records the phases asked in the runner manifest and its scope", () => {
    const cases: Array<[args: string[], expected: Record<string, unknown>]> = [
      [["--phase", "access,generated-atomic"], { scope: "calc-v3-access,generated-atomic", calcV3Phases: ["access", "generated-atomic"] }],
      [["--phase", "access"], { scope: "calc-v3-access", calcV3Phases: ["access"] }],
      [["--phase", "access", "--grep", "^GA01\\s"], { scope: "filtered-calc-v3", grep: "^GA01\\s", calcV3Phases: ["access"] }],
    ];
    for (const [args, expected] of cases) {
      const { result, manifests } = runRunner(args);
      expect(result.status, `${args.join(" ")}: ${result.stdout}${result.stderr}`).toBe(1);
      expect(manifests, args.join(" ")).toHaveLength(1);
      // Refused before any stack: no step ran, and the list is on record all the same.
      expect(manifests[0], args.join(" ")).toMatchObject({ suite: "calc-v3", status: "failed", steps: [], ...expected });
      expect(String(manifests[0].error)).toContain("Cannot read dependency metadata");
    }
    // The complete campaign records no list: its scope is the suite's.
    const whole = runRunner([]).manifests[0];
    expect(whole).toMatchObject({ suite: "calc-v3", scope: "calc-v3", status: "failed", steps: [] });
    expect(whole).not.toHaveProperty("calcV3Phases");
  }, 60_000);

  it("refuses a list it cannot run as asked before it creates anything", () => {
    const cases: Array<[args: string[], message: string]> = [
      [["--phase", "access,access"], "--phase names one calc-v3 phase, or several distinct ones separated by commas"],
      [["--phase", "all"], "--phase names one calc-v3 phase, or several distinct ones separated by commas"],
      [["--phase", "access,generated-atomic", "--grep", "^GA01\\s"], "A calc-v3 --grep filters exactly one --phase."],
      [["--phase", "access", "--phase", "mobile"], "one --phase"],
    ];
    for (const [args, message] of cases) {
      const { result, manifests } = runRunner(args);
      expect(result.status, args.join(" ")).not.toBe(0);
      expect(result.stderr, args.join(" ")).toContain(message);
      expect(manifests, args.join(" ")).toEqual([]);
    }
  }, 60_000);
});

describe("calc-v3 campaign of several phases", () => {
  it("runs the phases after a red one and names every red phase", async () => {
    // A real red phase without a stack: the application port is taken, so each phase is refused before its
    // journeys (TI-672). The campaign must still reach the second phase and give it its own result.
    const holder = net.createServer();
    await new Promise<void>((resolve) => holder.listen({ port: 0, host: "127.0.0.1" }, resolve));
    const port = (holder.address() as net.AddressInfo).port;
    const directory = temporaryDirectory();
    const evidence = path.join(directory, "evidence");
    fs.mkdirSync(evidence);
    let builds = 0;
    try {
      const campaign = runCalcV3Campaign({
        root: directory, evidence, appPort: port,
        environment: { NODE_ENV: "test", E2E_ARMY_BASE_URL: `http://localhost:${port}` },
        backend: "http://127.0.0.1:54321", anonKey: "anon", databaseUrl: "postgresql://unused.invalid/postgres", psql: "psql",
        admin: {} as never, owner: { userId: "user", tenantId: "tenant", laborRoleId: "role" },
        phases: ["access", "generated-atomic"],
        remember: () => undefined, redact: (value) => value, build: async () => { builds += 1; },
      });
      await expect(campaign).rejects.toThrow(new RegExp(`^access: Local application port ${port} is unavailable.*; generated-atomic: Local application port ${port} is unavailable`, "su"));
    } finally {
      await new Promise((resolve) => holder.close(resolve));
    }
    const written = JSON.parse(fs.readFileSync(path.join(evidence, "calc-v3.json"), "utf8")) as {
      selection: unknown; phases: { phase: string; status: string; evidence: string }[] };
    expect(written.selection).toEqual({ phases: ["access", "generated-atomic"], grep: null });
    expect(written.phases.map(({ phase, status, evidence: file }) => [phase, status, file])).toEqual([
      ["access", "failed", "access/phase.json"], ["generated-atomic", "failed", "generated-atomic/phase.json"],
    ]);
    for (const phase of ["access", "generated-atomic"]) {
      expect(JSON.parse(fs.readFileSync(path.join(evidence, phase, "phase.json"), "utf8")), phase).toMatchObject({ phase, status: "failed" });
    }
    // One build serves the whole group.
    expect(builds).toBe(1);
  }, 60_000);
});
