import type { ImportListItem } from "@/hooks/useImportFlow";

export type StatusFilter = "all" | "active" | "completed" | "failed";

export const IMPORT_HISTORY_STATUS_TABS: Array<{
  key: StatusFilter;
  label: string;
}> = [
  { key: "all", label: "Tous" },
  { key: "active", label: "En cours" },
  { key: "completed", label: "Terminés" },
  { key: "failed", label: "Échecs" },
];

function isTerminalStatus(status: string): boolean {
  return ["parsed", "imported", "completed", "failed"].includes(status);
}

export function filterImports(
  items: ImportListItem[],
  filter: StatusFilter,
  search: string
): ImportListItem[] {
  let filtered = items;

  if (filter === "active") {
    filtered = filtered.filter((item) => !isTerminalStatus(item.status));
  } else if (filter === "completed") {
    filtered = filtered.filter((item) =>
      ["parsed", "imported", "completed"].includes(item.status)
    );
  } else if (filter === "failed") {
    filtered = filtered.filter((item) => item.status === "failed");
  }

  if (search.trim()) {
    const lowerSearch = search.toLowerCase();
    filtered = filtered.filter((item) =>
      item.fileName.toLowerCase().includes(lowerSearch)
    );
  }

  return filtered;
}
