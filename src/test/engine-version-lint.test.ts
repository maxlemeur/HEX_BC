import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Lot 2, sous-lot 2.1 (docs/testing/estimate-engine-v3-2.1.md, F-TS-09). Garde-fou de CI :
// une comparaison brute du moteur à un littéral (`=== 2`, `!== 1`…) traite une v3 comme une
// v1 ou une v2 sans erreur de typage quand elle porte sur un champ brut. La règle ESLint doit
// la refuser partout, sauf dans la liste blanche revue. Un sélecteur mal écrit laisserait la
// garde muette : ce test lint des sources virtuelles avec la vraie configuration du dépôt.
const eslint = new ESLint({ cwd: process.cwd() });

const rawComparisons = [
  "export const a = (version: { calc_engine_version: number }) => version.calc_engine_version === 2;",
  "export const b = (row: { calcEngineVersion: number }) => row.calcEngineVersion !== 1;",
  "export const c = (calcEngineVersion: number) => calcEngineVersion == 3;",
  "export const d = (engine: number) => 2 === engine;",
  "declare function resolveCalcEngineVersion(v: unknown): number;\nexport const e = (v: unknown) => resolveCalcEngineVersion(v) === 2;",
];

async function engineLiteralMessages(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter(
    (message) => message.ruleId === "no-restricted-syntax" && /engine/i.test(message.message)
  );
}

describe("ESLint calculation-engine literal guard", () => {
  it.each(rawComparisons)("refuses a raw engine comparison in application code: %s", async (code) => {
    expect(await engineLiteralMessages(code, "src/lib/estimates/v3-guard-probe.ts")).toHaveLength(1);
  }, 60_000);

  it("refuses it in route handlers, whose rule options replace the src-wide block", async () => {
    expect(
      await engineLiteralMessages(rawComparisons[0], "src/app/api/estimates/[versionId]/v3-guard-probe/route.ts")
    ).toHaveLength(1);
  }, 60_000);

  it.each([
    "src/lib/estimates/calc-engine-version.ts",
    "src/lib/estimates/engine/compute.ts",
    "src/lib/estimates/engine-v3/line.ts",
    "src/lib/estimate-calculations.ts",
    "src/lib/estimate-v2-snapshot.ts",
    "src/lib/estimates/v3-guard-probe.test.ts",
  ])("allows the reviewed whitelist %s", async (filePath) => {
    expect(await engineLiteralMessages(rawComparisons[0], filePath)).toEqual([]);
  }, 60_000);

  it("allows exhaustive switches and unrelated numeric comparisons", async () => {
    const code = [
      "export function f(engine: 1 | 2 | 3, items: unknown[]) {",
      "  switch (engine) { case 1: return items.length === 2; case 2: return 2; case 3: return 3; }",
      "}",
    ].join("\n");
    expect(await engineLiteralMessages(code, "src/lib/estimates/v3-guard-probe.ts")).toEqual([]);
  }, 60_000);
});
