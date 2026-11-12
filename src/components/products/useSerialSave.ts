"use client";

import { useCallback, useRef } from "react";

/** `latest`: no later save of the same control was made meanwhile; only that answer speaks for the screen. */
export type SerialSaveOutcome<T> = { latest: boolean } & ({ ok: true; value: T } | { ok: false; error: unknown });

/**
 * The saves of one control that saves as soon as it is changed (a select). They leave one after another, in
 * the order they were made, so the server ends with the last choice; the control is never disabled meanwhile
 * (on Windows each arrow key in a select is a change, and a disabled control drops the keyboard focus).
 * Each answer says whether it is the latest, as `ChoiceCell` does for the request lines.
 */
export function useSerialSave() {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const ticket = useRef(0);
  return useCallback(async <T,>(write: () => Promise<T>): Promise<SerialSaveOutcome<T>> => {
    ticket.current += 1;
    const mine = ticket.current;
    const run = queue.current.then(write, write);
    queue.current = run.catch(() => undefined);
    try {
      const value = await run;
      return { latest: mine === ticket.current, ok: true, value };
    } catch (error) {
      return { latest: mine === ticket.current, ok: false, error };
    }
  }, []);
}
