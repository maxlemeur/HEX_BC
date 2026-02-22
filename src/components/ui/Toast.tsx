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

import { cn } from "@/lib/utils";

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
};

type ToastContextValue = {
  push: (payload: ToastPayload) => string;
  dismiss: (id: string) => void;
  success: (payload: Omit<ToastPayload, "variant">) => string;
  error: (payload: Omit<ToastPayload, "variant">) => string;
  warning: (payload: Omit<ToastPayload, "variant">) => string;
  info: (payload: Omit<ToastPayload, "variant">) => string;
};

const DEFAULT_DURATION_MS = 4000;

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_VARIANTS: Record<ToastVariant, string> = {
  success: "border-success/30 bg-[var(--success-light)] text-[var(--slate-800)]",
  error: "border-danger/30 bg-[var(--error-light)] text-[var(--slate-800)]",
  warning: "border-warning/30 bg-[var(--warning-light)] text-[var(--slate-800)]",
  info: "border-info/30 bg-[var(--info-light)] text-[var(--slate-800)]",
};

export function Toast({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const role = toast.variant === "error" || toast.variant === "warning" ? "alert" : "status";

  return (
    <div
      data-toast-id={toast.id}
      className={cn(
        "rounded-xl border px-4 py-3 shadow-lg",
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
    </div>
  );
}

export function ToastViewport({
  toasts,
  onDismiss,
  className,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("pointer-events-none fixed bottom-4 right-4 z-[70] flex flex-col gap-2", className)}
      aria-live="polite"
      aria-relevant="additions removals"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timeoutIdsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));

    const timeoutId = timeoutIdsRef.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutIdsRef.current.delete(id);
    }
  }, []);

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
    };

    setToasts((previous) => [...previous, record]);

    const timeoutId = setTimeout(() => {
      dismiss(id);
    }, record.durationMs);
    timeoutIdsRef.current.set(id, timeoutId);

    return id;
  }, [dismiss]);

  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current;
    return () => {
      timeoutIds.forEach((timeoutId) => clearTimeout(timeoutId));
      timeoutIds.clear();
    };
  }, []);

  const contextValue = useMemo<ToastContextValue>(
    () => ({
      push,
      dismiss,
      success: (payload) => push({ ...payload, variant: "success" }),
      error: (payload) => push({ ...payload, variant: "error" }),
      warning: (payload) => push({ ...payload, variant: "warning" }),
      info: (payload) => push({ ...payload, variant: "info" }),
    }),
    [dismiss, push]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return context;
}
