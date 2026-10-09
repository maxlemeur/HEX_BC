import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertPerformanceBudget,
  measurePerformanceBudget,
  type PerformanceBudget,
} from "@/test/performance-budgets";

// Browser E2E never invokes the filesystem release gate. Real file fixtures
// protect against malformed manifests and silently missing/double-counted JS.
// Failure modes were recorded before implementation in the capture evidence.
const temporaryRoot = path.resolve(os.tmpdir());
const temporaryDirectories: string[] = [];
const manifestFile = "server/app/editor/page_client-reference-manifest.js";
const chunkA = "export const a = 1;";
const chunkB = "export const b = 2;";
const budget: PerformanceBudget = {
  name: "editor",
  manifest: manifestFile,
  maxRawBytes: 1_000,
  maxGzipBytes: 1_000,
};
type AssignmentStyle = "spaced" | "compact" | "multiline";

function writeManifest(
  directory: string,
  manifest: unknown,
  style: AssignmentStyle = "spaced"
) {
  const assignments = { spaced: " = ", compact: "=", multiline: "\n\t=\n" };
  fs.writeFileSync(
    path.join(directory, manifestFile),
    "globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});" +
      'globalThis.__RSC_MANIFEST["/editor/page"]' +
      assignments[style] + JSON.stringify(manifest) + ";"
  );
}

function createBuildFixture() {
  const directory = fs.mkdtempSync(
    path.join(temporaryRoot, "performance-budgets-")
  );
  temporaryDirectories.push(directory);
  const chunkDirectory = path.join(directory, "static", "chunks");
  const manifestDirectory = path.join(directory, "server", "app", "editor");
  fs.mkdirSync(chunkDirectory, { recursive: true });
  fs.mkdirSync(manifestDirectory, { recursive: true });
  fs.writeFileSync(path.join(chunkDirectory, "a.js"), chunkA);
  fs.writeFileSync(path.join(chunkDirectory, "b.js"), chunkB);
  writeManifest(directory, { clientModules: {
    first: { chunks: ["/_next/static/chunks/a.js"] },
    second: { chunks: ["/_next/static/chunks/a.js", "/_next/static/chunks/b.js"] },
  } });
  return directory;
}

function measure(buildDirectory: string, limits: Partial<PerformanceBudget> = {}) {
  return measurePerformanceBudget({ buildDirectory, budget: { ...budget, ...limits } });
}

function expectedSizes(contents: string[]) {
  return {
    rawBytes: contents.reduce((sum, content) => sum + Buffer.byteLength(content), 0),
    gzipBytes: contents.reduce((sum, content) => sum + gzipSync(content).byteLength, 0),
  };
}

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    if (path.dirname(directory) !== temporaryRoot || !path.basename(directory).startsWith("performance-budgets-")) {
      throw new Error("Refusing to remove an unrelated temporary directory.");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("performance budgets", () => {
  it.each<AssignmentStyle>(["spaced", "compact", "multiline"])("measures exact deduplicated bytes for a %s assignment", (style) => {
    const buildDirectory = createBuildFixture();
    writeManifest(buildDirectory, { clientModules: {
      empty: { chunks: [] },
      first: { chunks: ["19", "static/chunks/a.js", "static/css/ignored.css"] },
      second: { chunks: ["19", "/_next/static/chunks/a.js", "20", "static/chunks/b.js"] },
    } }, style);
    const measurement = measure(buildDirectory);
    expect(measurement).toEqual({
      name: "editor", chunkCount: 2, ...expectedSizes([chunkA, chunkB]),
      maxRawBytes: 1_000, maxGzipBytes: 1_000,
    });
    expect(() => assertPerformanceBudget(measurement)).not.toThrow();
  });

  it("keeps assignment-like JSON data out of the parser's split point", () => {
    const buildDirectory = createBuildFixture();
    writeManifest(buildDirectory, { clientModules: {
      "module] = data": { chunks: ["static/chunks/a.js"] },
    } });
    expect(measure(buildDirectory)).toMatchObject({ chunkCount: 1, ...expectedSizes([chunkA]) });
  });

  it("decodes dynamic paths once and deduplicates their encoded/literal spellings", () => {
    const buildDirectory = createBuildFixture();
    const routeContent = "export const route = 3;";
    const directory = path.join(buildDirectory, "static/chunks/app/[versionId]");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "page% name.js"), routeContent);
    writeManifest(buildDirectory, { clientModules: {
      first: { chunks: ["37", "static/chunks/app/%5BversionId%5D/page%25%20name.js"] },
      second: { chunks: ["/_next/static/chunks/app/[versionId]/page%25%20name.js", "static/chunks/a.js"] },
    } });
    expect(measure(buildDirectory)).toMatchObject({ chunkCount: 2, ...expectedSizes([routeContent, chunkA]) });
  });

  it("counts JS paths with Next deployment query tokens", () => {
    const buildDirectory = createBuildFixture();
    writeManifest(buildDirectory, { clientModules: {
      first: { chunks: ["19", "static/chunks/a.js?dpl=fixture"] },
      second: { chunks: ["/_next/static/chunks/a.js?dpl=fixture", "static/chunks/b.js"] },
    } });
    expect(measure(buildDirectory)).toMatchObject({ chunkCount: 2, ...expectedSizes([chunkA, chunkB]) });
  });

  it.each(["manifest", "chunk"])("rejects a missing %s instead of skipping it", (missing) => {
    const buildDirectory = createBuildFixture();
    fs.unlinkSync(path.join(buildDirectory, missing === "manifest" ? manifestFile : "static/chunks/b.js"));
    expect(() => measure(buildDirectory)).toThrow(/ENOENT/);
  });

  it.each([
    ["missing assignment", "globalThis.__RSC_MANIFEST={};"],
    ["unrelated assignment", 'globalThis.other["/editor/page"] = {"clientModules":{"first":{"chunks":["static/chunks/a.js"]}}};'],
    ["malformed JSON", 'globalThis.__RSC_MANIFEST["/editor/page"] = {broken};'],
    ["trailing JavaScript", 'globalThis.__RSC_MANIFEST["/editor/page"] = {}; throw new Error("executed");'],
  ])("rejects %s without evaluating the manifest", (_label, source) => {
    const buildDirectory = createBuildFixture();
    fs.writeFileSync(path.join(buildDirectory, manifestFile), source);
    expect(() => measure(buildDirectory)).toThrow();
  });

  const invalidManifests: [string, unknown][] = [
    ["null root", null], ["array root", []], ["scalar root", 42],
    ["missing module map", {}], ["null module map", { clientModules: null }],
    ["array module map", { clientModules: [] }], ["scalar module map", { clientModules: "invalid" }],
    ["empty module map", { clientModules: {} }],
    ["missing measurable JS", { clientModules: { first: { chunks: ["19", "static/css/only.css"] } } }],
    ...([
      ["null module", null], ["array module", []], ["scalar module", 42],
      ["missing chunks", {}], ["non-array chunks", { chunks: "static/chunks/a.js" }],
      ["non-string chunk", { chunks: ["static/chunks/b.js", null] }],
    ] satisfies [string, unknown][]).map(([label, broken]): [string, unknown] => [label, { clientModules: {
      first: { chunks: ["static/chunks/a.js"] }, broken,
    } }]),
  ];
  it.each(invalidManifests)("rejects %s rather than returning incomplete bytes", (_label, manifest) => {
    const buildDirectory = createBuildFixture();
    writeManifest(buildDirectory, manifest);
    expect(() => measure(buildDirectory)).toThrow(/Invalid Next.js client reference manifest/);
  });

  it.each([
    "static/chunks/bad%ZZ.js", "static/chunks/../../outside.js",
    "/_next/static/chunks/../../outside.js", "static/chunks/%2e%2e/%2e%2e/outside.js",
    "static/chunks/..\\..\\outside.js", "https://example.invalid/outside.js",
  ])("rejects an invalid or escaping chunk path: %s", (chunk) => {
    const buildDirectory = createBuildFixture();
    fs.writeFileSync(path.join(buildDirectory, "outside.js"), "export const outside = 0;");
    writeManifest(buildDirectory, { clientModules: { first: { chunks: [chunk] } } });
    expect(() => measure(buildDirectory)).toThrow(/Invalid Next.js client chunk path/);
  });

  it("keeps the ceiling enforced after parsing a compact Webpack route", () => {
    const buildDirectory = createBuildFixture();
    writeManifest(buildDirectory, { clientModules: { first: { chunks: ["static/chunks/a.js"] } } }, "compact");
    expect(() => assertPerformanceBudget(measure(buildDirectory, { maxRawBytes: 1 }))).toThrow(/raw/);
  });

  it("fails when a configured ceiling is exceeded", () => {
    expect(() =>
      assertPerformanceBudget({
        name: "editor",
        chunkCount: 1,
        rawBytes: 101,
        gzipBytes: 51,
        maxRawBytes: 100,
        maxGzipBytes: 50,
      })
    ).toThrow(/Performance budget failed for editor: raw 101 > 100 bytes, gzip 51 > 50 bytes/);
  });
});
