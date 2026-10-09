import { describe,expect,it } from "vitest";

import {
filterMappingToSourceColumns,
resolveSelectedImportId,
} from "@/components/mappings/MappingWizard";

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
});

describe("filterMappingToSourceColumns", () => {
  it("removes mappings for columns not present in source columns", () => {
    const filtered = filterMappingToSourceColumns(
      {
        Code: "hex_code",
        Designation: "designation",
        LegacyColumn: "notes",
      },
      ["Code", "Designation"]
    );

    expect(filtered).toEqual({
      Code: "hex_code",
      Designation: "designation",
    });
  });
});
