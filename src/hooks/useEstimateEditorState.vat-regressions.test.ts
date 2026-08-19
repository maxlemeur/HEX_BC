import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/hooks/useEstimateEditorState.impl.tsx"),
  "utf8"
);
const calculationSource = readFileSync(
  join(process.cwd(), "src/hooks/useEstimateEditorCalculation.ts"),
  "utf8"
);
const itemsControllerSource = readFileSync(
  join(process.cwd(), "src/hooks/useEstimateEditorItemsController.ts"),
  "utf8"
);
const pasteControllerSource = readFileSync(
  join(process.cwd(), "src/hooks/useEstimateEditorPasteController.ts"),
  "utf8"
);

describe("estimate editor VAT reverse-charge persistence", () => {
  it("uses the saved contractor regime for autosaved totals", () => {
    expect(calculationSource).toMatch(
      /vatReverseCharge:\s*input\.settings\.contractor_role === "subcontractor"/
    );
    expect(calculationSource).toMatch(
      /if \(!savedSettings\) return null;[\s\S]*settings:\s*savedSettings,[\s\S]*\.totals;/
    );
  });

  it("passes the contractor regime to sent v2 read-only totals", () => {
    expect(calculationSource).toMatch(
      /return computeReadOnlyTotals\(\{[\s\S]*preserveStoredSnapshot:\s*true,[\s\S]*vatReverseCharge:\s*settings\.contractor_role === "subcontractor"/
    );
  });

  it("recomputes persisted line taxes when the contractor regime changes", () => {
    expect(source).toMatch(
      /settingsSnapshot\.contractor_role !==[\s\S]*versionSnapshot\.contractor_role/
    );
    expect(source).toMatch(
      /vatReverseCharge:\s*settingsSnapshot\.contractor_role === "subcontractor"/
    );
  });

  it("uses a zero effective line rate without erasing the nominal configured rate", () => {
    expect(calculationSource).toMatch(
      /const lineInput = buildLineCalculationInput\(item,[\s\S]*taxRateBp: options\.taxRateBp/
    );
    expect(calculationSource).toMatch(
      /taxRateBp: options\.vatReverseCharge \? 0 : options\.taxRateBp/
    );
  });

  it("creates and pastes lines with zero effective tax under reverse charge", () => {
    for (const controllerSource of [
      itemsControllerSource,
      pasteControllerSource,
    ]) {
      expect(controllerSource).toMatch(
        /settings\.contractor_role === "subcontractor"[\s\S]*\?\s*0[\s\S]*:\s*settings\.tax_rate_bp/
      );
      expect(controllerSource).toContain(
        "taxRateBp: effectiveTaxRateBp"
      );
    }
  });
});
