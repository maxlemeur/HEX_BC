import { expect, it } from "vitest";
import { buildHierarchyIndex, collectSubtreeMetrics, resolveSectionLevel } from "@/lib/estimates/hierarchy";
it("an ouvrage does not consume a chapter level, including its nested detail", () => {
  const index = buildHierarchyIndex([
    { id: "lot", parent_id: null, item_type: "section" },
    { id: "chapter", parent_id: "lot", item_type: "section" },
    { id: "ouvrage", parent_id: "chapter", item_type: "section", source_metadata: { kit_metier: true } },
    { id: "nested", parent_id: "ouvrage", item_type: "section", source_metadata: { kit_metier: true } },
    { id: "component", parent_id: "nested", item_type: "line" },
  ]);
  expect(resolveSectionLevel(index, "chapter")).toBe(2);
  expect(resolveSectionLevel(index, "ouvrage")).toBe(2);
  expect(resolveSectionLevel(index, "nested")).toBe(2);
  expect(collectSubtreeMetrics(index, "chapter").maxSectionRelativeDepth).toBe(0);
});

// Existing issued snapshots allowed four physical section levels, including kits.
import { offerHierarchyWithinLimits } from "@/lib/estimates/offer-hierarchy";
it("preserves existing shallow snapshots with four ouvrage boundaries", () => {
  const rows = Array.from({ length: 4 }, (_, depth) => ({ id: `kit-${depth}`, parentId: depth ? `kit-${depth - 1}` : null, kind: "section", kitMetier: true as const, depth }));
  expect(offerHierarchyWithinLimits([...rows, { id: "leaf", parentId: "kit-3", kind: "line", depth: 4 }])).toBe(true);
  expect(offerHierarchyWithinLimits([...rows, { id: "chapter", parentId: "kit-3", kind: "section", depth: 4 }])).toBe(false);
});
