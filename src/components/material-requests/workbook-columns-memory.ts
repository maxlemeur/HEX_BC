import { WORKBOOK_COLUMN_LETTER, WORKBOOK_ROLES, type WorkbookMapping } from "@/lib/material-requests/workbook-mapping";

/**
 * The columns a person confirmed for a layout of headers, kept in their browser only (owner's decision of
 * 2026-11-27): the same template comes back with their choices. One entry per header signature, the most recent
 * kept; the import works the same when storage is unavailable.
 */

const KEY = "mergeone:material-request-workbook-columns:v1";
const MAX_LAYOUTS = 20;

function storageKey(profileId: string | undefined) {
  return `${KEY}:${profileId ?? "guest"}`;
}

function readAll(profileId: string | undefined): Array<[string, WorkbookMapping]> {
  if (typeof window === "undefined") return [];
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(storageKey(profileId)) ?? "null");
    if (!Array.isArray(saved)) return [];
    return saved.flatMap((entry: unknown) => {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "object" || entry[1] === null) return [];
      const mapping: WorkbookMapping = {};
      for (const role of WORKBOOK_ROLES) {
        const letter = (entry[1] as Record<string, unknown>)[role];
        if (typeof letter === "string" && WORKBOOK_COLUMN_LETTER.test(letter)) mapping[role] = letter;
      }
      return [[entry[0], mapping] as [string, WorkbookMapping]];
    });
  } catch {
    // Storage unavailable or unreadable: recognition fills the columns.
    return [];
  }
}

export function readRememberedWorkbookColumns(profileId: string | undefined, signature: string): WorkbookMapping | null {
  return readAll(profileId).find(([key]) => key === signature)?.[1] ?? null;
}

export function rememberWorkbookColumns(profileId: string | undefined, signature: string, mapping: WorkbookMapping) {
  if (typeof window === "undefined" || !signature) return;
  const next = [[signature, mapping] as const, ...readAll(profileId).filter(([key]) => key !== signature)].slice(0, MAX_LAYOUTS);
  try {
    window.localStorage.setItem(storageKey(profileId), JSON.stringify(next));
  } catch {
    // Full or blocked storage: the choice is simply not remembered.
  }
}
