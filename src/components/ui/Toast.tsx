"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";

/* ────────────────── Types ────────────────── */

export type ToastVariant = "success" | "error" | "warning" | "info";

export type ToastPayload = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastRecord = ToastPayload & {
  id: string;
  variant: ToastVariant;
  durationMs: number;
  exiting?: boolean;
};

type ToastContextValue = {
  push: (payload: ToastPayload) => string;
  dismiss: (id: string) => void;
  success: (payload: Omit<ToastPayload, "variant">) => string;
  error: (payload: Omit<ToastPayload, "variant">) => string;
  warning: (payload: Omit<ToastPayload, "variant">) => string;
  info: (payload: Omit<ToastPayload, "variant">) => string;
};

/* ────────────────── Constants ────────────────── */

const DEFAULT_DURATION_MS = 4000;
const MAX_VISIBLE = 3;
const EXIT_ANIMATION_MS = 200;
const MISSING_PROVIDER_TOAST_ID = "missing-toast-provider";

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_VARIANTS: Record<ToastVariant, string> = {
  success: "border-success/30 bg-success-light text-slate-800",
  error: "border-danger/30 bg-error-light text-slate-800",
  warning: "border-warning/30 bg-warning-light text-slate-800",
  info: "border-info/30 bg-info-light text-slate-800",
};

const missingToastProviderFallback: ToastContextValue = {
  push: () => MISSING_PROVIDER_TOAST_ID,
  dismiss: () => {},
  success: () => MISSING_PROVIDER_TOAST_ID,
  error: () => MISSING_PROVIDER_TOAST_ID,
  warning: () => MISSING_PROVIDER_TOAST_ID,
  info: () => MISSING_PROVIDER_TOAST_ID,
};

/* ────────────────── Toast (single item) ────────────────── */

export function Toast({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const role = toast.variant === "error" || toast.variant === "warning" ? "alert" : "status";

  return (
    <div
      data-toast-id={toast.id}
      className={cn(
        "relative overflow-hidden rounded-xl border px-4 py-3 shadow-lg",
        "flex min-w-[280px] max-w-[420px] items-start justify-between gap-3",
        TOAST_VARIANTS[toast.variant]
      )}
      role={role}
      aria-atomic="true"
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description ? <p className="text-xs opacity-90">{toast.description}</p> : null}
      </div>

      <button
        type="button"
        aria-label="Fermer la notification"
        className="rounded-md px-2 py-1 text-xs font-semibold opacity-80 hover:opacity-100"
        onClick={() => onDismiss(toast.id)}
      >
        Fermer
      </button>

      <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden rounded-b-xl">
        <div
          className="h-full bg-current opacity-20"
          style={{
            animation: `toast-progress ${toast.durationMs}ms linear forwards`,
          }}
        />
      </div>
    </div>
  );
}

/* ────────────────── ToastViewport ────────────────── */

export function ToastViewport({
  toasts,
  onDismiss,
  onExitEnd,
  className,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
  onExitEnd?: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("pointer-events-none fixed bottom-4 right-4 z-70 flex flex-col gap-2", className)}
      aria-live="polite"
      aria-relevant="additions removals"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className="pointer-events-auto"
            initial={{ opacity: 0, x: 80 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 80, transition: { duration: 0.15 } }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onAnimationComplete={(definition) => {
              if (definition === "exit" && onExitEnd) onExitEnd(toast.id);
            }}
          >
            <Toast toast={toast} onDismiss={onDismiss} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ────────────────── ToastProvider ────────────────── */

export function ToastProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timeoutIdsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /* Remove a toast from the array (internal — after exit animation) */
  const removeToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((t) => t.id !== id));
    const tid = timeoutIdsRef.current.get(id);
    if (tid) {
      clearTimeout(tid);
      timeoutIdsRef.current.delete(id);
    }
  }, []);

  /* Start exit animation — public "dismiss" */
  const startExit = useCallback((id: string) => {
    setToasts((previous) => {
      const target = previous.find((t) => t.id === id);
      if (!target || target.exiting) return previous;

      const currentlyVisibleIds = new Set<string>();
      for (const toast of previous) {
        if (!toast.exiting && currentlyVisibleIds.size < MAX_VISIBLE) {
          currentlyVisibleIds.add(toast.id);
        }
      }

      // Remove queued toasts immediately instead of briefly rendering them as exiting.
      if (!currentlyVisibleIds.has(id)) {
        return previous.filter((t) => t.id !== id);
      }

      return previous.map((t) => (t.id === id ? { ...t, exiting: true } : t));
    });

    // Clear auto-dismiss timer if running
    const existingTid = timeoutIdsRef.current.get(id);
    if (existingTid) {
      clearTimeout(existingTid);
      timeoutIdsRef.current.delete(id);
    }
  }, []);

  /* Called by ToastViewport when exit animation completes */
  const handleExitEnd = useCallback((id: string) => {
    removeToast(id);
  }, [removeToast]);

  /* Push a new toast (timer started lazily by effect when it becomes visible) */
  const push = useCallback((payload: ToastPayload) => {
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    const record: ToastRecord = {
      id,
      title: payload.title,
      description: payload.description,
      variant: payload.variant ?? "info",
      durationMs: payload.durationMs ?? DEFAULT_DURATION_MS,
      exiting: false,
    };

    setToasts((previous) => [...previous, record]);
    return id;
  }, []);

  /* Visible IDs = first MAX_VISIBLE non-exiting toasts */
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of toasts) {
      if (!t.exiting && ids.size < MAX_VISIBLE) ids.add(t.id);
    }
    return ids;
  }, [toasts]);

  /* Toasts to render: visible non-exiting + any exiting (animating out) */
  const renderToasts = useMemo(() => {
    return toasts.filter((t) => t.exiting || visibleIds.has(t.id));
  }, [toasts, visibleIds]);

  /* Start auto-dismiss timers only when a toast becomes visible */
  useEffect(() => {
    for (const toast of toasts) {
      if (timeoutIdsRef.current.has(toast.id)) continue;

      if (toast.exiting) {
        // Fallback for environments where onAnimationEnd doesn't fire.
        const tid = setTimeout(() => removeToast(toast.id), EXIT_ANIMATION_MS + 50);
        timeoutIdsRef.current.set(toast.id, tid);
        continue;
      }

      if (visibleIds.has(toast.id)) {
        const tid = setTimeout(() => startExit(toast.id), toast.durationMs);
        timeoutIdsRef.current.set(toast.id, tid);
      }
    }
  }, [toasts, visibleIds, startExit, removeToast]);

  /* Cleanup all timeouts on unmount */
  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current;
    return () => {
      timeoutIds.forEach((tid) => clearTimeout(tid));
      timeoutIds.clear();
    };
  }, []);

  const contextValue = useMemo<ToastContextValue>(
    () => ({
      push,
      dismiss: startExit,
      success: (payload) => push({ ...payload, variant: "success" }),
      error: (payload) => push({ ...payload, variant: "error" }),
      warning: (payload) => push({ ...payload, variant: "warning" }),
      info: (payload) => push({ ...payload, variant: "info" }),
    }),
    [startExit, push]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastViewport toasts={renderToasts} onDismiss={startExit} onExitEnd={handleExitEnd} />
    </ToastContext.Provider>
  );
}

/* ────────────────── useToast ────────────────── */

export function useToast() {
  const context = useContext(ToastContext);
  const hasWarnedAboutMissingToastProviderRef = useRef(false);

  useEffect(() => {
    if (
      !context &&
      process.env.NODE_ENV !== "production" &&
      !hasWarnedAboutMissingToastProviderRef.current
    ) {
      hasWarnedAboutMissingToastProviderRef.current = true;
      console.error("useToast called without ToastProvider. Toasts will be ignored.");
    }

    if (context) {
      hasWarnedAboutMissingToastProviderRef.current = false;
    }
  }, [context]);

  if (!context) {
    return missingToastProviderFallback;
  }

  return context;
}
