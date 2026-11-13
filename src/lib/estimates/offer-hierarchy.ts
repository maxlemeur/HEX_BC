/** Physical nesting includes up to three ouvrage boundaries. Chapters retain their
 * four-level limit; existing snapshots keep their exact shape, ordering and amounts.
 */
export function offerHierarchyWithinLimits(rows: readonly {
  id: string; parentId: string | null; kind: string; kitMetier?: true; depth: number;
}[]): boolean {
  const byId = new Map(rows.map(row => [row.id, row]));
  return rows.every(row => {
    let cursor: typeof row | undefined = row, chapters = 0, ouvrages = 0;
    const visited = new Set<string>();
    while (cursor) {
      if (visited.has(cursor.id)) return false;
      visited.add(cursor.id);
      if (cursor.kind === "section") {
        if (cursor.kitMetier) ouvrages += 1;
        else chapters += 1;
      }
      if (chapters > 4 || (ouvrages > 3 && row.depth > (row.kind === "section" ? 3 : 4))) return false;
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return true;
  });
}
