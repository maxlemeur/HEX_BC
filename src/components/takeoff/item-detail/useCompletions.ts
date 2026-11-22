"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * The one rule of the detail's completions: a command, an item read again, a page of the queue, a page of the journal, a
 * plan's resolution.
 *
 * A completion is addressed to what started it: the screen (its member and the table's scope), the item and, when it
 * names one, the reading. It may always update what it was for (that item's kept line, the right the reply carries for
 * this member) while its screen is the one that started it. It touches what is shown now (forms, dialogs, notices, a
 * withdrawal, what the evidence says) only if what is shown is still what started it. A failure obeys the same rule as a
 * success. Nothing started for one item cancels or overrides what started for another.
 */

/** What a completion is for: the screen (member and scope), the item, and the reading when it names one. */
export type CompletionTarget = { screen: string; item: string | null; reading?: string | null };

export type Completion = {
  /** Whether this is still the screen that started it (the same member, the same scope, still mounted). */
  ownScreen: () => boolean;
  /** Whether what is shown now is still what started it: its screen, its item and, when it named one, its reading. */
  current: () => boolean;
};

/** Starts completions on what is shown (`shown`, the latest render's); each one is judged when it ends. */
export function useCompletions(shown: CompletionTarget) {
  const latest = useRef(shown);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    latest.current = shown;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback((target: CompletionTarget): Completion => {
    const ownScreen = () => mounted.current && latest.current.screen === target.screen;
    return {
      ownScreen,
      current: () => ownScreen() && latest.current.item === target.item
        && (target.reading === undefined || latest.current.reading === target.reading),
    };
  }, []);
}
