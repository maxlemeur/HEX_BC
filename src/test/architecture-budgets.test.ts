import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  analyzeArchitecture,
  type ArchitectureBudgetConfig,
  validateArchitectureBudgets,
} from "@/test/architecture-budgets";

const temporaryDirectories: string[] = [];

function createFixture(files: Record<string, string>) {
  const rootDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "architecture-budgets-")
  );
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(
    path.join(rootDirectory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "esnext",
        moduleResolution: "bundler",
        paths: { "@/*": ["./src/*"] },
        target: "esnext",
      },
      include: ["src/**/*.ts", "src/**/*.tsx"],
    }),
    "utf8"
  );
  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = path.join(rootDirectory, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, source, "utf8");
  }
  return rootDirectory;
}

function config(
  overrides: Partial<ArchitectureBudgetConfig> = {}
): ArchitectureBudgetConfig {
  return {
    version: 1,
    sourceDirectory: "src",
    excludedModulePaths: [],
    allowedCycles: [],
    hotspotNonEmptyLineBudgets: {},
    maxNewModuleNonEmptyLines: 100,
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("architecture budgets", () => {
  it("resolves relative and alias runtime imports while ignoring type-only and external imports", () => {
    const rootDirectory = createFixture({
      "src/a.ts": [
        'import { value } from "./b";',
        'import type { LocalType } from "./types";',
        'import { type AliasType } from "@/types";',
        'import { z } from "zod";',
        'import "./styles.css";',
        'export { lazyValue } from "@/lazy";',
        "export const result = value + z.string().parse('x').length;",
        "export async function load() { return import('./dynamic'); }",
        "export type Combined = LocalType & AliasType;",
      ].join("\n"),
      "src/b.ts": "export const value = 1;\n",
      "src/dynamic.ts": "export const dynamicValue = 2;\n",
      "src/lazy.ts": "export const lazyValue = 3;\n",
      "src/types.ts": "export interface LocalType { id: string }\nexport type AliasType = LocalType;\n",
    });

    const analysis = analyzeArchitecture({
      config: config(),
      rootDirectory,
    });
    const moduleA = analysis.modules.find((module) => module.path === "src/a.ts");

    expect(moduleA?.runtimeDependencies).toEqual([
      "src/b.ts",
      "src/dynamic.ts",
      "src/lazy.ts",
    ]);
    expect(analysis.cycles).toEqual([]);
  });

  it("allows only the exact baseline SCC and rejects its extension", () => {
    const rootDirectory = createFixture({
      "src/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
      "src/b.ts": 'import { a } from "@/a";\nexport const b = a;\n',
      "src/c.ts": "export const c = 1;\n",
    });
    const budgetConfig = config({ allowedCycles: [["src/a.ts", "src/b.ts"]] });

    const initial = validateArchitectureBudgets(
      analyzeArchitecture({ config: budgetConfig, rootDirectory }),
      budgetConfig
    );
    expect(initial.errors).toEqual([]);
    expect(initial.analysis.cycles).toEqual([["src/a.ts", "src/b.ts"]]);

    fs.writeFileSync(
      path.join(rootDirectory, "src", "b.ts"),
      'import { c } from "./c";\nexport const b = c;\n',
      "utf8"
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src", "c.ts"),
      'import { a } from "./a";\nexport const c = a;\n',
      "utf8"
    );

    const expanded = validateArchitectureBudgets(
      analyzeArchitecture({ config: budgetConfig, rootDirectory }),
      budgetConfig
    );
    expect(expanded.errors).toContain(
      "new or expanded runtime dependency cycle: src/a.ts <-> src/b.ts <-> src/c.ts"
    );
  });

  it("rejects a new runtime cycle outside the baseline", () => {
    const rootDirectory = createFixture({
      "src/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
      "src/b.ts": 'import { a } from "./a";\nexport const b = a;\n',
      "src/c.ts": 'import { d } from "./d";\nexport const c = d;\n',
      "src/d.ts": 'import { c } from "./c";\nexport const d = c;\n',
    });
    const budgetConfig = config({ allowedCycles: [["src/a.ts", "src/b.ts"]] });

    const result = validateArchitectureBudgets(
      analyzeArchitecture({ config: budgetConfig, rootDirectory }),
      budgetConfig
    );

    expect(result.errors).toContain(
      "new or expanded runtime dependency cycle: src/c.ts <-> src/d.ts"
    );
  });

  it("rejects growth beyond an explicit hotspot non-empty LOC budget", () => {
    const rootDirectory = createFixture({
      "src/hotspot.ts": "export const one = 1;\n\nexport const two = 2;\nexport const three = 3;\n",
    });
    const budgetConfig = config({
      hotspotNonEmptyLineBudgets: { "src/hotspot.ts": 2 },
    });

    const result = validateArchitectureBudgets(
      analyzeArchitecture({ config: budgetConfig, rootDirectory }),
      budgetConfig
    );

    expect(result.errors).toEqual([
      "hotspot grew beyond its non-empty LOC budget: src/hotspot.ts (3 > 2)",
    ]);
  });

  it("requires explicit budgets for legacy oversized modules and rejects new oversized modules", () => {
    const rootDirectory = createFixture({
      "src/generated.ts": "export const generated = 1;\nexport const ignored = 2;\n",
      "src/legacy.ts": "export const legacy = 1;\nexport const oversized = 2;\n",
      "src/new-module.ts": "export const one = 1;\nexport const two = 2;\n",
    });
    const budgetConfig = config({
      excludedModulePaths: ["src/generated.ts"],
      hotspotNonEmptyLineBudgets: { "src/legacy.ts": 2 },
      maxNewModuleNonEmptyLines: 1,
    });

    const result = validateArchitectureBudgets(
      analyzeArchitecture({ config: budgetConfig, rootDirectory }),
      budgetConfig
    );

    expect(result.errors).toEqual([
      "module exceeds the new-module non-empty LOC ceiling: src/new-module.ts (2 > 1)",
    ]);

    fs.appendFileSync(
      path.join(rootDirectory, "src", "legacy.ts"),
      "export const growth = 3;\n",
      "utf8"
    );
    const grown = validateArchitectureBudgets(
      analyzeArchitecture({ config: budgetConfig, rootDirectory }),
      budgetConfig
    );
    expect(grown.errors).toContain(
      "hotspot grew beyond its non-empty LOC budget: src/legacy.ts (3 > 2)"
    );
  });
});
