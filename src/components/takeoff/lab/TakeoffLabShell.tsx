"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage, formatInteger, labApi } from "@/components/takeoff/lab/lab-api";
import type { LabState } from "@/lib/takeoff/lab/contracts";
import { cn } from "@/lib/utils";

/**
 * Screens of the takeoff lab (TI-661), one link each in the lab's bar. A new
 * screen (TI-662: vectors) adds its route under /dashboard/admin/takeoff/lab and
 * one entry here; the shell, its access check and the tool layout stay shared.
 */
export const LAB_VIEWS = [
  { href: "/dashboard/admin/takeoff/lab", label: "Essai" },
  { href: "/dashboard/admin/takeoff/lab/verdicts", label: "Verdicts" },
  { href: "/dashboard/admin/takeoff/lab/stats", label: "Stats" },
] as const;

type LabContextValue = { state: LabState; refresh: () => Promise<LabState | null>; refreshError: string | null };
const LabContext = createContext<LabContextValue | null>(null);

export function useTakeoffLab() {
  const value = useContext(LabContext);
  if (!value) throw new Error("useTakeoffLab must be used inside TakeoffLabShell.");
  return value;
}

export function TakeoffLabShell({ initialState, children }: Readonly<{ initialState: LabState; children: React.ReactNode }>) {
  const pathname = usePathname();
  const [state, setState] = useState(initialState);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await labApi.state();
      setState(next);
      setRefreshError(null);
      return next;
    } catch (error) {
      setRefreshError(errorMessage(error));
      return null;
    }
  }, []);
  const value = useMemo(() => ({ state, refresh, refreshError }), [state, refresh, refreshError]);
  const budget = state.decisions.budget;
  return (
    <LabContext.Provider value={value}>
      <TooltipProvider>
        <div className="flex h-full min-h-0 flex-col bg-surface-subtle">
          <header className="flex h-11 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
            <h1 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FlaskConical aria-hidden="true" className="size-4 text-primary" />
              Labo métré
            </h1>
            <nav aria-label="Écrans du labo" className="flex h-full items-stretch gap-1">
              {LAB_VIEWS.map((view) => {
                const active = pathname === view.href;
                return (
                  <Link key={view.href} href={view.href} prefetch={false} aria-current={active ? "page" : undefined}
                    className={cn("flex items-center border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                      active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                    {view.label}
                  </Link>
                );
              })}
            </nav>
            <div className="ml-auto flex items-center gap-2 text-xs">
              <Badge variant={state.configured ? "success" : "warning"} size="sm" dot>
                {state.configured ? "Dataset configuré" : "Dataset non configuré"}
              </Badge>
              <Tooltip>
                <TooltipTrigger render={<span tabIndex={0} />} className="rounded-full focus-visible:outline-2 focus-visible:outline-ring">
                  <Badge variant={state.decisions.available ? "info" : "neutral"} size="sm">
                    {budget.cap === null ? "Decisions : plafond invalide"
                      : `Decisions ${formatInteger(budget.used)} / ${formatInteger(budget.cap)} jetons`}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-sm">
                  {state.decisions.available
                    ? `Reste ${formatInteger(budget.remaining ?? 0)} jetons (TAKEOFF_LAB_DECISIONS_MAX_TOKENS). Appels sans usage : ${budget.calls_without_usage}.`
                    : state.decisions.message}
                </TooltipContent>
              </Tooltip>
              <Badge variant={state.chatgpt.connected && state.chatgpt.model ? "brand" : "neutral"} size="sm">
                {state.chatgpt.connected && state.chatgpt.model ? `ChatGPT · profil ${state.chatgpt.model}` : "ChatGPT non prêt"}
              </Badge>
            </div>
          </header>
          {state.message || refreshError ? (
            <p role="status" className="shrink-0 border-b border-warning-border bg-warning-subtle px-4 py-1.5 text-xs text-warning">
              {refreshError ?? state.message}
            </p>
          ) : null}
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      </TooltipProvider>
    </LabContext.Provider>
  );
}
