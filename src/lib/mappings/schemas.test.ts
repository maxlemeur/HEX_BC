import { describe, expect, it } from "vitest";

import { mappingRecordSchema, mappingTargetFieldSchema } from "@/lib/mappings/schemas";

describe("mapping schemas", () => {
  it("accepts the new OPTIMA target fields", () => {
    const parsed = mappingRecordSchema.parse({
      Type_FO: " supply_type ",
      Majoration_MO: " h_mo_majoration ",
    });

    expect(parsed).toEqual({
      Type_FO: "supply_type",
      Majoration_MO: "h_mo_majoration",
    });
  });

  it("keeps existing target fields valid", () => {
    const parsed = mappingRecordSchema.parse({
      Code_HEX: "hex_code",
      Designation: "designation",
      Quantity: "quantity",
    });

    expect(parsed).toEqual({
      Code_HEX: "hex_code",
      Designation: "designation",
      Quantity: "quantity",
    });
  });

  it("ignores unknown target values during mapping normalization", () => {
    const parsed = mappingRecordSchema.parse({
      Type_FO: "supply_type",
      Unknown: "unsupported_target",
    });

    expect(parsed).toEqual({
      Type_FO: "supply_type",
    });
  });

  it("exposes new targets in the enum schema", () => {
    expect(mappingTargetFieldSchema.parse("supply_type")).toBe("supply_type");
    expect(mappingTargetFieldSchema.parse("h_mo_majoration")).toBe("h_mo_majoration");
  });
});
