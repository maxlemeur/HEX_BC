"use client";

import { useCallback, useState } from "react";

/** Stored sentinel of a delivery date still to be agreed with the supplier (API contract). */
const TBD_SENTINEL = "TBD";

type DeliveryDateState = { isTbd: boolean; date: string };

function fromStored(stored: string | null | undefined): DeliveryDateState {
  if (stored?.trim().toUpperCase() === TBD_SENTINEL) return { isTbd: true, date: "" };
  return { isTbd: false, date: stored ?? "" };
}

/**
 * UX63 — the "À déterminer" choice and the calendar date are kept apart in the UI so that
 * unticking the box restores the date typed before; the payload keeps the `TBD` sentinel.
 */
export function useDeliveryDateState(initial?: string | null) {
  const [state, setState] = useState<DeliveryDateState>(() => fromStored(initial));

  /** Value expected by `PurchaseOrderDocument` (`TBD`, an ISO date or an empty string). */
  const documentValue = state.isTbd ? TBD_SENTINEL : state.date;

  /** Payload value of `expectedDeliveryDate`, unchanged: `TBD`, an ISO date or null. */
  const payloadValue = state.isTbd ? TBD_SENTINEL : state.date || null;

  const onDocumentChange = useCallback((next: string) => {
    setState((current) => {
      if (next === TBD_SENTINEL) return { ...current, isTbd: true };
      // The document emits an empty string when the box is unticked: keep the previous date.
      if (current.isTbd && next === "") return { ...current, isTbd: false };
      return { isTbd: false, date: next };
    });
  }, []);

  const reset = useCallback((stored: string | null | undefined) => {
    setState(fromStored(stored));
  }, []);

  return { isTbd: state.isTbd, documentValue, payloadValue, onDocumentChange, reset };
}
