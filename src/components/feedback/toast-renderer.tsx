"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";

import { ToastClose, ToastDescription, ToastPortal, ToastTitle, ToastViewport } from "@/components/ui/toast";
import type { PendingToast, ToastController, ToastVariant } from "@/components/feedback/toast-provider";
import { cn } from "@/lib/utils";

const variants = {
  success: { icon: CircleCheckIcon, color: "text-success" },
  error: { icon: OctagonXIcon, color: "text-danger" },
  warning: { icon: TriangleAlertIcon, color: "text-warning" },
  info: { icon: InfoIcon, color: "text-info" },
};
type RendererProps = { connect: (controller: ToastController | null) => void };

function Notifications({ connect }: RendererProps) {
  const { add, close, toasts } = ToastPrimitive.useToastManager();
  const pending = useRef<PendingToast[]>([]);
  const active = useRef(new Set<string>());
  const mounted = useRef(false);

  // Preserve FIFO; Base UI owns timers, hover/focus pause and announcements.
  const promote = useCallback<() => void>(() => {
    if (!mounted.current) return;
    while (active.current.size < 3 && pending.current.length > 0) {
      const next = pending.current.shift()!;
      const variant = next.variant ?? "info";
      active.current.add(next.id);
      add({
        id: next.id,
        title: next.title,
        description: next.description,
        type: variant,
        timeout: next.durationMs ?? 4000,
        priority: variant === "error" || variant === "warning" ? "high" : "low",
        onRemove: () => {
          active.current.delete(next.id);
          // Finish Base UI's removal before adding another record to its store.
          queueMicrotask(promote);
        },
      });
    }
  }, [add]);

  const push = useCallback((notification: PendingToast) => {
    pending.current.push(notification);
    promote();
  }, [promote]);
  const dismiss = useCallback((id: string) => {
    pending.current = pending.current.filter((entry) => entry.id !== id);
    close(id);
  }, [close]);
  const controller = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  useEffect(() => {
    mounted.current = true;
    connect(controller);
    return () => {
      mounted.current = false;
      connect(null);
    };
  }, [connect, controller]);

  return <ToastPortal>
    <ToastViewport aria-label="Notifications" className="z-(--z-toast) flex flex-col gap-2">
      {toasts.toReversed().map((notification) => {
        const { icon: Icon, color } = variants[notification.type as ToastVariant] ?? variants.info;
        return <ToastPrimitive.Root key={notification.id} toast={notification}
          data-slot="toast" data-toast-id={notification.id}
          className="pointer-events-auto relative flex items-start gap-3 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg transition-[opacity,transform] duration-200 data-starting-style:translate-x-8 data-starting-style:opacity-0 data-ending-style:translate-x-8 data-ending-style:opacity-0 motion-reduce:transition-none">
          <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", color)} />
          <div className="min-w-0 flex-1 space-y-1">
            <ToastTitle className="font-semibold" />
            {notification.description ? <ToastDescription /> : null}
          </div>
          <ToastClose />
        </ToastPrimitive.Root>;
      })}
    </ToastViewport>
  </ToastPortal>;
}

export function ToastRenderer({ connect }: RendererProps) {
  return <ToastPrimitive.Provider timeout={4000} limit={3}>
    <Notifications connect={connect} />
  </ToastPrimitive.Provider>;
}
