"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Minus, Plus } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Spinner } from "@/components/ui/spinner";
import { cappedScale, loadLabPdf, renderRegion } from "@/components/takeoff/lab/lab-pdf";
import type { NormalizedBox } from "@/lib/takeoff/lab/geometry";
import { cn } from "@/lib/utils";

const ZOOMS = { min: 0.02, max: 8 };

type Props = {
  url: string | null;
  page: number;
  onPageChange?: (page: number) => void;
  onDocument?: (pdf: PDFDocumentProxy | null) => void;
  /** Region drawn on the page (crop), shown as a frame. */
  box?: NormalizedBox | null;
  /** When set, dragging draws the crop region instead of panning. */
  cropMode?: boolean;
  onBoxChange?: (box: NormalizedBox | null) => void;
  /** Renders only this region (verdicts: the cropped zone). */
  region?: NormalizedBox | null;
  /** Drawn over the whole rendered page (vectors: an SVG in page points), never with `region`. */
  overlay?: React.ReactNode;
  label: string;
  className?: string;
};

/** Canvas of the lab: pan by dragging, zoom with the wheel or − / 100 % / + / Ajuster. */
export function LabPdfCanvas({ url, page, onPageChange, onDocument, box = null, cropMode = false, onBoxChange, region = null, overlay, label, className }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  /** Pixels per PDF point; null: fit the panel (« Ajuster »). */
  const [zoom, setZoom] = useState<number | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const fitRef = useRef(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [rendered, setRendered] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [draft, setDraft] = useState<NormalizedBox | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; startX?: number; startY?: number } | null>(null);
  const onDocumentRef = useRef(onDocument);
  onDocumentRef.current = onDocument;

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!url) {
      setPdf(null);
      setStatus("idle");
      onDocumentRef.current?.(null);
      return;
    }
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    // The previous document is destroyed below: never render it, nor hand it to the parent.
    setPdf(null);
    onDocumentRef.current?.(null);
    setStatus("loading");
    setZoom(null);
    void loadLabPdf(url).then(async (loaded) => {
      task = loaded.task;
      if (!active) {
        void loaded.task.destroy().catch(() => undefined);
        return;
      }
      const document = await loaded.pdf;
      if (!active) return;
      setPdf(document);
      onDocumentRef.current?.(document);
    }).catch(() => {
      if (active) setStatus("error");
    });
    return () => {
      active = false;
      void task?.destroy().catch(() => undefined);
    };
  }, [url]);

  useEffect(() => {
    if (!pdf || !canvas.current || size.width === 0 || page < 1 || page > pdf.numPages) return;
    let active = true;
    let task: RenderTask | undefined;
    const element = canvas.current;
    setStatus("loading");
    void pdf.getPage(page).then(async (source) => {
      if (!active) return;
      const base = source.getViewport({ scale: 1 });
      const shown = region ?? { x: 0, y: 0, width: 1, height: 1 };
      const regionWidth = base.width * shown.width;
      const regionHeight = base.height * shown.height;
      const fit = Math.max(ZOOMS.min, Math.min((size.width - 24) / regionWidth, (size.height - 24) / regionHeight));
      fitRef.current = fit;
      setFitScale(fit);
      const cssScale = zoom ?? fit;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const renderScale = cappedScale(regionWidth, regionHeight, cssScale * ratio);
      task = renderRegion(source, element, renderScale, region);
      element.style.width = `${regionWidth * cssScale}px`;
      element.style.height = `${regionHeight * cssScale}px`;
      await task.promise;
      if (active) {
        setRendered({ width: regionWidth * cssScale, height: regionHeight * cssScale });
        setStatus("ready");
      }
    }).catch((error: { name?: string }) => {
      if (active && error?.name !== "RenderingCancelledException") setStatus("error");
    });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, page, zoom, size.width, size.height, region]);

  const zoomBy = useCallback((factor: number) => setZoom((value) => Math.min(ZOOMS.max, Math.max(ZOOMS.min, (value ?? fitRef.current) * factor))), []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // Wheel zooms the plan (a non-passive listener: the panel itself must not scroll).
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const relative = (event: React.PointerEvent) => {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !viewport.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = cropMode ? relative(event) : null;
    drag.current = { x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop,
      startX: point?.x, startY: point?.y };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || !viewport.current) return;
    if (cropMode && start.startX !== undefined && start.startY !== undefined) {
      const point = relative(event);
      if (!point) return;
      setDraft({ x: Math.min(start.startX, point.x), y: Math.min(start.startY, point.y),
        width: Math.abs(point.x - start.startX), height: Math.abs(point.y - start.startY) });
      return;
    }
    viewport.current.scrollLeft = start.left - (event.clientX - start.x);
    viewport.current.scrollTop = start.top - (event.clientY - start.y);
  }

  function onPointerUp() {
    drag.current = null;
    if (draft) {
      if (draft.width > 0.01 && draft.height > 0.01) onBoxChange?.(draft);
      setDraft(null);
    }
  }

  const frame = draft ?? (region ? null : box);
  const pages = pdf?.numPages ?? 0;
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div ref={viewport} role="region" aria-label={label} tabIndex={0}
        className={cn("relative min-h-0 flex-1 overflow-auto bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
          cropMode ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          if (event.key === "+" || event.key === "=") zoomBy(1.25);
          if (event.key === "-") zoomBy(0.8);
        }}>
        <div className="flex min-h-full min-w-full items-center justify-center p-3" style={{ width: rendered.width + 24 || undefined }}>
          <div className="relative shadow-sm">
            <canvas ref={canvas} className="block bg-white" aria-hidden="true" />
            {overlay && !region && rendered.width > 0 && status !== "error" ? (
              <div className="pointer-events-none absolute inset-0">{overlay}</div>
            ) : null}
            {frame && status === "ready" ? (
              <div className="pointer-events-none absolute border-2 border-primary bg-primary/10"
                style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.width * 100}%`, height: `${frame.height * 100}%` }} />
            ) : null}
          </div>
        </div>
        {status === "loading" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><Spinner aria-label="Chargement du plan" /></div>
        ) : null}
        {status === "error" ? (
          <p role="alert" className="absolute inset-x-4 top-4 rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-sm text-danger">
            Le plan n’a pas pu être affiché.
          </p>
        ) : null}
        {!url ? <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Choisissez un document.</p> : null}
      </div>
      <div className="flex h-10 shrink-0 items-center gap-1 border-t border-border bg-surface px-2 text-xs text-muted-foreground">
        {onPageChange && pages > 1 ? (
          <>
            <IconButton label="Page précédente" size="icon-xs" variant="ghost" icon={<ChevronLeft />} disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
            <span className="tabular-nums">Page {page} / {pages}</span>
            <IconButton label="Page suivante" size="icon-xs" variant="ghost" icon={<ChevronRight />} disabled={page >= pages} onClick={() => onPageChange(page + 1)} />
          </>
        ) : pages > 0 ? <span className="tabular-nums">Page {page} / {pages}</span> : null}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">
            Ouvrir le PDF <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Zoom arrière" size="icon-xs" variant="ghost" icon={<Minus />} onClick={() => zoomBy(0.8)} disabled={!pdf} />
          <Button size="xs" variant="ghost" className="min-w-14 tabular-nums" onClick={() => setZoom(1)} disabled={!pdf} aria-label="Taille réelle (100 %)">
            {Math.round((zoom ?? fitScale) * 100)} %
          </Button>
          <IconButton label="Zoom avant" size="icon-xs" variant="ghost" icon={<Plus />} onClick={() => zoomBy(1.25)} disabled={!pdf} />
          <Button size="xs" variant="outline" onClick={() => setZoom(null)} disabled={!pdf}>Ajuster</Button>
        </div>
      </div>
    </div>
  );
}
