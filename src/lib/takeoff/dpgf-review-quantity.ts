type QuantityReviewRow = {
  dpgf_quantity: number | null;
  dpgf: { unit: string | null; title?: string; description?: string | null };
  linked_takeoff_items: Array<{ item_id: string; designation: string; quantity: number; unit: string;
    source_file_name: string | null; source_page: number | null; metadata: Record<string, unknown> }>;
};

/** Stable across a version copy, but not across a change in the quantities, basis or source being reviewed. */
export function dpgfReviewQuantitySnapshot(row: QuantityReviewRow): Record<string, unknown> {
  return { version: 1, reference: row.dpgf_quantity, unit: row.dpgf.unit,
    designation: [row.dpgf.title, row.dpgf.description].filter(Boolean).join(" "),
    items: [...row.linked_takeoff_items].sort((a, b) => a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0)
      .map(item => ({ id: item.item_id, quantity: item.quantity, unit: item.unit, designation: item.designation,
        file: item.source_file_name, page: item.source_page, rule_inputs: item.metadata.rule_inputs ?? null })) };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function sameQuantitySnapshot(left: unknown, right: unknown) {
  return left !== null && left !== undefined && canonical(left) === canonical(right);
}
