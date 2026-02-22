import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readEstimateEditorTableSource() {
  return fs.readFileSync(
    path.resolve(process.cwd(), "src/components/estimates/EstimateEditorTable.tsx"),
    "utf8"
  );
}

describe("EstimateEditorTable clipboard regressions", () => {
  const source = readEstimateEditorTableSource();
  const copyStart = source.indexOf(
    "const copySelectedRowsToClipboard = useCallback(async () => {"
  );
  const copyEnd = source.indexOf("const toggleAllVisibleLines = useCallback(", copyStart);

  it("keeps h_mo_majoration clipboard export as coefficient values", () => {
    expect(copyStart).toBeGreaterThan(-1);
    expect(copyEnd).toBeGreaterThan(copyStart);

    const copyBlock = source.slice(copyStart, copyEnd);
    expect(copyBlock).toContain(
      "typeof item.h_mo_majoration === \"number\" ? item.h_mo_majoration : null"
    );
    expect(copyBlock).not.toContain("item.h_mo_majoration * 100");
  });

  it("falls back to execCommand when async clipboard write is unavailable", () => {
    const copyBlock = source.slice(copyStart, copyEnd);

    expect(copyBlock).toMatch(
      /if \(typeof navigator !== "undefined" && navigator\.clipboard\?\.writeText\) \{\s*try \{\s*await navigator\.clipboard\.writeText\(tsv\);\s*return;\s*\} catch \{/
    );
    expect(copyBlock).toContain("document.execCommand(\"copy\");");
  });
});
