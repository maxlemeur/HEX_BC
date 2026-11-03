"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LoaderCircle, Maximize2, Minus, Plus } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { takeoffVectorReadingResponseSchema, type TakeoffVectorReadingResponse } from "@/lib/takeoff/vectors/read-contracts";

// Viewer of a takeoff job's vector reading (TI-662), in the takeoff review:
// the plan page rendered by pdfjs in the browser, the centrelines of its
// measured items drawn over it per network, a toggle per network (Alt-click
// isolates it), the detection badge and the page scale (« échelle non
// vérifiée » and its reason). Data comes from GET /api/takeoff/jobs/{id}/
// vector-pages under the user's session; the PDF from the plan file's signed
// URL. Geometry is in metres from the page's top-left corner at the page's
// scale. Ctrl/⌘ + wheel zooms (a plain wheel scrolls the review); the canvas
// is capped at MAX_CANVAS_PIXELS, drawn smaller and stretched beyond.

const MM_PER_POINT = 25.4 / 72;
/** Pixels of the rendered page at most (Safari refuses larger canvases; an A0 at zoom 8 would be hundreds of MB). */
const MAX_CANVAS_PIXELS = 16_777_216;
const PALETTE = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];
const SCALE_LABELS: Record<string, string> = { verified: "vérifiée par une cote", format: "format conforme", calibrated: "calibrée", unverified: "non vérifiée" };

type VectorPage = TakeoffVectorReadingResponse["pages"][number];

/** « 1/50 », a calibrated « 1/47.6 ». */
function formatDenominator(denominator: number) {
  return Number.isInteger(denominator) ? String(denominator) : denominator.toFixed(1);
}

function networkLabel(item: VectorPage["items"][number]) {
  return item.geometry.network ?? "à revoir";
}

async function readJson(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<{ data?: unknown }>;
}

export function TakeoffVectorViewer({ jobId, planSetId }: { jobId: string; planSetId: string | null }) {
  const [reading, setReading] = useState<TakeoffVectorReadingResponse | null>(null);
  const [error, setError] = useState("");
  const [pageId, setPageId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [rendering, setRendering] = useState(false);
  const [base, setBase] = useState<{ width: number; height: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;
    void readJson(`/api/takeoff/jobs/${encodeURIComponent(jobId)}/vector-pages`)
      .then((body) => {
        const parsed = takeoffVectorReadingResponseSchema.parse(body.data);
        if (!active) return;
        setReading(parsed);
        setPageId(parsed.pages[0]?.id ?? null);
      })
      .catch(() => active && setError("La lecture vectorielle de ce métré n’a pas pu être chargée."));
    return () => {
      active = false;
    };
  }, [jobId]);

  const page = reading?.pages.find((entry) => entry.id === pageId) ?? null;
  const networks = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of page?.items ?? []) {
      if (item.geometry.kind === "insulation") continue;
      totals.set(networkLabel(item), (totals.get(networkLabel(item)) ?? 0) + (item.geometry.length_m ?? 0));
    }
    return [...totals.entries()].sort(([left], [right]) => (left < right ? -1 : 1)).map(([name, length], index) => ({
      name, length, color: PALETTE[index % PALETTE.length],
    }));
  }, [page]);

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    setPdf(null);
    if (!page?.plan_file_id || !planSetId) return;
    void readJson(`/api/takeoff/plan-sets/${encodeURIComponent(planSetId)}/files/${encodeURIComponent(page.plan_file_id)}?include_download_url=true`)
      .then(async (body) => {
        const url = (body.data as { plan_file?: { download_url?: string | null } } | undefined)?.plan_file?.download_url;
        if (!url || !active) return;
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const assetRoot = new URL("/assets/pdfjs/", window.location.origin).href;
        task = pdfjs.getDocument({ url, useSystemFonts: true, cMapUrl: `${assetRoot}cmaps/`, cMapPacked: true,
          standardFontDataUrl: `${assetRoot}standard_fonts/`, wasmUrl: `${assetRoot}wasm/`, iccUrl: `${assetRoot}iccs/` });
        const document = await task.promise;
        if (active) setPdf(document);
      })
      .catch(() => active && setError("Le plan de cette page n’a pas pu être affiché ; la géométrie reste visible."));
    return () => {
      active = false;
      void task?.destroy().catch(() => undefined);
    };
  }, [page?.plan_file_id, planSetId]);

  useEffect(() => {
    if (!page) return;
    setBase({ width: page.reading.size_pt[0], height: page.reading.size_pt[1] });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [page]);

  const fit = useMemo(() => {
    const width = frame.current?.clientWidth ?? 0;
    return base && width > 0 ? width / base.width : 0.25;
  }, [base]);
  const scale = fit * zoom;

  useEffect(() => {
    if (!pdf || !page || !canvas.current) return;
    let active = true;
    let render: RenderTask | undefined;
    const element = canvas.current;
    setRendering(true);
    void pdf.getPage(page.source_page).then(async (source) => {
      if (!active) return;
      const unit = source.getViewport({ scale: 1 });
      const wanted = scale * Math.min(window.devicePixelRatio || 1, 2);
      const renderScale = Math.min(wanted, Math.sqrt(MAX_CANVAS_PIXELS / (unit.width * unit.height)));
      const viewport = source.getViewport({ scale: renderScale });
      element.width = Math.ceil(viewport.width);
      element.height = Math.ceil(viewport.height);
      element.style.width = `${unit.width * scale}px`;
      element.style.height = `${unit.height * scale}px`;
      render = source.render({ canvas: element, viewport });
      await render.promise;
      if (active) setRendering(false);
    }).catch(() => active && setRendering(false));
    return () => {
      active = false;
      render?.cancel();
    };
  }, [pdf, page, scale]);

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms the plan, without zooming the page: a non-passive listener.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((current) => Math.min(8, Math.max(0.25, current * (event.deltaY < 0 ? 1.15 : 1 / 1.15))));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [reading]);

  if (error && !reading) return <p className="text-sm text-danger">{error}</p>;
  if (!reading) return <p className="text-sm text-muted-foreground"><LoaderCircle className="mr-2 inline size-4 animate-spin" />Lecture vectorielle…</p>;
  if (reading.pages.length === 0) return null;

  const denominator = page?.reading.scale.denominator ?? null;
  // Page metres back to sheet points, then to screen pixels.
  const toScreen = (metres: number) => (denominator ? ((metres * 1000) / denominator / MM_PER_POINT) * scale : 0);
  const colorOf = new Map(networks.map((entry) => [entry.name, entry.color]));
  const toggle = (name: string, isolate: boolean) => setHidden((current) => {
    if (isolate) return new Set(networks.map((entry) => entry.name).filter((entry) => entry !== name));
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });
  const onPointerDown = (event: ReactPointerEvent) => {
    drag.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (drag.current) setOffset({ x: event.clientX - drag.current.x, y: event.clientY - drag.current.y });
  };
  const scaleStatus = page?.reading.scale.status ?? "unverified";

  return (
    <section aria-label="Lecture vectorielle du plan" className="grid gap-3 rounded-lg border border-border bg-surface p-3 lg:grid-cols-[18rem_1fr]">
      <div className="flex min-w-0 flex-col gap-3">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`vector-page-${jobId}`}>Page lue</label>
        <NativeSelect id={`vector-page-${jobId}`} size="sm" value={pageId ?? ""} onChange={(event) => setPageId(event.target.value)}>
          {reading.pages.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.source_file_name ?? "Plan"} · page {entry.source_page}</option>
          ))}
        </NativeSelect>
        <div className="flex flex-wrap gap-2">
          <Badge variant={scaleStatus === "unverified" ? "warning" : "neutral"}>
            Échelle {denominator ? `1/${formatDenominator(denominator)} ` : ""}{SCALE_LABELS[scaleStatus]}
          </Badge>
          {page?.reading.detection != null ? <Badge variant="info">Détection {Math.round(page.reading.detection * 100)} %</Badge> : null}
        </div>
        {scaleStatus === "unverified" ? (
          <p className="text-xs text-warning">Échelle non vérifiée ({page?.reading.scale.reason ?? "raison inconnue"}) : ni longueur ni surface sur cette page.</p>
        ) : null}
        <div role="group" aria-label="Réseaux" className="flex flex-col gap-1">
          {networks.length === 0 ? <p className="text-xs text-muted-foreground">Aucun réseau mesuré sur cette page.</p> : null}
          {networks.map((entry) => (
            <label key={entry.name} className="flex items-center gap-2 text-sm" title="Alt-clic : n’afficher que ce réseau">
              {/* One handler: React fires onClick and onChange for the same click, so Alt is read from the change's click. */}
              <input type="checkbox" checked={!hidden.has(entry.name)} aria-label={`Afficher ${entry.name}`}
                onChange={(event) => toggle(entry.name, (event.nativeEvent as MouseEvent).altKey === true)} />
              <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: entry.color }} />
              <span className="font-medium">{entry.name}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{entry.length.toFixed(2)} m</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {(page?.items ?? []).filter((item) => !hidden.has(networkLabel(item))).length} / {page?.items.length ?? 0} éléments affichés
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-1" role="toolbar" aria-label="Zoom du plan">
          <Button size="icon-sm" variant="outline" aria-label="Zoom arrière" onClick={() => setZoom((value) => Math.max(0.25, value / 1.25))}><Minus className="size-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => setZoom(1)}>100 %</Button>
          <Button size="icon-sm" variant="outline" aria-label="Zoom avant" onClick={() => setZoom((value) => Math.min(8, value * 1.25))}><Plus className="size-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}><Maximize2 className="mr-1 size-4" />Ajuster</Button>
          {rendering ? <LoaderCircle aria-label="Rendu du plan" className="ml-2 size-4 animate-spin text-muted-foreground" /> : null}
        </div>
        <div ref={frame} className="relative h-[32rem] cursor-grab overflow-hidden rounded-md border border-border-subtle bg-surface-subtle"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }}
          onPointerLeave={() => { drag.current = null; }}>
          <div className="absolute left-0 top-0" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
            <canvas ref={canvas} aria-hidden className="block" />
            {base ? (
              <svg aria-label="Géométrie mesurée" role="img" className="absolute left-0 top-0" width={base.width * scale} height={base.height * scale}>
                {(page?.items ?? []).filter((item) => !hidden.has(networkLabel(item)) && item.geometry.kind !== "insulation").map((item) => (
                  <g key={item.takeoff_item_id} data-network={networkLabel(item)} stroke={colorOf.get(networkLabel(item)) ?? PALETTE[0]} strokeWidth={3} strokeLinecap="round">
                    {item.geometry.segments_m.map(([x0, y0, x1, y1], index) => (
                      <line key={index} x1={toScreen(x0)} y1={toScreen(y0)} x2={toScreen(x1)} y2={toScreen(y1)} />
                    ))}
                  </g>
                ))}
              </svg>
            ) : null}
          </div>
        </div>
        {error ? <p className="text-xs text-warning">{error}</p> : null}
      </div>
    </section>
  );
}
