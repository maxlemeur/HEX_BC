import { describe, expect, it } from "vitest";

import {
  mappingRecordSchema,
  mappingsActionSchema,
  mappingTargetFieldSchema,
} from "@/lib/mappings/schemas";

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

  it("accepts the create payload emitted without optional text metadata", () => {
    const parsed = mappingsActionSchema.parse({
      action: "create",
      import_id: "11111111-1111-4111-8111-111111111111",
      mapping: {
        Code_HEX: "hex_code",
        Designation: "designation",
      },
      template_id: null,
      save_template: false,
      template_name: null,
      supplier_name: null,
    });

    expect(parsed).toMatchObject({
      action: "create",
      mapping: {
        Code_HEX: "hex_code",
        Designation: "designation",
      },
      save_template: false,
    });
    if (parsed.action !== "create") {
      throw new Error("Expected a create mapping payload.");
    }
    expect(parsed.name).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
  });
});
