"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Minus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  AssistantAiSettingsMenu, AssistantAiSettingsProvider, useAssistantAiSettings,
} from "@/components/ai/AssistantAiSettings";
import { Button } from "@/components/ui/button";
import { assistantContextForPath, ASSISTANT_CONTEXT_LABELS, type AssistantSessionContext, type WorkbookSnapshot } from "@/lib/assistant/session-context";

import { AssistantDockContext, type AssistantScope, type Registration, type WorkbookStatus } from "./dock-context";

type ConversationMode = "page" | "help" | "project" | "workbook";

const WORKBOOK_PATH = "/dashboard/products/import-workbook";
const AssistantPanel = dynamic(() => import("./AssistantPanel"), { ssr: false });
const AssistantSessionPanel = dynamic(() => import("./AssistantSessionPanel"), { ssr: false });

export default function DashboardAssistantWorkspace({ userId, tenantId, children }: {
  userId: string; tenantId: string; children: ReactNode;
}) {
  return (
    <AssistantAiSettingsProvider userId={userId} tenantId={tenantId}>
      <DashboardAssistant userId={userId} tenantId={tenantId}>{children}</DashboardAssistant>
    </AssistantAiSettingsProvider>
  );
}

function DashboardAssistant({ userId, tenantId, children }: { userId: string; tenantId: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const settings = useAssistantAiSettings();
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [mode, setMode] = useState<ConversationMode>("page");
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [projectPanel, setProjectPanel] = useState<AssistantScope | null>(null);
  const [activeThreads, setActiveThreads] = useState<Record<string, string | null>>({});
  const [workbookStatus, setWorkbookStatus] = useState<WorkbookStatus | null>(null);
  const [workbookControls, setWorkbookControls] = useState<HTMLDivElement | null>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const location = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const lastWorkbookUrl = useRef(WORKBOOK_PATH);

  const routeContext = useMemo(() => assistantContextForPath(pathname), [pathname]);
  const registered = registration?.pathname === pathname ? registration.scope : null;
  const currentProject = useMemo(() => registered ?? (routeContext.kind === "project"
    ? { projectId: routeContext.projectId, screen: routeContext.screen } : null), [registered, routeContext]);
  const context: AssistantSessionContext = mode === "help" ? { kind: "help" }
    : registered ? { kind: "project", ...registered } : routeContext;
  const onWorkbook = pathname === WORKBOOK_PATH;
  const workbookAvailable = onWorkbook && workbookStatus !== null;
  const canShow = !pathname.endsWith("/print") && pathname.startsWith("/dashboard");
  const showProject = mode === "project" && currentProject?.projectId === projectPanel?.projectId && projectPanel !== null;
  const showWorkbook = mode === "workbook" && workbookAvailable;
  const visibleMode = showProject ? "project" : showWorkbook ? "workbook" : mode === "help" ? "help" : "page";

  const register = useCallback((value: Registration) => {
    setRegistration(value);
    return () => setRegistration((current) => current === value ? null : current);
  }, []);

  useEffect(() => {
    if (onWorkbook) lastWorkbookUrl.current = window.location.pathname + window.location.search;
  }, [onWorkbook]);

  useEffect(() => {
    const anchor = location.current;
    if (!canShow || !anchor) return;
    const main = document.getElementById("dashboard-main-content");
    if (!main) return;
    const update = () => main.style.setProperty("--assistant-dock-reserve", Math.ceil(anchor.getBoundingClientRect().height) + "px");
    const resize = new ResizeObserver(update);
    resize.observe(anchor);
    update();
    return () => {
      resize.disconnect();
      main.style.removeProperty("--assistant-dock-reserve");
    };
  }, [canShow]);

  function openPanel(next?: ConversationMode) {
    if (!visited || !settings?.options) settings?.refresh();
    if (next) chooseMode(next);
    else if (!visited && currentProject) chooseMode("project");
    setVisited(true);
    setOpen(true);
  }

  function collapse() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }

  function goToWorkbook() {
    openPanel("workbook");
    if (!onWorkbook) router.push(lastWorkbookUrl.current);
  }

  function prepareWorkbookExclusion(snapshot: WorkbookSnapshot, criterion: string) {
    if (!onWorkbook || !workbookStatus || workbookStatus.snapshot !== snapshot || workbookStatus.running) return;
    workbookStatus.prepare(criterion);
    openPanel("workbook");
  }

  function previewWorkbookReliabilityZero(snapshot: WorkbookSnapshot) {
    if (!onWorkbook || !workbookStatus || workbookStatus.snapshot !== snapshot || workbookStatus.running) return false;
    if (!workbookStatus.previewReliabilityZero()) return false;
    chooseMode("workbook");
    return true;
  }

  const chooseMode = useCallback((next: ConversationMode) => {
    if (next === "project" && currentProject) setProjectPanel(currentProject);
    setMode(next);
  }, [currentProject]);

  const contextOptions = useMemo(() => {
    const availableModes: { id: ConversationMode; label: string }[] = [
      { id: "page", label: "Cette page · " + ASSISTANT_CONTEXT_LABELS[routeContext.kind] },
      { id: "help", label: "Aide générale" },
    ];
    if (currentProject) availableModes.push({ id: "project", label: "Fils de l’affaire" });
    if (workbookAvailable) availableModes.push({ id: "workbook", label: "Analyse du classeur" });
    return availableModes.map(({ id, label }) => ({ id, label, active: id === visibleMode, select: () => chooseMode(id) }));
  }, [routeContext.kind, currentProject, workbookAvailable, visibleMode, chooseMode]);
  const workbookActive = open && showWorkbook;
  const dock = useMemo(() => ({ register, setHeaderTarget, setWorkbookStatus, workbookControls, workbookActive, contextOptions }),
    [register, workbookControls, workbookActive, contextOptions]);
  const workbookUpdate = workbookStatus?.running ? "Analyse en cours" : workbookStatus?.result ? "Analyse terminée" : null;

  return (
    <AssistantDockContext.Provider value={dock}>
      {children}
      {canShow && headerTarget ? createPortal(
        <Button
          ref={trigger}
          type="button"
          size="sm"
          aria-expanded={open}
          aria-controls="mergeone-assistant"
          aria-label="Assistant MergeOne"
          aria-describedby={workbookUpdate ? "mergeone-assistant-workbook-status" : undefined}
          title={workbookUpdate ? `Assistant MergeOne · ${workbookUpdate}` : "Assistant MergeOne"}
          data-testid="assistant-toggle"
          onClick={() => {
            if (open) {
              collapse();
              return;
            }
            openPanel();
            requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
          }}
          className="relative size-9 rounded-full border border-(--workbook-composer-border) bg-(--workbook-composer-surface) text-(--workbook-composer-text) hover:bg-(--workbook-composer-control) focus-visible:ring-white xl:w-auto xl:px-3"
        >
          <Sparkles aria-hidden="true" className="size-4 text-(--workbook-composer-send)" />
          <span className="hidden xl:inline">Assistant MergeOne</span>
          {workbookUpdate ? (
            <>
              <span aria-hidden="true" className="absolute end-0.5 top-0.5 size-2 rounded-full bg-(--workbook-composer-send) 2xl:hidden" />
              <span id="mergeone-assistant-workbook-status" className="sr-only 2xl:not-sr-only 2xl:rounded-full 2xl:bg-(--workbook-composer-control) 2xl:px-2 2xl:text-xs">
                {workbookUpdate}
              </span>
            </>
          ) : null}
        </Button>,
        headerTarget,
      ) : null}
      <div ref={location} hidden={!canShow || !open} className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-40 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="pointer-events-auto mx-auto w-full max-w-4xl">
          <section ref={panel} id="mergeone-assistant" aria-label="Assistant MergeOne" tabIndex={-1}
            className="overflow-hidden rounded-2xl border border-(--workbook-composer-border) bg-(--workbook-composer-surface) shadow-xl sm:rounded-3xl"
            onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) collapse(); }}>
            <header className="flex min-w-0 flex-wrap items-center gap-2 border-b border-(--workbook-composer-border) px-3 py-2 text-(--workbook-composer-text)">
              <p className="mr-auto flex items-center gap-2 text-sm font-semibold">
                <Sparkles aria-hidden="true" className="size-4 text-(--workbook-composer-send)" /> Assistant MergeOne
              </p>
              {showWorkbook ? (
                <Button type="button" variant="ghost" size="xs" onClick={() => chooseMode("page")}
                  className="text-(--workbook-composer-text) hover:bg-(--workbook-composer-control) hover:text-(--workbook-composer-text)"
                  leftIcon={<ArrowLeft aria-hidden="true" />}>Conversation</Button>
              ) : null}
              {!showWorkbook && workbookStatus && workbookUpdate ? (
                <Button type="button" variant="ghost" size="xs" onClick={goToWorkbook}
                  className="text-(--workbook-composer-text) hover:bg-(--workbook-composer-control) hover:text-(--workbook-composer-text)"
                  rightIcon={<ArrowUpRight aria-hidden="true" />}>{workbookStatus.label}</Button>
              ) : null}
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Réduire l’assistant" onClick={collapse}
                className="text-(--workbook-composer-text) hover:bg-(--workbook-composer-control) hover:text-(--workbook-composer-text)">
                <Minus aria-hidden="true" />
              </Button>
            </header>
            {visited ? <AssistantSessionPanel context={context} userId={userId} tenantId={tenantId}
              workbookSnapshot={onWorkbook && !workbookStatus?.running ? workbookStatus?.snapshot : undefined}
              onWorkbookExclusion={prepareWorkbookExclusion}
              onWorkbookReliabilityZero={previewWorkbookReliabilityZero}
              visible={open && !showProject && !showWorkbook && canShow} contextOptions={contextOptions} /> : null}
            {projectPanel ? (
              <div hidden={!showProject}>
                <div className="flex justify-end px-3 py-1"><AssistantAiSettingsMenu contextOptions={contextOptions} /></div>
                <AssistantPanel key={projectPanel.projectId}
                  scope={showProject && currentProject ? currentProject : projectPanel}
                  owner={{ userId, tenantId }}
                  activeThreadId={activeThreads[projectPanel.projectId] ?? null}
                  onActiveThreadChange={(threadId) => setActiveThreads((current) => ({ ...current, [projectPanel.projectId]: threadId }))}
                  onClose={collapse} embedded />
              </div>
            ) : null}
            <div hidden={!showWorkbook}>
              <div ref={setWorkbookControls} className="min-w-0" />
            </div>
          </section>
        </div>
      </div>
    </AssistantDockContext.Provider>
  );
}
