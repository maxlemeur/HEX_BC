"use client";

import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { AssistantScreen } from "@/lib/assistant/prompt";

/** The affaire and the screen the member is on: what a question is about. */
export type AssistantScope = { projectId: string; screen: AssistantScreen };

type AssistantDockValue = {
  enabled: boolean;
  open: boolean;
  hasScope: boolean;
  toggle(): void;
  setScope(scope: AssistantScope | null): void;
};

const AssistantDockContext = createContext<AssistantDockValue | null>(null);

const AssistantPanel = dynamic(() => import("@/components/assistant/AssistantPanel"), { ssr: false });

/**
 * Holds the assistant panel beside the workspace, across the screens of an
 * affaire: the screens say where the member is, their header shows the button,
 * and the panel stays docked on the right without blocking the page behind it.
 */
export function AssistantDock({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<AssistantScope | null>(null);
  // The conversation followed on each affaire, kept while the member moves between its screens.
  const [activeThreads, setActiveThreads] = useState<Record<string, string | null>>({});
  const shown = enabled && open && scope !== null;

  useEffect(() => {
    // Wide screens give the panel its width (see assistant.css) instead of being covered by it.
    if (shown) document.documentElement.dataset.assistantOpen = "true";
    else delete document.documentElement.dataset.assistantOpen;
    return () => { delete document.documentElement.dataset.assistantOpen; };
  }, [shown]);

  const toggle = useCallback(() => setOpen((current) => !current), []);
  const value = useMemo<AssistantDockValue>(
    () => ({ enabled, open, hasScope: scope !== null, toggle, setScope }),
    [enabled, open, scope, toggle],
  );

  return (
    <AssistantDockContext.Provider value={value}>
      {children}
      {shown ? (
        <AssistantPanel
          key={scope.projectId}
          scope={scope}
          activeThreadId={activeThreads[scope.projectId] ?? null}
          onActiveThreadChange={(threadId) => setActiveThreads((current) => ({ ...current, [scope.projectId]: threadId }))}
          onClose={() => {
            setOpen(false);
            // Closing gives the focus back to the button that opened the panel.
            document.querySelector<HTMLElement>('[data-testid="assistant-toggle"]')?.focus();
          }}
        />
      ) : null}
    </AssistantDockContext.Provider>
  );
}

/** Declares the screen the member is on, for as long as it is mounted. */
export function useAssistantScreen(scope: AssistantScope | null) {
  const setScope = useContext(AssistantDockContext)?.setScope;
  const key = scope ? JSON.stringify(scope) : null;
  useEffect(() => {
    if (!setScope) return;
    setScope(key ? (JSON.parse(key) as AssistantScope) : null);
    return () => setScope(null);
  }, [key, setScope]);
}

/** The header button of a screen that declared itself. Renders nothing where the assistant is off. */
export function AssistantToggle() {
  const dock = useContext(AssistantDockContext);
  if (!dock?.enabled || !dock.hasScope) return null;
  return (
    <Button
      type="button"
      variant={dock.open ? "secondary" : "outline"}
      aria-pressed={dock.open}
      aria-controls="assistant-panel"
      onClick={dock.toggle}
      leftIcon={<Sparkles aria-hidden="true" className="size-4" />}
      data-testid="assistant-toggle"
    >
      Assistant
    </Button>
  );
}
