import type { ReactNode } from "react";

import { useGridActiveRowId, type GridNavigationResult } from "@/hooks/useGridNavigation";

type BreadcrumbItem = {
  item_type: string;
  parent_id: string | null;
  title: string | null;
};

/** « Lot > Sous-lot » of the active line; null on a section or at the root. */
export function resolveActiveLineBreadcrumb(
  activeClientKey: string | null,
  itemByClientKey: ReadonlyMap<string, BreadcrumbItem>,
  itemById: ReadonlyMap<string, BreadcrumbItem>,
) {
  if (!activeClientKey) return null;
  const activeItem = itemByClientKey.get(activeClientKey);
  if (!activeItem || activeItem.item_type !== "line") return null;

  const labels: string[] = [];
  let cursorParentId = activeItem.parent_id;
  let guard = 0;
  while (cursorParentId && guard < 100) {
    guard += 1;
    const parent = itemById.get(cursorParentId);
    if (!parent || parent.item_type !== "section") break;
    labels.push(parent.title || "Sans titre");
    cursorParentId = parent.parent_id;
  }
  return labels.length === 0 ? null : labels.reverse().join(" > ");
}

/**
 * Renders what depends on the active row. Moving the active cell re-renders
 * this subtree only, never the table.
 */
export function GridActiveRow({
  navigation,
  children,
}: {
  navigation: GridNavigationResult;
  children: (activeClientKey: string | null) => ReactNode;
}) {
  return <>{children(useGridActiveRowId(navigation))}</>;
}
