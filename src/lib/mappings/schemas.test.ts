import { describe, expect, it } from "vitest";

import { mappingRecordSchema } from "@/lib/mappings/schemas";

describe("mapping schemas", () => {

  it("ignores unknown target values during mapping normalization", () => {
    const parsed = mappingRecordSchema.parse({
      Type_FO: "supply_type",
      Unknown: "unsupported_target",
    });

    expect(parsed).toEqual({
      Type_FO: "supply_type",
    });
  });
});
