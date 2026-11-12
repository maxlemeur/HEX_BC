import { expect, it } from "vitest";
import { kitComponentIds } from "@/lib/estimates/kit-presentation";
it("hides nested kit components while retaining the aggregate section and unrelated lines", () => {
  const items = [
    { id: "lot", parent_id: null, source_metadata: {} },
    { id: "kit", parent_id: "lot", source_metadata: { kit_metier: true } },
    { id: "tube", parent_id: "kit" },
    { id: "nested", parent_id: "kit" },
    { id: "valve", parent_id: "nested" },
    { id: "other", parent_id: "lot" },
  ];
  expect([...kitComponentIds(items)].sort()).toEqual([
    "nested",
    "tube",
    "valve",
  ]);
});
