import { WORKBOOK_COLUMN_LETTER, WORKBOOK_ROLES, distinctWorkbookMapping, type WorkbookMapping } from "@/lib/material-requests/workbook-mapping";

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

/** What is remembered for a layout: the columns, and whether the dimension cell is split (absent: not chosen yet). */
export type RememberedWorkbookColumns = { mapping: WorkbookMapping; splitDimension?: boolean };
type Entry = [string, WorkbookMapping, { splitDimension?: boolean }];

function readAll(profileId: string | undefined): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(storageKey(profileId)) ?? "null");
    if (!Array.isArray(saved)) return [];
    return saved.flatMap((entry: unknown): Entry[] => {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "object" || entry[1] === null) return [];
      const mapping: WorkbookMapping = {};
      for (const role of WORKBOOK_ROLES) {
        const letter = (entry[1] as Record<string, unknown>)[role];
        if (typeof letter === "string" && WORKBOOK_COLUMN_LETTER.test(letter)) mapping[role] = letter;
      }
      const split = (entry[2] as { splitDimension?: unknown } | undefined)?.splitDimension;
      // Storage may hold one column for two roles (edited by hand, older version): the first role keeps it.
      return [[entry[0], distinctWorkbookMapping(mapping), typeof split === "boolean" ? { splitDimension: split } : {}]];
    });
  } catch {
    // Storage unavailable or unreadable: recognition fills the columns.
    return [];
  }
}

export function readRememberedWorkbookColumns(profileId: string | undefined, signature: string): RememberedWorkbookColumns | null {
  const entry = readAll(profileId).find(([key]) => key === signature);
  return entry ? { mapping: entry[1], ...entry[2] } : null;
}

export function rememberWorkbookColumns(profileId: string | undefined, signature: string, mapping: WorkbookMapping, splitDimension: boolean) {
  if (typeof window === "undefined" || !signature) return;
  const entry: Entry = [signature, mapping, { splitDimension }];
  const next = [entry, ...readAll(profileId).filter(([key]) => key !== signature)].slice(0, MAX_LAYOUTS);
  try {
    window.localStorage.setItem(storageKey(profileId), JSON.stringify(next));
  } catch {
    // Full or blocked storage: the choice is simply not remembered.
  }
}
