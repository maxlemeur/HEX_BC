import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readCatalogueSuggestionsSource() {
  return fs.readFileSync(
    path.resolve(
      process.cwd(),
      "src/components/estimates/components/estimate-editor-row/useCatalogueSuggestions.ts"
    ),
    "utf8"
  );
}

describe("EstimateEditorRow catalogue regressions", () => {
  const source = readCatalogueSuggestionsSource();

  it("aborts in-flight catalogue requests in debounce cleanup", () => {
    expect(source).toMatch(
      /return \(\) => \{\s*window\.clearTimeout\(timeoutId\);\s*if \(catalogueAbortRef\.current\) \{\s*catalogueAbortRef\.current\.abort\(\);\s*\}\s*\};/
    );
  });

  it("keeps a single persisted write path when applying suggestions", () => {
    const applyStart = source.indexOf("const applyCatalogueSuggestion = useCallback(");
    const applyEnd = source.indexOf("const handleLineTitleFocus = useCallback(", applyStart);

    expect(applyStart).toBeGreaterThan(-1);
    expect(applyEnd).toBeGreaterThan(applyStart);

    const applyBlock = source.slice(applyStart, applyEnd);
    expect(applyBlock).toContain("onPatchItem(item.id, patch, { persist: true });");
    expect(applyBlock).not.toContain("updateEstimateItem(");
  });
});
