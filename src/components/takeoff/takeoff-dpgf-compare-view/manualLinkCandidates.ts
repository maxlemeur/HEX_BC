import type {
  TakeoffDpgfComparisonRow,
  TakeoffDpgfComparisonUnusedTakeoffItem,
} from "@/lib/takeoff/types";

export type ManualLinkCandidate = TakeoffDpgfComparisonUnusedTakeoffItem & {
  is_current: boolean;
  linked_line_label: string | null;
};

export function buildManualLinkCandidates(input: {
  row: TakeoffDpgfComparisonRow | null;
  rows: TakeoffDpgfComparisonRow[];
  manualLinkCandidates: TakeoffDpgfComparisonUnusedTakeoffItem[];
}): ManualLinkCandidate[] {
  if (!input.row) {
    return [];
  }

  const currentIds = new Set(input.row.linked_takeoff_items.map((item) => item.item_id));
  const linkedLineLabelByItemId = new Map<string, string>();

  for (const compareRow of input.rows) {
    if (compareRow.line_id === input.row.line_id) {
      continue;
    }

    for (const item of compareRow.linked_takeoff_items) {
      linkedLineLabelByItemId.set(item.item_id, compareRow.line_label);
    }
  }

  return input.manualLinkCandidates
    .map((item) => ({
      ...item,
      is_current: currentIds.has(item.item_id),
      linked_line_label: linkedLineLabelByItemId.get(item.item_id) ?? null,
    }))
    .sort((left, right) => {
      if (left.is_current !== right.is_current) {
        return left.is_current ? -1 : 1;
      }

      return left.designation.localeCompare(right.designation, "fr-FR");
    });
}
