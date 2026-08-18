import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertPerformanceBudget,
  measurePerformanceBudget,
} from "@/test/performance-budgets";

const temporaryDirectories: string[] = [];

function createBuildFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "performance-budgets-")
  );
  temporaryDirectories.push(directory);
  const chunkDirectory = path.join(directory, "static", "chunks");
  const manifestDirectory = path.join(directory, "server", "app", "editor");
  fs.mkdirSync(chunkDirectory, { recursive: true });
  fs.mkdirSync(manifestDirectory, { recursive: true });
  fs.writeFileSync(path.join(chunkDirectory, "a.js"), "export const a = 1;");
  fs.writeFileSync(path.join(chunkDirectory, "b.js"), "export const b = 2;");
  fs.writeFileSync(
    path.join(manifestDirectory, "page_client-reference-manifest.js"),
    'globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n' +
      'globalThis.__RSC_MANIFEST["/editor/page"] = ' +
      JSON.stringify({
        clientModules: {
          first: { chunks: ["/_next/static/chunks/a.js"] },
          second: {
            chunks: [
              "/_next/static/chunks/a.js",
              "/_next/static/chunks/b.js",
            ],
          },
        },
      }) +
      ";"
  );
  return directory;
}

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("performance budgets", () => {
  it("deduplicates route chunks and measures raw and gzip sizes", () => {
    const buildDirectory = createBuildFixture();
    const measurement = measurePerformanceBudget({
      buildDirectory,
      budget: {
        name: "editor",
        manifest: "server/app/editor/page_client-reference-manifest.js",
        maxRawBytes: 1_000,
        maxGzipBytes: 1_000,
      },
    });

    expect(measurement.chunkCount).toBe(2);
    expect(measurement.rawBytes).toBeGreaterThan(0);
    expect(measurement.gzipBytes).toBeGreaterThan(0);
    expect(() => assertPerformanceBudget(measurement)).not.toThrow();
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
    ).toThrow(/Performance budget failed for editor/);
  });
});
