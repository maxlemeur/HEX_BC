"use client";

import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus } from "lucide-react";

import { usePdfPage, type PdfPageSource } from "@/components/takeoff/review/usePdfPage";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import type { ItemDetailPlanView } from "@/lib/takeoff/item-detail-contracts";
import {
  ITEM_DETAIL_PAGE_FAILURE_LABELS,
  ITEM_DETAIL_PLAN_UNAVAILABLE_LABELS,
  formatItemDetailDate,
} from "@/lib/takeoff/item-detail-labels";
import { zoomedBy } from "@/lib/takeoff/pdf-page-geometry";

/**
 * The centre of the detail of an item: its plan's page, drawn by the review's page reader from the bytes the server
 * resolved (the copy a reading sealed, or the dossier's current copy, asked at the moment it is shown), with or without
 * a vector reading. One page at a time; zoom with the buttons or Ctrl/⌘ + wheel, pan by dragging; the pages worth
 * turning to (the observations', the pages searched) in a list. When the bytes cannot be shown the plan is named with
 * what is known of it, never replaced by another copy.
 */

export type ItemDetailPlanResolution =
  | { state: "none" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; view: ItemDetailPlanView };

type View = { zoom: number; offset: { x: number; y: number } };
const FITTED: View = { zoom: 1, offset: { x: 0, y: 0 } };

function pdfSourceOf(view: ItemDetailPlanView | null, dossierUrl: (setId: string, fileId: string) => Promise<string | null>): PdfPageSource | null {
  if (!view) return null;
  const { document } = view;
  if (document.kind === "attested") return { key: `attested:${document.href}`, url: async () => document.href };
  if (document.kind === "dossier") {
    return { key: `dossier:${document.planFileId}:${view.plan.generation ?? ""}`, url: () => dossierUrl(document.planSetId, document.planFileId) };
  }
  return null;
}

export function ItemDetailPlanPane({ resolution, page, requestedMissing, pagesOfInterest, onPage, dossierUrl, emptyMessage }: {
  resolution: ItemDetailPlanResolution;
  page: number;
  requestedMissing: boolean;
  pagesOfInterest: readonly number[];
  onPage: (page: number) => void;
  dossierUrl: (setId: string, fileId: string) => Promise<string | null>;
  emptyMessage: string;
}) {
  const view = resolution.state === "ready" ? resolution.view : null;
  const source = useMemo(() => pdfSourceOf(view, dossierUrl), [view, dossierUrl]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  // One view per page shown: a new page or a new plan opens fitted.
  const viewKey = `${source?.key ?? ""}:${page}`;
  const [shownView, setShownView] = useState<{ key: string; view: View }>({ key: viewKey, view: FITTED });
  const current = shownView.key === viewKey ? shownView.view : FITTED;
  const change = (next: (value: View) => View) => setShownView({ key: viewKey, view: next(current) });

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    setFrameWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setFrameWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The plan's size is known once its page is read; until then the canvas is not drawn.
  const [size, setSize] = useState<{ key: string; width: number } | null>(null);
  const fit = size && size.key === viewKey ? (frameWidth > 0 ? frameWidth / size.width : 0.25) : 0;
  const reader = usePdfPage({ source, page: source ? page : null, scale: fit * current.zoom, canvas });
  if (reader.size && (size?.key !== viewKey || size.width !== reader.size.width)) setSize({ key: viewKey, width: reader.size.width });

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setShownView((value) => ({ key: viewKey, view: { ...(value.key === viewKey ? value.view : FITTED),
        zoom: zoomedBy(value.key === viewKey ? value.view.zoom : 1, event.deltaY < 0 ? 1.15 : 1 / 1.15) } }));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [viewKey]);

  const pageCount = reader.pageCount ?? view?.plan.pageCount ?? null;
  const pageChoices = [...new Set([...pagesOfInterest, page])].sort((left, right) => left - right);
  const unavailable = view?.document.kind === "unavailable" ? ITEM_DETAIL_PLAN_UNAVAILABLE_LABELS[view.document.reason] : null;
  const failure = reader.failure ? ITEM_DETAIL_PAGE_FAILURE_LABELS[reader.failure] : null;
  const onPointerDown = (event: ReactPointerEvent) => {
    drag.current = { x: event.clientX - current.offset.x, y: event.clientY - current.offset.y };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const start = drag.current;
    if (start) change((value) => ({ ...value, offset: { x: event.clientX - start.x, y: event.clientY - start.y } }));
  };

  return (
    <section aria-label="Plan du poste" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-subtle">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
        <span className="min-w-0 truncate text-sm font-medium text-foreground" title={view?.plan.name}>
          {view?.plan.name ?? (resolution.state === "loading" ? "Plan…" : "Plan")}
        </span>
        {view ? (
          <nav aria-label="Pages du plan" className="flex items-center gap-1">
            <Button size="icon-xs" variant="ghost" aria-label="Page précédente" disabled={page <= 1} onClick={() => onPage(page - 1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <label className="sr-only" htmlFor="poste-detail-page">Page affichée</label>
            <NativeSelect id="poste-detail-page" size="sm" className="w-28" value={String(page)} onChange={(event) => onPage(Number(event.target.value))}>
              {pageChoices.map((choice) => (
                <option key={choice} value={choice}>{`Page ${choice}`}{pagesOfInterest.includes(choice) ? " ●" : ""}</option>
              ))}
            </NativeSelect>
            <span className="whitespace-nowrap text-xs text-muted-foreground">{pageCount ? `sur ${pageCount}` : ""}</span>
            <Button size="icon-xs" variant="ghost" aria-label="Page suivante" disabled={pageCount !== null && page >= pageCount}
              onClick={() => onPage(page + 1)}>
              <ChevronRight className="size-4" />
            </Button>
          </nav>
        ) : null}
        <div role="toolbar" aria-label="Zoom du plan" className="ml-auto flex items-center gap-1">
          <Button size="icon-xs" variant="outline" aria-label="Zoom arrière" onClick={() => change((value) => ({ ...value, zoom: zoomedBy(value.zoom, 1 / 1.25) }))}>
            <Minus className="size-4" />
          </Button>
          <Button size="xs" variant="outline" onClick={() => change((value) => ({ ...value, zoom: 1 }))}>100 %</Button>
          <Button size="icon-xs" variant="outline" aria-label="Zoom avant" onClick={() => change((value) => ({ ...value, zoom: zoomedBy(value.zoom, 1.25) }))}>
            <Plus className="size-4" />
          </Button>
          <Button size="xs" variant="ghost" onClick={() => change(() => FITTED)}><Maximize2 className="mr-1 size-4" />Ajuster</Button>
          {reader.loading || reader.rendering ? <Spinner aria-label="Rendu du plan" className="ml-1 size-4" /> : null}
        </div>
      </div>
      {requestedMissing ? (
        <p role="status" className="shrink-0 border-b border-border bg-warning-light px-3 py-1.5 text-xs">
          La page demandée n’existe pas sur ce plan : la première page est affichée.
        </p>
      ) : null}
      <div ref={frame} data-testid="poste-detail-plan" className="relative min-h-[20rem] flex-1 cursor-grab overflow-hidden"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }}
        onPointerLeave={() => { drag.current = null; }}>
        <div className="absolute left-0 top-0" style={{ transform: `translate(${current.offset.x}px, ${current.offset.y}px)` }}>
          <canvas ref={canvas} aria-label={view ? `${view.plan.name}, page ${page}` : undefined} role="img" className="block bg-white shadow-sm" />
        </div>
        {resolution.state === "none" || resolution.state === "error" || unavailable || failure ? (
          <div className="absolute inset-0 flex items-start justify-center p-6">
            <div role="status" className="max-w-md space-y-1 rounded-md border border-border bg-surface p-4 text-sm shadow-sm">
              <p className="font-medium text-foreground">
                {resolution.state === "none" ? emptyMessage : resolution.state === "error" ? resolution.message : unavailable ?? failure}
              </p>
              {view && unavailable ? (
                <p className="text-xs text-muted-foreground">
                  {view.plan.name}{view.plan.generation ? ` · génération ${view.plan.generation}` : ""}
                  {view.reading?.finishedAt ? ` · lu le ${formatItemDetailDate(view.reading.finishedAt)}` : ""}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        {resolution.state === "loading" ? (
          <p className="absolute left-3 top-3 flex items-center gap-2 text-xs text-muted-foreground"><Spinner aria-label="Chargement" />Chargement du plan…</p>
        ) : null}
      </div>
    </section>
  );
}
