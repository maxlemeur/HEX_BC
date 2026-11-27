import { isTakeoffApiError } from "@/lib/takeoff/client-http";
import { TAKEOFF_COUNT_MARK_EDIT_REFUSALS, takeoffCountMarkEditRefusal, type TakeoffCountMark } from "@/lib/takeoff/count-marks";
import type { CountMarksReader } from "@/lib/takeoff/count-marks-client";
import {
  TAKEOFF_COUNT_MARKS_PLAN_SENT,
  TAKEOFF_COUNT_MARKS_PLAN_SENT_MESSAGE,
  TAKEOFF_COUNT_MARKS_READ_CHANGING,
  type CountMarksView,
} from "@/lib/takeoff/count-marks-contracts";
import type { CountMarkDraft, CountMarkPoint } from "@/lib/takeoff/count-marks-view";

/**
 * The reads of the counted marks' screen (CountMarksScope) and what it keeps in the tab: the page's lots at one revision,
 * the retained marks a refusal named, the correction session stored by member and answer, and the words of a refusal.
 */

const PAGE_LOTS_WITHOUT_ASKING = 5;
/** The states of the marks a member reviews on the page: a newer reading's marks (pending) are retained from there. */
const REVIEWED_STATES = ["proposed", "to_attribute", "retained", "pending"] as const;

/** Lots read at two revisions, again: no view is published; what was shown stays, and the member is told. */
export class ChangingMarksError extends Error {}

export type Loaded = {
  answerId: string;
  page: number;
  view: CountMarksView;
  marks: TakeoffCountMark[];
  nextAfter: string | null;
  lots: number;
};

/**
 * Every lot of the page's marks up to the bound, or the next lot after those loaded. Lots read at another revision than
 * the first are read again from the start once: the marks shown are of one revision.
 */
export async function readCountMarkLots(reader: CountMarksReader, target: { answerId: string; page: number },
  from: Loaded | null): Promise<Loaded> {
  for (let attempt = 0; ; attempt += 1) {
    const start = attempt === 0 ? from : null;
    const bound = start ? start.lots + 1 : PAGE_LOTS_WITHOUT_ASKING;
    let view = await reader.readPage({ answerId: target.answerId, page: target.page, after: start?.nextAfter ?? null,
      states: REVIEWED_STATES });
    const revision = start?.view.revision ?? view.revision;
    const marks = [...(start?.marks ?? []), ...view.marks];
    const names = { ...(start?.view.names ?? {}), ...view.names };
    let lots = (start?.lots ?? 0) + 1;
    let mixed = view.revision !== revision;
    while (!mixed && view.nextAfter && lots < bound) {
      view = await reader.readPage({ answerId: target.answerId, page: target.page, after: view.nextAfter, states: REVIEWED_STATES });
      marks.push(...view.marks);
      Object.assign(names, view.names);
      lots += 1;
      mixed = view.revision !== revision;
    }
    if (mixed && attempt === 0) continue;
    if (mixed) throw new ChangingMarksError();
    return { answerId: target.answerId, page: target.page, view: { ...view, names, marks: [], loaded: marks.length },
      marks, nextAfter: view.nextAfter, lots };
  }
}

/**
 * The retained marks a refusal named, read on the refused gesture's page of the answer that retains them, by lots until
 * each one is found, all at one revision: read again once, then null (they are changing). `still` says whether what
 * asked is still shown: when it is not, the reading stops and gives nothing.
 */
export async function readNamedRetained(reader: CountMarksReader, input: { answerId: string; page: number;
  markIds: readonly string[] }, still: () => boolean): Promise<Record<string, CountMarkPoint & { page: number }> | null | "gone"> {
  const wanted = new Set(input.markIds);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const found: Record<string, CountMarkPoint & { page: number }> = {};
    let revision: number | null = null;
    let after: string | null = null;
    let mixed = false;
    do {
      const read: CountMarksView = await reader.readPage({ answerId: input.answerId, page: input.page, states: ["retained"], after });
      if (!still()) return "gone";
      if (revision !== null && read.revision !== revision) {
        mixed = true;
        break;
      }
      revision = read.revision;
      for (const value of read.marks) if (wanted.has(value.markId)) found[value.markId] = { x: value.x, y: value.y, page: input.page };
      after = read.nextAfter;
    } while (after && input.markIds.some((markId) => !(markId in found)));
    if (!mixed) return found;
  }
  return null;
}

const sessionKey = (viewerId: string, answerId: string) => `metre-reperes:${viewerId}:${answerId}`;

/** The correction session of a member on an answer, kept for the tab. */
export function readSession(viewerId: string, answerId: string): CountMarkDraft | null {
  try {
    const stored = window.sessionStorage.getItem(sessionKey(viewerId, answerId));
    if (!stored) return null;
    const draft = JSON.parse(stored) as CountMarkDraft;
    return draft && draft.answerId === answerId && Array.isArray(draft.entries) && draft.entries.length ? draft : null;
  } catch {
    return null;
  }
}

export function storeSession(viewerId: string, draft: CountMarkDraft) {
  try {
    if (draft.entries.length) window.sessionStorage.setItem(sessionKey(viewerId, draft.answerId), JSON.stringify(draft));
    else window.sessionStorage.removeItem(sessionKey(viewerId, draft.answerId));
  } catch {
    // A tab without storage keeps the session in memory only.
  }
}

export const isReadRefusal = (error: unknown) => isTakeoffApiError(error) && [401, 403, 404].includes(error.status);
/** Reads that kept crossing revisions, here or on the server (which compares a page and its count). */
export const isChanging = (error: unknown) => error instanceof ChangingMarksError
  || (isTakeoffApiError(error) && error.code === TAKEOFF_COUNT_MARKS_READ_CHANGING);

/** A refusal of the command, worded from its code only. */
export function refusalSentence(error: unknown) {
  if (!isTakeoffApiError(error)) return "La modification n’a pas pu être enregistrée. Réessayez.";
  if (error.code === TAKEOFF_COUNT_MARKS_PLAN_SENT) return TAKEOFF_COUNT_MARKS_PLAN_SENT_MESSAGE;
  const code = takeoffCountMarkEditRefusal(error.code);
  if (code) return TAKEOFF_COUNT_MARK_EDIT_REFUSALS[code];
  if (error.status === 0) return "La modification n’a pas pu être envoyée. Réessayez : elle ne sera pas enregistrée deux fois.";
  return "La modification n’a pas pu être enregistrée. Réessayez.";
}
