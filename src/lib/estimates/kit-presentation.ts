/** Kit components remain calculation inputs; only their section aggregate is presented. */
type KitItem = {
  id: string;
  parent_id: string | null;
  source_metadata?: unknown;
};
export function isKitSection(item: { source_metadata?: unknown }): boolean {
  const meta = item.source_metadata;
  return (
    !!meta &&
    typeof meta === "object" &&
    !Array.isArray(meta) &&
    "kit_metier" in meta &&
    meta.kit_metier === true
  );
}
export function kitComponentIds(items: readonly KitItem[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const item of items)
    if (item.parent_id) {
      const group = children.get(item.parent_id);
      if (group) group.push(item.id);
      else children.set(item.parent_id, [item.id]);
    }
  const queue = items.filter(isKitSection).map((item) => item.id);
  const hidden = new Set<string>();
  for (let index = 0; index < queue.length; index++)
    for (const child of children.get(queue[index]) ?? []) {
      if (!hidden.has(child)) {
        hidden.add(child);
        queue.push(child);
      }
    }
  return hidden;
}
