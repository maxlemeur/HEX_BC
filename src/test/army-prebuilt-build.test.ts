// @vitest-environment node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  calcV3NeedsProductionBuild, decidePrebuiltReuse, installPrebuiltOutput, PREBUILT_SCHEMA, readPrebuiltCandidate,
  removeInstalledOutput, verifyInstalledOutput, type PrebuiltCandidate,
} from "../../scripts/tester-army/prebuilt-build";
import { buildCommands } from "../../scripts/tester-army/local-recipe-common.mjs";

// One army-build job per Army workflow run builds the production application; each shard reuses that build only when it
// is provably the build of its own checkout for its own backend (docs/testing/tester-army-ci.md, "Pile, confidentialité et
// diagnostic"). Failure modes: a shard serves a build of other sources, of another backend origin or anon key, of another
// runtime, a build that failed or changed during the build, or files that are not the recorded output; a missing or broken
// download fails the shard instead of letting it build as before.

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const ANON_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.local-signature";
const BACKEND = "http://127.0.0.1:61234";
const RUNTIME = { node: "v26.12.1", platform: "linux", arch: "x64" };
const SOURCE = { revision: "a".repeat(40), diffSha256: sha256(""), inputs: [{ path: "src/app/page.tsx", sha256: sha256("page") }] };
const OUTPUT_INPUTS = [
  { path: ".build/tester-army/next/BUILD_ID", bytes: 7, sha256: sha256("build-1") },
  { path: ".build/tester-army/next/server/app/page.js", bytes: 4, sha256: sha256("page") },
];
const OUTPUT = { distDir: ".build/tester-army/next", inputs: OUTPUT_INPUTS, digest: sha256(JSON.stringify(OUTPUT_INPUTS)) };

function candidate(overrides: { build?: Record<string, unknown>; prebuilt?: Record<string, unknown> } = {}): PrebuiltCandidate {
  const build = {
    schemaVersion: "army-local-build-1", revision: SOURCE.revision, diffSha256: SOURCE.diffSha256,
    inputs: SOURCE.inputs, inputsAfter: SOURCE.inputs, backend: BACKEND, node: RUNTIME.node, platform: RUNTIME.platform,
    steps: buildCommands.map((args) => ({ args, exitCode: 0, signal: null })), sourceChangedDuringBuild: false,
    buildId: "build-1", compiledOutput: OUTPUT, ...overrides.build,
  };
  const bytes = JSON.stringify(build);
  return {
    directory: "/prebuilt", buildDirectoryName: "2026-11-24-build", buildManifestSha256: sha256(bytes), build,
    prebuilt: {
      schemaVersion: PREBUILT_SCHEMA, backend: BACKEND, anonKeySha256: sha256(ANON_KEY), arch: RUNTIME.arch,
      buildManifestSha256: sha256(bytes), compiledOutputDigest: OUTPUT.digest, artifact: { name: "army-prebuilt-build", runId: "1", runAttempt: "1" },
      ...overrides.prebuilt,
    },
  } as PrebuiltCandidate;
}

const decide = (value: PrebuiltCandidate, shard: Partial<{ backendOrigin: string; anonKey: string; source: typeof SOURCE; runtime: typeof RUNTIME }> = {}) =>
  decidePrebuiltReuse({ candidate: value, backendOrigin: BACKEND, anonKey: ANON_KEY, source: SOURCE, runtime: RUNTIME, ...shard });

describe("prebuilt build reuse rule", () => {
  it("reuses the build of this checkout, backend and runtime", () => {
    expect(decide(candidate())).toEqual({ reuse: true });
  });

  it.each([
    ["another revision", { source: { ...SOURCE, revision: "b".repeat(40) } }, "revision"],
    ["another tracked diff", { source: { ...SOURCE, diffSha256: sha256("diff") } }, "diff"],
    ["other build inputs", { source: { ...SOURCE, inputs: [{ path: "src/app/page.tsx", sha256: sha256("changed") }] } }, "inputs"],
    ["another backend origin", { backendOrigin: "http://127.0.0.1:61235" }, "origin"],
    ["another anon key", { anonKey: `${ANON_KEY}x` }, "anon key"],
    ["another Node version", { runtime: { ...RUNTIME, node: "v26.11.0" } }, "runtime"],
    ["another platform", { runtime: { ...RUNTIME, platform: "darwin" } }, "runtime"],
    ["another architecture", { runtime: { ...RUNTIME, arch: "arm64" } }, "runtime"],
  ])("builds locally for %s", (_, shard, reason) => {
    const decision = decide(candidate(), shard);
    expect(decision.reuse).toBe(false);
    expect(decision.reuse ? "" : decision.reason).toContain(reason);
  });

  it.each([
    ["a failed build step", { build: { steps: buildCommands.map((args, index) => ({ args, exitCode: index === 1 ? 1 : 0 })) } }, "steps"],
    ["other build commands", { build: { steps: buildCommands.slice(1).map((args) => ({ args, exitCode: 0 })) } }, "steps"],
    ["sources changed during the build", { build: { sourceChangedDuringBuild: true } }, "changed during"],
    ["inputs changed during the build", { build: { inputsAfter: [] } }, "changed during"],
    ["another manifest schema", { build: { schemaVersion: "army-local-build-0" } }, "schema"],
    ["a prebuilt record of another schema", { prebuilt: { schemaVersion: "army-prebuilt-build-0" } }, "schema"],
    ["a build manifest the build job did not record", { prebuilt: { buildManifestSha256: sha256("other") } }, "manifest"],
    ["an inconsistent output closure", { build: { compiledOutput: { ...OUTPUT, digest: sha256("other") } } }, "output"],
    ["an empty output closure", { build: { compiledOutput: { ...OUTPUT, inputs: [], digest: sha256("[]") } } }, "output"],
    ["an output digest the build job did not record", { prebuilt: { compiledOutputDigest: sha256("other") } }, "output"],
    ["a build manifest of another backend", { build: { backend: "http://127.0.0.1:61235" } }, "origin"],
  ] as Array<[string, { build?: Record<string, unknown>; prebuilt?: Record<string, unknown> }, string]>)("builds locally for %s", (_, overrides, reason) => {
    const value = candidate(overrides);
    // A prebuilt record is written from the build manifest: keep the two consistent unless the case is about that link.
    if (overrides.build && !("buildManifestSha256" in (overrides.prebuilt ?? {}))) {
      value.buildManifestSha256 = sha256(JSON.stringify(value.build));
      value.prebuilt.buildManifestSha256 = value.buildManifestSha256;
    }
    const decision = decide(value);
    expect(decision.reuse).toBe(false);
    expect(decision.reuse ? "" : decision.reason).toContain(reason);
  });

  it("serves only files whose digest is the recorded output", () => {
    const value = candidate();
    expect(verifyInstalledOutput(value, OUTPUT)).toEqual({ reuse: true });
    const tampered = [OUTPUT_INPUTS[0], { ...OUTPUT_INPUTS[1], sha256: sha256("other") }];
    const decision = verifyInstalledOutput(value, { ...OUTPUT, inputs: tampered, digest: sha256(JSON.stringify(tampered)) });
    expect(decision).toMatchObject({ reuse: false, reason: expect.stringContaining("output digest") });
    expect(verifyInstalledOutput(value, { ...OUTPUT, inputs: OUTPUT_INPUTS.slice(0, 1), digest: sha256(JSON.stringify(OUTPUT_INPUTS.slice(0, 1))) }))
      .toMatchObject({ reuse: false });
  });
});

describe("prebuilt build download", () => {
  const directories: string[] = [];
  const temporary = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-prebuilt-test-"));
    directories.push(directory);
    return directory;
  };
  afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

  it("turns a missing or broken download into a reason to build, never an error", () => {
    expect(readPrebuiltCandidate(undefined)).toMatchObject({ reason: expect.stringContaining("no prebuilt") });
    expect(readPrebuiltCandidate("")).toMatchObject({ reason: expect.stringContaining("no prebuilt") });
    const empty = temporary();
    expect(readPrebuiltCandidate(path.join(empty, "absent"))).toMatchObject({ reason: expect.stringContaining("not downloaded") });
    expect(readPrebuiltCandidate(empty)).toMatchObject({ reason: expect.stringContaining("prebuilt.json") });
    fs.writeFileSync(path.join(empty, "prebuilt.json"), "{not json");
    expect(readPrebuiltCandidate(empty)).toMatchObject({ reason: expect.stringContaining("unreadable") });
    fs.writeFileSync(path.join(empty, "prebuilt.json"), JSON.stringify({ schemaVersion: PREBUILT_SCHEMA, buildDirectoryName: "../escape" }));
    expect(readPrebuiltCandidate(empty)).toMatchObject({ reason: expect.stringContaining("unreadable") });
  });

  it("reads a complete download and records which build manifest it carries", () => {
    const directory = temporary();
    const value = candidate();
    fs.mkdirSync(path.join(directory, "build"), { recursive: true });
    const bytes = JSON.stringify(value.build);
    fs.writeFileSync(path.join(directory, "build/manifest.json"), bytes);
    fs.writeFileSync(path.join(directory, "prebuilt.json"), JSON.stringify({ ...value.prebuilt, buildDirectoryName: "2026-11-24-build" }));
    const read = readPrebuiltCandidate(directory);
    expect("candidate" in read && read.candidate.buildManifestSha256).toBe(sha256(bytes));
    expect("candidate" in read && read.candidate.buildDirectoryName).toBe("2026-11-24-build");
  });

  it("installs the downloaded output beside the build cache and removes it again on refusal", async () => {
    const root = temporary();
    const download = temporary();
    const dist = path.join(root, ".build/tester-army/next");
    fs.mkdirSync(path.join(dist, "cache/webpack"), { recursive: true });
    fs.writeFileSync(path.join(dist, "cache/webpack/pack"), "cache");
    fs.mkdirSync(path.join(dist, "server"), { recursive: true });
    fs.writeFileSync(path.join(dist, "server/stale.js"), "stale");
    fs.mkdirSync(path.join(download, "next/server/app"), { recursive: true });
    fs.writeFileSync(path.join(download, "next/BUILD_ID"), "build-1");
    fs.writeFileSync(path.join(download, "next/server/app/page.js"), "page");
    fs.mkdirSync(path.join(download, "build"), { recursive: true });
    fs.writeFileSync(path.join(download, "build/manifest.json"), "{}");
    fs.writeFileSync(path.join(download, "build/build.log"), "log");

    await installPrebuiltOutput({ directory: download, buildDirectoryName: "2026-11-24-build" }, root);
    expect(fs.readFileSync(path.join(dist, "BUILD_ID"), "utf8")).toBe("build-1");
    expect(fs.existsSync(path.join(dist, "server/stale.js"))).toBe(false);
    expect(fs.readFileSync(path.join(dist, "cache/webpack/pack"), "utf8")).toBe("cache");
    // The retained evidence keeps the manifest and log of the build it served.
    expect(fs.readFileSync(path.join(root, ".e2e/army/recipes/builds/2026-11-24-build/manifest.json"), "utf8")).toBe("{}");
    expect(fs.readFileSync(path.join(root, ".e2e/army/recipes/builds/2026-11-24-build/build.log"), "utf8")).toBe("log");

    removeInstalledOutput(root, "2026-11-24-build");
    expect(fs.readdirSync(dist)).toEqual(["cache"]);
    expect(fs.existsSync(path.join(root, ".e2e/army/recipes/builds/2026-11-24-build"))).toBe(false);
  });
});

describe("whether a calc-v3 run needs the production build", () => {
  it("builds only for a selection with a production phase", () => {
    expect(calcV3NeedsProductionBuild([])).toBe(false);
    expect(calcV3NeedsProductionBuild(["journeys"])).toBe(true);
    expect(calcV3NeedsProductionBuild(["all"])).toBe(true);
    expect(calcV3NeedsProductionBuild(["mobile"])).toBe(true);
  });
});

// The workflow side: one build job per Army workflow, beside its plan; every sharded job waits for it, never fails or
// skips because of it, downloads its artifact without failing and hands it to the runner.
describe("prebuilt build workflow wiring", () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
  const jobBlocks = (workflow: string) => {
    const body = workflow.slice(workflow.search(/^jobs:\s*$/mu));
    const parts = body.split(/^ {2}([A-Za-z0-9_-]+):\s*$/mu).slice(1);
    const jobs: Record<string, string> = {};
    for (let index = 0; index < parts.length; index += 2) jobs[parts[index]] = parts[index + 1];
    return jobs;
  };
  const steps = (job: string) => job.split(/^\s+- name:/mu).slice(1);
  const step = (job: string, name: string) => {
    const found = steps(job).filter((value) => value.trimStart().startsWith(name));
    expect(found, name).toHaveLength(1);
    return found[0];
  };
  /** The block scalar of a step's `run: |`. */
  const runScript = (value: string) => {
    const lines = value.split("\n");
    const start = lines.findIndex((line) => /^\s+run: \|$/u.test(line));
    const indent = lines[start + 1].search(/\S/u);
    const body: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() && line.search(/\S/u) < indent) break;
      body.push(line.slice(indent));
    }
    return body.join("\n");
  };
  const workflows = [
    { file: ".github/workflows/e2e-army-critical.yml", build: "army-build", plan: "army-select", units: ["army-critical-shard", "army-takeoff-shard"], selects: true },
    { file: ".github/workflows/e2e-army-calc-v3.yml", build: "army-calc-v3-build", plan: "army-calc-v3-plan", units: ["army-calc-v3-group"], selects: true },
    { file: ".github/workflows/e2e-army-full.yml", build: "army-full-build", plan: "army-full-plan", units: ["army-full-shard"], selects: false },
  ];

  it.each(workflows)("builds once in $build, beside the plan, and publishes it for one day", ({ file, build, selects }) => {
    const job = jobBlocks(read(file))[build];
    expect(job).toBeDefined();
    // In parallel with the plan: it needs nothing.
    expect(job).not.toMatch(/^ {4}needs:/mu);
    expect(job).toContain("\n      built: ${{ steps.published.outputs.built }}\n");
    expect(steps(job)[0]).toMatch(/^\s+id: target_guard$/mu);
    const run = step(job, "Build the production application once for this run");
    expect(run).toContain('run: node --import tsx scripts/tester-army/army-build.ts --out "$RUNNER_TEMP/army-prebuilt"');
    expect(run.includes("if: steps.need.outputs.build == 'true'")).toBe(selects);
    const upload = step(job, "Publish the production build to this run's jobs");
    expect(upload).toContain("if: steps.build.outcome == 'success'");
    expect(upload).toContain("\n          name: army-prebuilt-build\n");
    expect(upload).toContain("\n          path: ${{ runner.temp }}/army-prebuilt\n");
    expect(upload).toContain("\n          retention-days: 1\n");
    expect(upload).toContain("\n          overwrite: true\n");
    // The build keeps the Next build cache main saved.
    expect(step(job, "Restore the Army Next build cache")).toContain("path: .build/tester-army/next/cache");
    // The output is offered only once it is published.
    const steps_ = steps(job).map((value) => value.trimStart().split("\n")[0]);
    expect(steps_.indexOf("Offer the build to this run's jobs")).toBe(steps_.indexOf("Publish the production build to this run's jobs") + 1);
  });

  it.each(workflows)("makes the jobs of $file wait for the build, tolerate its absence and hand it to the runner", ({ file, build, plan, units }) => {
    const jobs = jobBlocks(read(file));
    for (const name of units) {
      const unit = jobs[name];
      expect(unit, name).toMatch(new RegExp(`^ {4}needs: \\[${plan}, ${build}\\]$`, "mu"));
      // !cancelled(): a failed build job never skips a shard; the plan alone decides.
      const condition = /^ {4}if: (.*)$/mu.exec(unit)?.[1] ?? "";
      expect(condition, name).toMatch(/^\$\{\{ !cancelled\(\) && /u);
      expect(condition, name).toContain(`needs.${plan}.result == 'success'`);
      expect(condition, name).not.toContain(build);
      const download = step(unit, "Download the production build of this run");
      expect(download).toMatch(/^\s+id: prebuilt$/mu);
      expect(download).toContain(`if: needs.${build}.outputs.built == 'true'`);
      expect(download).toMatch(/^\s+continue-on-error: true$/mu);
      expect(download).toContain("uses: actions/download-artifact@");
      expect(download).toContain("\n          name: army-prebuilt-build\n          path: ${{ runner.temp }}/army-prebuilt\n");
      // A job that builds after all still restores the Next build cache.
      expect(step(unit, "Restore the Army Next build cache")).toContain("if: steps.prebuilt.outcome != 'success'");
      const order = steps(unit).map((value) => value.trimStart().split("\n")[0]);
      expect(order.indexOf("Download the production build of this run")).toBeLessThan(order.indexOf("Restore the Army Next build cache"));
      const journeys = step(unit, "Run native database and TesterArmy");
      expect(journeys).toContain("\n          ARMY_PREBUILT_BUILD_DIR: ${{ runner.temp }}/army-prebuilt\n");
      // The Next build cache is saved by the job that builds once, never by a shard.
      expect(unit).not.toContain("Save the Army Next build cache");
    }
    // The development job of the Full campaign runs next dev: it neither waits for nor reads the build.
    if (jobs["army-full-development"]) {
      expect(jobs["army-full-development"]).toMatch(/^ {4}needs: army-full-plan$/mu);
      expect(jobs["army-full-development"]).not.toContain("army-prebuilt");
    }
  });

  // The shell of each "need" step, with git and node stubbed: what makes a run build, or not.
  const directories: string[] = [];
  afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
  function runNeed(script: string, env: Record<string, string>, stubs: { git: string; node: string }) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-build-need-"));
    directories.push(directory);
    fs.writeFileSync(path.join(directory, "git"), `#!/bin/sh\n${stubs.git}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(directory, "node"), `#!/bin/sh\n${stubs.node}\n`, { mode: 0o755 });
    const output = path.join(directory, "github-output");
    fs.writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", script], { cwd: directory, encoding: "utf8",
      env: { NODE_ENV: "test", PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`, RUNNER_TEMP: directory, GITHUB_OUTPUT: output, ...env } });
    expect(result.status, result.stderr).toBe(0);
    return fs.readFileSync(output, "utf8").trim();
  }

  it.skipIf(process.platform === "win32")("builds for critical unless the pull request's own selection reaches no journey", () => {
    const script = runScript(step(jobBlocks(read(".github/workflows/e2e-army-critical.yml"))["army-build"], "Decide whether this run needs the production build"));
    // HEAD^2 is the pull request head; the selector stub writes its outputs as select-journeys.ts does.
    const git = 'case "$*" in *"HEAD^2"*) echo head-sha ;; *) echo some-sha ;; esac';
    const selector = (critical: string, takeoff: string, exit = 0) =>
      `printf 'mode=%s\\nfull_only_mode=%s\\n' ${critical} ${takeoff} >> "$GITHUB_OUTPUT"; exit ${exit}`;
    const pr = { EVENT_NAME: "pull_request", PR_HEAD_SHA: "head-sha", ARMY_FULL_LABEL: "false" };
    expect(runNeed(script, pr, { git, node: selector("none", "none") })).toBe("build=false");
    expect(runNeed(script, pr, { git, node: selector("filtered", "none") })).toBe("build=true");
    expect(runNeed(script, pr, { git, node: selector("none", "filtered") })).toBe("build=true");
    // A selector error, the label, a checkout that is not the merge commit and any other event build.
    expect(runNeed(script, pr, { git, node: selector("none", "none", 1) })).toBe("build=true");
    expect(runNeed(script, { ...pr, ARMY_FULL_LABEL: "true" }, { git, node: selector("none", "none") })).toBe("build=true");
    expect(runNeed(script, { ...pr, PR_HEAD_SHA: "other" }, { git, node: selector("none", "none") })).toBe("build=true");
    expect(runNeed(script, { ...pr, EVENT_NAME: "push" }, { git, node: selector("none", "none") })).toBe("build=true");
  });

  it.skipIf(process.platform === "win32")("builds for calc-v3 only when a selected phase runs under next start", () => {
    const script = runScript(step(jobBlocks(read(".github/workflows/e2e-army-calc-v3.yml"))["army-calc-v3-build"], "Decide whether a selected phase needs the production build"));
    // The plan stub writes phases as select-calc-v3.ts does; the real decision then reads them.
    const node = (phases: string, exit = 0) => [
      'case "$*" in',
      `  *select-calc-v3.ts*) printf 'phases=%s\\n' '${phases}' >> "$GITHUB_OUTPUT"; exit ${exit} ;;`,
      `  *) exec "${process.execPath}" --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "${path.join(process.cwd(), "scripts/tester-army/prebuilt-build.ts")}" "$3" "$4" ;;`,
      "esac",
    ].join("\n");
    expect(runNeed(script, {}, { git: "exit 1", node: node('["journeys","mobile"]') })).toBe("build=true");
    expect(runNeed(script, {}, { git: "exit 1", node: node("[]") })).toBe("build=false");
    expect(runNeed(script, {}, { git: "exit 1", node: node("[]", 1) })).toBe("build=true");
  });
});
