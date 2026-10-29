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
  it("resolves dotted runtime module names without treating assets or type-only imports as dependencies", () => {
    const rootDirectory = createFixture({
      "src/entry.ts": [
        'export * from "./editor.impl";',
        'import { value } from "@/panel.logic";',
        'import { enabled } from "./panel.model";',
        'import { review } from "./panel.review-logic";',
        'import { delay } from "./controller.types";',
        'import type { Shape } from "./shapes.types";',
        'import { type OtherShape } from "./other.types";',
        'import "./styles.css";',
        "export async function load() { return import('./lazy.impl'); }",
        "export const result = value + delay + Number(enabled) + review;",
        "export type Combined = Shape & OtherShape;",
      ].join("\n"),
      "src/editor.impl.ts": "export const editor = 1;\n",
      "src/panel.logic.ts": "export const value = 2;\n",
      "src/panel.model.ts": "export const enabled = true;\n",
      "src/panel.review-logic.ts": "export const review = 3;\n",
      "src/controller.types.ts": "export const delay = 60;\n",
      "src/lazy.impl.ts": "export const lazy = 4;\n",
      "src/shapes.types.ts": "export interface Shape { id: string }\n",
      "src/other.types.ts": "export interface OtherShape { label: string }\n",
      "src/styles.css": "body { color: black; }\n",
    });

    const analysis = analyzeArchitecture({ config: config(), rootDirectory });
    const entry = analysis.modules.find((module) => module.path === "src/entry.ts");

    expect(entry?.runtimeDependencies).toEqual([
      "src/controller.types.ts",
      "src/editor.impl.ts",
      "src/lazy.impl.ts",
      "src/panel.logic.ts",
      "src/panel.model.ts",
      "src/panel.review-logic.ts",
    ]);
    expect(analysis.cycles).toEqual([]);
  });

  it("rejects a runtime cycle passing through an extensionless dotted module", () => {
    const rootDirectory = createFixture({
      "src/entry.ts": 'export * from "./editor.impl";\n',
      "src/editor.impl.ts": 'import "@/entry";\nexport const editor = 1;\n',
    });
    const budgetConfig = config();

    const result = validateArchitectureBudgets(
      analyzeArchitecture({ config: budgetConfig, rootDirectory }),
      budgetConfig
    );

    expect(result.errors).toEqual([
      "new or expanded runtime dependency cycle: src/editor.impl.ts <-> src/entry.ts",
    ]);
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
});
