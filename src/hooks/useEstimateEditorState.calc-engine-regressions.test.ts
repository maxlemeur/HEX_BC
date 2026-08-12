import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  join(process.cwd(), "src/hooks/useEstimateEditorState.impl.tsx"),
  "utf8"
);
const calculationSource = readFileSync(
  join(process.cwd(), "src/hooks/useEstimateEditorCalculation.ts"),
  "utf8"
);

describe("estimate editor calculation engine", () => {
  it("resolves the engine stored on the active version", () => {
    expect(editorSource).toContain(
      "const calcEngineVersion = resolveCalcEngineVersion(version);"
    );
    expect(editorSource).not.toContain("EDITOR_CALC_ENGINE_VERSION");
  });

  it("uses the resolved engine for editable, persisted and read-only totals", () => {
    expect(calculationSource).toMatch(
      /computeReadOnlyTotals\(\{[\s\S]*calcEngineVersion,[\s\S]*preserveStoredSnapshot:\s*true/
    );
    expect(calculationSource).toContain("computeEstimateBreakdown({");
    expect(calculationSource.match(/computeDraftBreakdown\(\{/g)).toHaveLength(2);
    expect(calculationSource.match(/calcEngineVersion,/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("passes the same engine and version settings to section totals", () => {
    expect(editorSource).toMatch(
      /sectionCalculation:\s*\{[\s\S]*marginMode:[\s\S]*marginTiers:[\s\S]*globalCoefficient:[\s\S]*discountMode:[\s\S]*discountStepsBp:[\s\S]*calcEngineVersion,/
    );
  });

  it("projects v2 line net amounts into the editor without rewriting v1 items", () => {
    expect(calculationSource).toMatch(
      /if \(calcEngineVersion !== 2\) return items;[\s\S]*if \(isReadOnly\) \{[\s\S]*snapshot_pu_ht_cents[\s\S]*pu_ht_cents: item\.snapshot_pu_ht_cents/
    );
    expect(calculationSource).toMatch(
      /pu_ht_cents:\s*line\.puNetHtCents,[\s\S]*line_total_ht_cents:\s*line\.saleNetHtCents,[\s\S]*line_tax_cents:\s*line\.taxCents/
    );
    expect(editorSource).toContain("items: editorDisplayItems");
  });

  it("preserves explicit and inherited v2 line tax contracts while saving", () => {
    expect(editorSource).toMatch(
      /resolveCalcEngineVersion\(versionSnapshot\) === 2[\s\S]*item\.tax_rate_bp \?\? settingsSnapshot\.tax_rate_bp/
    );
    expect(editorSource).toMatch(
      /tax_rate_bp:[\s\S]*resolveCalcEngineVersion\(versionSnapshot\) === 2[\s\S]*\? item\.tax_rate_bp[\s\S]*: lineInput\.tax_rate_bp/
    );
  });
});
