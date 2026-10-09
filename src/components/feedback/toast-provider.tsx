"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

export type ToastVariant = "success" | "error" | "warning" | "info";
export type ToastPayload = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
};
export type PendingToast = ToastPayload & { id: string };
export type ToastController = {
  push: (notification: PendingToast) => void;
  dismiss: (id: string) => void;
};

type ToastApi = {
  push: (payload: ToastPayload) => string;
  dismiss: (id: string) => void;
  success: (payload: Omit<ToastPayload, "variant">) => string;
  error: (payload: Omit<ToastPayload, "variant">) => string;
  warning: (payload: Omit<ToastPayload, "variant">) => string;
  info: (payload: Omit<ToastPayload, "variant">) => string;
};

const ToastContext = createContext<ToastApi | null>(null);
const ignore = () => "missing-toast-provider";
const fallback: ToastApi = { push: ignore, dismiss: () => {}, success: ignore, error: ignore, warning: ignore, info: ignore };
const ToastRenderer = dynamic(() => import("@/components/feedback/toast-renderer").then((module) => module.ToastRenderer), { ssr: false });

export function ToastProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [enabled, setEnabled] = useState(false);
  const controller = useRef<ToastController | null>(null);
  const pending = useRef<PendingToast[]>([]);

  const connect = useCallback((next: ToastController | null) => {
    controller.current = next;
    if (next) {
      for (const notification of pending.current.splice(0)) next.push(notification);
    }
  }, []);

  const push = useCallback((payload: ToastPayload) => {
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const notification = { ...payload, id };
    if (controller.current) controller.current.push(notification);
    else pending.current.push(notification);
    setEnabled(true);
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    pending.current = pending.current.filter((notification) => notification.id !== id);
    controller.current?.dismiss(id);
  }, []);

  const api = useMemo<ToastApi>(() => ({
    push, dismiss,
    success: (payload) => push({ ...payload, variant: "success" }),
    error: (payload) => push({ ...payload, variant: "error" }),
    warning: (payload) => push({ ...payload, variant: "warning" }),
    info: (payload) => push({ ...payload, variant: "info" }),
  }), [dismiss, push]);

  return <ToastContext.Provider value={api}>
    {children}
    {enabled ? <ToastRenderer connect={connect} /> : null}
  </ToastContext.Provider>;
}

export function useToast() {
  const api = useContext(ToastContext);
  const warned = useRef(false);
  useEffect(() => {
    if (!api && !warned.current && process.env.NODE_ENV !== "production") {
      warned.current = true;
      console.error("useToast called without ToastProvider. Toasts will be ignored.");
    }
    if (api) warned.current = false;
  }, [api]);
  return api ?? fallback;
}
