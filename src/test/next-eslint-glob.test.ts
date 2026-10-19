import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

import { ESLint } from "eslint";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { getRootDirs } = require("@next/eslint-plugin-next/dist/utils/get-root-dirs") as {
  getRootDirs: (context: { cwd: string; settings: { next?: { rootDir?: unknown } } }) => string[];
};

// Next normalizes rootDir separators to "/" before globbing, as fast-glob requires, so
// matched directories come back with forward slashes on Windows too.
const slashed = (directory: string) => directory.split(path.sep).join("/");

describe("Next ESLint directory glob compatibility", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mergeone-next-glob-"));
    for (const directory of ["apps/shop/nested", "apps/admin", "apps/.hidden", "docs"]) {
      fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    fs.writeFileSync(path.join(root, "apps", "note.txt"), "fixture");
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("keeps a literal root directory without adding its descendants", () => {
    const shop = path.join(root, "apps", "shop");
    expect(getRootDirs({ cwd: root, settings: { next: { rootDir: shop } } })).toEqual([slashed(shop)]);
  });

  it("preserves brace selections, array settings and directory-only results", () => {
    const actual = getRootDirs({ cwd: root, settings: { next: {
      rootDir: [path.join(root, "apps", "{shop,admin}"), path.join(root, "docs"), 1],
    } } });
    expect(actual.sort()).toEqual([
      path.join(root, "apps", "admin"), path.join(root, "apps", "shop"), path.join(root, "docs"),
    ].map(slashed).sort());
    expect(getRootDirs({ cwd: root, settings: { next: {
      rootDir: path.join(root, "apps", "*"),
    } } }).sort()).toEqual([path.join(root, "apps", "admin"), path.join(root, "apps", "shop")].map(slashed).sort());
    expect(getRootDirs({ cwd: root, settings: {} })).toEqual([root]);
  });

  it("keeps filesystem roots, literal path spelling and directory symlinks", () => {
    const shop = path.join(root, "apps", "shop");
    const link = path.join(root, "linked-shop");
    fs.symlinkSync(shop, link, "dir");
    for (const directory of [path.parse(root).root, shop + path.sep, link]) {
      expect(getRootDirs({ cwd: root, settings: { next: { rootDir: directory } } })).toEqual([slashed(directory)]);
    }
    const relative = "./" + path.relative(process.cwd(), root).split(path.sep).join("/");
    expect(getRootDirs({ cwd: root, settings: { next: { rootDir: relative } } })).toEqual([relative]);
  });

  it("excludes the base directories of terminal globstars", () => {
    expect(getRootDirs({ cwd: root, settings: { next: {
      rootDir: path.join(root, "apps", "{shop,admin}", "**"),
    } } })).toEqual([slashed(path.join(root, "apps", "shop", "nested"))]);
  });

  it("expands numeric, padded, stepped and nested brace ranges", () => {
    for (const directory of ["10", "11", "12", "01", "02", "03"]) {
      fs.mkdirSync(path.join(root, "apps", directory));
    }
    for (const [pattern, expected] of [
      ["{10..12}", ["10", "11", "12"]],
      ["{01..03}", ["01", "02", "03"]],
      ["{10..12..2}", ["10", "12"]],
      ["{12..10..2}", ["10", "12"]],
      ["{shop,{10..11}}", ["shop", "10", "11"]],
    ] as const) {
      expect(getRootDirs({ cwd: root, settings: { next: {
        rootDir: path.join(root, "apps", pattern),
      } } }).sort()).toEqual(expected.map((directory) => slashed(path.join(root, "apps", directory))).sort());
    }
  });

  it("treats ordinary parentheses as literal directory names", () => {
    const literal = path.join(root, "apps", "(shop)");
    expect(getRootDirs({ cwd: root, settings: { next: { rootDir: literal } } })).toEqual([]);
    fs.mkdirSync(literal);
    expect(getRootDirs({ cwd: root, settings: { next: { rootDir: literal } } })).toEqual([slashed(literal)]);
  });

  it("keeps descendants for repeated leading globstars", () => {
    const caller = require.resolve("@next/eslint-plugin-next/dist/utils/get-root-dirs");
    const result = spawnSync(process.execPath, ["-e", `
      const { getRootDirs } = require(${JSON.stringify(caller)});
      const matches = ["**", "**/**", "**/**/**", "./**/**"].map(rootDir =>
        getRootDirs({ cwd: process.cwd(), settings: { next: { rootDir } } }).sort());
      process.stdout.write(JSON.stringify(matches));
    `], { cwd: root, encoding: "utf8", timeout: 5_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const expected = ["apps", "apps/admin", "apps/shop", "apps/shop/nested", "docs"];
    expect(JSON.parse(result.stdout)).toEqual([
      expected, expected, expected, expected.map((directory) => "./" + directory),
    ]);
  });

  it("rejects excessive brace expansions explicitly", () => {
    for (const pattern of ["{a,b}".repeat(600), "{".repeat(100) + "a,b" + "}".repeat(100)]) {
      expect(() => getRootDirs({ cwd: root, settings: { next: { rootDir: pattern } } }))
        .toThrow(/Next ESLint root glob exceeds/);
    }
  });

  it("does not exhaust the stack on deeply nested brace patterns", () => {
    const result = spawnSync(process.execPath, ["-e", `
      try {
        require("@next/eslint-plugin-next/dist/utils/get-root-dirs").getRootDirs({
          cwd: process.cwd(), settings: { next: {
            rootDir: "{".repeat(4500) + "a,b" + "}".repeat(4500)
          } }
        });
      } catch (error) {
        if (error instanceof RangeError) {
          console.error(error.name);
          process.exitCode = 1;
        }
      }
    `], { encoding: "utf8", timeout: 5_000 });
    expect(result.error).toBeUndefined();
    expect(result.stderr).not.toContain("RangeError");
    expect(result.status).toBe(0);
  });
});

// Browser E2E cannot expose ESLint's filesystem selection. The local quality
// command linted independent Git worktrees nested under .claude/worktrees, so
// old sources there could block this checkout. Exercise the real config and
// lint engine, with a known root-source violation as the protection counterexample.
describe("project ESLint source discovery", () => {
  it("ignores nested agent worktrees while enforcing the active checkout's rules", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const activeFile = path.resolve("src/test/eslint-discovery-fixture.ts");
    const worktreeFile = path.resolve(".claude/worktrees/another-checkout/src/test/eslint-discovery-fixture.ts");
    const otherClaudeFile = path.resolve(".claude/hooks/eslint-discovery-fixture.ts");
    const violation = 'export const query = client.from("référence");\n';

    expect(await eslint.isPathIgnored(activeFile)).toBe(false);
    const active = await eslint.lintText(violation, { filePath: activeFile });
    expect(active[0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "no-restricted-syntax", severity: 2,
        message: "Supabase table, column and RPC names are ASCII. Keep accents in labels and data, never in query identifiers." }),
    ]));
    expect(await eslint.isPathIgnored(otherClaudeFile)).toBe(false);
    expect(await eslint.isPathIgnored(worktreeFile)).toBe(true);
    expect(await eslint.lintText(violation, { filePath: worktreeFile, warnIgnored: false })).toEqual([]);
  }, 10_000);
});
