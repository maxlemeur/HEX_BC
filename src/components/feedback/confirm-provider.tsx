"use client";

import { createContext, use, useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";

import type { ConfirmOptions } from "./confirm-types";

export type { ConfirmOptions };

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

// Loaded on first use only, so the dialog primitives stay out of every route's bundle.
const ConfirmDialog = dynamic(() => import("./confirm-dialog"), { ssr: false });

/**
 * Accessible replacement for `window.confirm`: focus trap, Escape, focus restored to the
 * trigger, and the same visual language as the rest of the app.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [requested, setRequested] = useState(false);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback<ConfirmFn>((next) => {
    resolverRef.current?.(false);
    setRequested(true);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  return (
    <ConfirmContext value={confirm}>
      {children}
      {requested ? <ConfirmDialog options={options} onSettle={settle} /> : null}
    </ConfirmContext>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = use(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm doit être utilisé sous <ConfirmProvider>.");
  }
  return confirm;
}
