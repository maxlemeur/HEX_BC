import { describe, expect, it } from "vitest";

import { resolveSelectedImportId } from "@/components/mappings/MappingWizard";

const importsData = [
  {
    id: "import-1",
    filename: "a.xlsx",
    status: "parsed",
    row_count: 10,
    created_at: "2026-02-23T10:00:00.000Z",
  },
  {
    id: "import-2",
    filename: "b.xlsx",
    status: "parsed",
    row_count: 12,
    created_at: "2026-02-23T11:00:00.000Z",
  },
];

describe("resolveSelectedImportId", () => {
  it("falls back to first import when query import_id is unknown", () => {
    const resolved = resolveSelectedImportId(importsData, "missing-id", "missing-id");
    expect(resolved).toBe("import-1");
  });

  it("keeps current selection when it exists and no query import_id is provided", () => {
    const resolved = resolveSelectedImportId(importsData, null, "import-2");
    expect(resolved).toBe("import-2");
  });

  it("returns empty id when no imports are available", () => {
    const resolved = resolveSelectedImportId([], "missing-id", "missing-id");
    expect(resolved).toBe("");
  });
});
