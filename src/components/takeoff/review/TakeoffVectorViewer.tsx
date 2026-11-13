"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LoaderCircle, Maximize2, Minus, Plus } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { CLASS_SOURCE_LABELS, isLocalModelPromptVersion, isModelSource, type ClassSource } from "@/lib/takeoff/vectors/classify";
import { takeoffVectorReadingResponseSchema, type TakeoffVectorReadingResponse } from "@/lib/takeoff/vectors/read-contracts";

// Viewer of a takeoff job's vector reading (TI-662), in the takeoff review:
// the plan page rendered by pdfjs in the browser, the centrelines of its
// measured items drawn over it per network, a toggle per network (Alt-click
// isolates it), the room polygons (one « Surfaces » toggle), the detection
// badge and the page scale (« échelle non vérifiée » and its reason). Each
// network says how its class was read (« mots-clés », « légende », « libellés »,
// « Decisions 80 % » at the lowest confidence of its Decisions groups, or
// « ChatGPT local 90 % » for a local job's plan, TI-704 option B); the page
// says what the model did (Decisions' calls or the plan's requests, tokens, why
// it stopped) and how many of its groups stay « à revoir », as the worker
// counted them on the whole page (classify.ts groupsToReview: visible groups
// without class, or a model's proposal under its accepted confidence, neither
// classified nor measured). Data
// comes from GET /api/takeoff/jobs/{id}/
// vector-pages under the user's session; the PDF from the plan file's signed
// URL, or for a direct upload (no plan file) from the job's own, signed by that
// read. Without a source PDF, or when it cannot be drawn, the viewer says so
// and keeps the geometry. Geometry is in metres from the page's top-left corner at the page's
// scale. Ctrl/⌘ + wheel zooms (a plain wheel scrolls the review); the canvas
// is capped at MAX_CANVAS_PIXELS, drawn smaller and stretched beyond.

const MM_PER_POINT = 25.4 / 72;
/** Pixels of the rendered page at most (Safari refuses larger canvases; an A0 at zoom 8 would be hundreds of MB). */
const MAX_CANVAS_PIXELS = 16_777_216;
const PALETTE = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];
const SCALE_LABELS: Record<string, string> = { verified: "vérifiée par une cote", format: "format conforme", calibrated: "calibrée", unverified: "non vérifiée" };
const SURFACES = "Surfaces";
const SURFACE_COLOR = "var(--color-info)";

type VectorPage = TakeoffVectorReadingResponse["pages"][number];

const percent = (value: number) => `${Math.round(value * 100)} %`;
const plural = (count: number, word: string) => `${new Intl.NumberFormat("fr-FR").format(count)} ${word}${count > 1 ? "s" : ""}`;

/**
 * How each network's class was read, from the groups its items measure: sources in order, a model's (Decisions, the
 * local plan's) at its lowest confidence.
 */
function networkSources(page: VectorPage | null) {
  const groups = new Map((page?.reading.groups ?? []).map((group) => [group.id, group]));
  const found = new Map<string, { sources: Set<ClassSource>; lowest: Map<ClassSource, number> }>();
  for (const item of page?.items ?? []) {
    if (item.geometry.kind !== "network") continue;
    const entry = found.get(networkLabel(item)) ?? { sources: new Set<ClassSource>(), lowest: new Map<ClassSource, number>() };
    found.set(networkLabel(item), entry);
    for (const id of item.geometry.groups) {
      const group = groups.get(id);
      // A shared legend colour decided per run by the labels has no class of its own.
      const source = (group?.source ?? (group && group.candidates.length > 0 ? "label" : null)) as ClassSource | null;
      if (!source || !(source in CLASS_SOURCE_LABELS)) continue;
      entry.sources.add(source);
      if (isModelSource(source) && group?.confidence != null) entry.lowest.set(source, Math.min(entry.lowest.get(source) ?? 1, group.confidence));
    }
  }
  // In one order (keywords, legend, labels, document, user, Decisions, ChatGPT local), whatever the order of the item's groups.
  const order = Object.keys(CLASS_SOURCE_LABELS) as ClassSource[];
  return new Map([...found].map(([name, { sources, lowest }]) => [name, order.filter((source) => sources.has(source))
    .map((source) => (lowest.has(source) ? `${CLASS_SOURCE_LABELS[source]} ${percent(lowest.get(source) as number)}` : CLASS_SOURCE_LABELS[source]))
    .join(", ")]));
}

/** « 1/50 », a calibrated « 1/47.6 ». */
function formatDenominator(denominator: number) {
  return Number.isInteger(denominator) ? String(denominator) : denominator.toFixed(1);
}

function networkLabel(item: VectorPage["items"][number]) {
  return item.geometry.network ?? "à revoir";
}

/** The toggle an item follows: its network (an insulation with its pipe), « Surfaces » for a room polygon. */
function toggleOf(item: VectorPage["items"][number]) {
  return item.geometry.kind === "surface" ? SURFACES : networkLabel(item);
}

async function readJson(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<{ data?: unknown }>;
}

/**
 * TI-664 L5c, the targeted review's use (two optional props, nothing else changes): `focusItemIds` turns to the page
 * of the first of those lines and draws them over the others, dimmed; `fill` lets the viewer take the height of a
 * tool layout panel instead of its fixed frame.
 */
export function TakeoffVectorViewer({ jobId, planSetId, focusItemIds, fill = false }: {
  jobId: string; planSetId: string | null; focusItemIds?: readonly string[]; fill?: boolean;
}) {
  const [reading, setReading] = useState<TakeoffVectorReadingResponse | null>(null);
  const [error, setError] = useState("");
  /** Why the page's plan is not drawn under its geometry: no source PDF or a failed load (reset with the source), or a failed render (reset with each render). */
  const [planError, setPlanError] = useState("");
  const [renderError, setRenderError] = useState("");
  const [pageId, setPageId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  /** The loaded PDF and the source it was loaded for (its plan file, or the job's upload): a page draws only its own source. */
  const [pdf, setPdf] = useState<{ source: string; document: PDFDocumentProxy } | null>(null);
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

  // The page of the first focused line that has geometry, turned to when the reading or the focus changes; a line
  // without geometry leaves the page as it is. Settled while rendering, so the page list shows it: an effect ran after
  // the list was shown and replaced a page picked meanwhile (TI-719).
  const focusKey = (focusItemIds ?? []).join(",");
  const [turnedFor, setTurnedFor] = useState<{ reading: TakeoffVectorReadingResponse | null; focusKey: string }>({ reading: null, focusKey: "" });
  if (reading && (turnedFor.reading !== reading || turnedFor.focusKey !== focusKey)) {
    setTurnedFor({ reading, focusKey });
    const target = focusKey.split(",").filter(Boolean)
      .map((id) => reading.pages.find((entry) => entry.items.some((item) => item.takeoff_item_id === id))).find(Boolean);
    if (target && target.id !== pageId) setPageId(target.id);
  }
  const focus = useMemo(() => new Set(focusKey === "" ? [] : focusKey.split(",")), [focusKey]);

  const page = reading?.pages.find((entry) => entry.id === pageId) ?? null;
  const networks = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of page?.items ?? []) {
      if (item.geometry.kind !== "network") continue;
      totals.set(networkLabel(item), (totals.get(networkLabel(item)) ?? 0) + (item.geometry.length_m ?? 0));
    }
    return [...totals.entries()].sort(([left], [right]) => (left < right ? -1 : 1)).map(([name, length], index) => ({
      name, length, color: PALETTE[index % PALETTE.length],
    }));
  }, [page]);
  const surfaces = useMemo(() => (page?.items ?? []).filter((item) => item.geometry.kind === "surface"), [page]);
  const sources = useMemo(() => networkSources(page), [page]);

  // The page's PDF: its plan file's signed URL (plan set), else the job's own upload, signed with the reading.
  const hasPage = page !== null;
  const planFileId = page?.plan_file_id ?? null;
  const uploadUrl = page && !planFileId ? reading?.source_download_url ?? null : null;
  const sourceKey = planFileId ?? uploadUrl;
  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    setPdf(null);
    setPlanError("");
    setRendering(false);
    // The previous source's plan never stays painted under this page's geometry.
    if (canvas.current) {
      canvas.current.width = 0;
      canvas.current.height = 0;
    }
    if (!hasPage) return;
    const source = planFileId && planSetId
      ? readJson(`/api/takeoff/plan-sets/${encodeURIComponent(planSetId)}/files/${encodeURIComponent(planFileId)}?include_download_url=true`)
        .then((body) => (body.data as { plan_file?: { download_url?: string | null } } | undefined)?.plan_file?.download_url ?? null)
      : Promise.resolve(uploadUrl);
    void source
      .then(async (url) => {
        if (!active) return;
        if (!url) {
          setPlanError("Le plan source de cette page n’est pas disponible ; la géométrie reste visible.");
          return;
        }
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const assetRoot = new URL("/assets/pdfjs/", window.location.origin).href;
        task = pdfjs.getDocument({ url, useSystemFonts: true, cMapUrl: `${assetRoot}cmaps/`, cMapPacked: true,
          standardFontDataUrl: `${assetRoot}standard_fonts/`, wasmUrl: `${assetRoot}wasm/`, iccUrl: `${assetRoot}iccs/` });
        const document = await task.promise;
        if (active) setPdf({ source: planFileId ?? url, document });
      })
      .catch(() => active && setPlanError("Le plan de cette page n’a pas pu être affiché ; la géométrie reste visible."));
    return () => {
      active = false;
      void task?.destroy().catch(() => undefined);
    };
  }, [hasPage, planFileId, planSetId, uploadUrl]);

  useEffect(() => {
    if (!page) return;
    setBase({ width: page.reading.size_pt[0], height: page.reading.size_pt[1] });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [page]);

  // `fill`: the frame follows its panel, and the page fits it again when the panel or the window changes width.
  const [frameWidth, setFrameWidth] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (!fill || !element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setFrameWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [fill, reading]);
  const fit = useMemo(() => {
    const width = (fill ? frameWidth : 0) || (frame.current?.clientWidth ?? 0);
    return base && width > 0 ? width / base.width : 0.25;
  }, [base, fill, frameWidth]);
  const scale = fit * zoom;

  useEffect(() => {
    setRenderError("");
    // A document loaded for another source (the previous page's plan file) is never drawn under this page.
    if (!pdf || pdf.source !== sourceKey || !page || !canvas.current) return;
    let active = true;
    let render: RenderTask | undefined;
    const element = canvas.current;
    setRendering(true);
    void pdf.document.getPage(page.source_page).then(async (source) => {
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
    }).catch(() => {
      // A cancelled render (zoom, page change) is not a failure: its effect is no longer active.
      if (!active) return;
      setRendering(false);
      setRenderError("Le plan de cette page n’a pas pu être affiché ; la géométrie reste visible.");
    });
    return () => {
      active = false;
      render?.cancel();
    };
  }, [pdf, page, scale, sourceKey]);

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
    if (isolate) return new Set([...networks.map((entry) => entry.name), ...(surfaces.length > 0 ? [SURFACES] : [])].filter((entry) => entry !== name));
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
  const decisions = page?.reading.decisions ?? null;
  const decisionCalls = decisions ? decisions.calls.batch + decisions.calls.dedicated : 0;
  const reviewCount = page?.reading.to_review ?? 0;

  return (
    <section aria-label="Lecture vectorielle du plan" className={fill
      ? "grid h-full min-h-0 grid-cols-[16rem_1fr] gap-3 bg-surface p-3"
      : "grid gap-3 rounded-lg border border-border bg-surface p-3 lg:grid-cols-[18rem_1fr]"}>
      <div className={fill ? "flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto" : "flex min-w-0 flex-col gap-3"}>
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
        {decisions ? (
          <p className="text-xs text-muted-foreground">
            {isLocalModelPromptVersion(decisions.prompt_version)
              ? <>ChatGPT local : {plural(decisionCalls, "demande")}</>
              : <>Decisions : {plural(decisionCalls, "appel")}</>}, {plural(decisions.total_tokens, "jeton")}, {plural(decisions.answered, "réponse")}
          </p>
        ) : null}
        {decisions?.stop ? <p role="status" className="text-xs text-warning">{decisions.stop.message}</p> : null}
        {reviewCount > 0 ? <p className="text-xs text-muted-foreground">{plural(reviewCount, "groupe")} de tracés à revoir</p> : null}
        <div role="group" aria-label="Réseaux" className="flex flex-col gap-1">
          {networks.length === 0 ? <p className="text-xs text-muted-foreground">Aucun réseau mesuré sur cette page.</p> : null}
          {networks.map((entry) => (
            <label key={entry.name} className="flex flex-wrap items-center gap-x-2 text-sm" title="Alt-clic : n’afficher que ce réseau">
              {/* One handler: React fires onClick and onChange for the same click, so Alt is read from the change's click. */}
              <input type="checkbox" checked={!hidden.has(entry.name)} aria-label={`Afficher ${entry.name}`}
                onChange={(event) => toggle(entry.name, (event.nativeEvent as MouseEvent).altKey === true)} />
              <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: entry.color }} />
              <span className="font-medium">{entry.name}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{entry.length.toFixed(2)} m</span>
              {sources.get(entry.name) ? <span className="basis-full pl-5 text-xs text-muted-foreground">{sources.get(entry.name)}</span> : null}
            </label>
          ))}
        </div>
        {surfaces.length > 0 ? (
          <div role="group" aria-label="Surfaces" className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm" title="Alt-clic : n’afficher que les surfaces">
              <input type="checkbox" checked={!hidden.has(SURFACES)} aria-label="Afficher les surfaces"
                onChange={(event) => toggle(SURFACES, (event.nativeEvent as MouseEvent).altKey === true)} />
              <span aria-hidden className="inline-block size-3 rounded-sm border-2" style={{ borderColor: SURFACE_COLOR }} />
              <span className="font-medium">{SURFACES} ({surfaces.length})</span>
              <span className="ml-auto tabular-nums text-muted-foreground">
                {surfaces.reduce((total, item) => total + (item.geometry.area_m2 ?? 0), 0).toFixed(2)} m²
              </span>
            </label>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {(page?.items ?? []).filter((item) => !hidden.has(toggleOf(item))).length} / {page?.items.length ?? 0} éléments affichés
        </p>
      </div>
      <div className={fill ? "flex min-h-0 min-w-0 flex-col gap-2" : "flex min-w-0 flex-col gap-2"}>
        <div className="flex items-center gap-1" role="toolbar" aria-label="Zoom du plan">
          <Button size="icon-sm" variant="outline" aria-label="Zoom arrière" onClick={() => setZoom((value) => Math.max(0.25, value / 1.25))}><Minus className="size-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => setZoom(1)}>100 %</Button>
          <Button size="icon-sm" variant="outline" aria-label="Zoom avant" onClick={() => setZoom((value) => Math.min(8, value * 1.25))}><Plus className="size-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}><Maximize2 className="mr-1 size-4" />Ajuster</Button>
          {rendering ? <LoaderCircle aria-label="Rendu du plan" className="ml-2 size-4 animate-spin text-muted-foreground" /> : null}
        </div>
        <div ref={frame} className={`relative ${fill ? "min-h-0 flex-1" : "h-[32rem]"} cursor-grab overflow-hidden rounded-md border border-border-subtle bg-surface-subtle`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }}
          onPointerLeave={() => { drag.current = null; }}>
          <div className="absolute left-0 top-0" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
            <canvas ref={canvas} aria-hidden className="block" />
            {base ? (
              <svg aria-label="Géométrie mesurée" role="img" className="absolute left-0 top-0" width={base.width * scale} height={base.height * scale}>
                {hidden.has(SURFACES) ? null : surfaces.map((item) => item.geometry.polygon_m === null ? null : (
                  <polygon key={item.takeoff_item_id} data-kind="surface" data-focus={focus.has(item.takeoff_item_id) || undefined}
                    fill={focus.has(item.takeoff_item_id) ? SURFACE_COLOR : "none"} fillOpacity={0.15} stroke={SURFACE_COLOR}
                    strokeWidth={focus.has(item.takeoff_item_id) ? 4 : 2} strokeDasharray="6 3"
                    strokeOpacity={focus.size > 0 && !focus.has(item.takeoff_item_id) ? 0.35 : 1}
                    points={item.geometry.polygon_m.map(toScreen).join(" ")} />
                ))}
                {(page?.items ?? []).filter((item) => item.geometry.kind === "network" && !hidden.has(networkLabel(item)))
                  // A focused line is drawn last, over the others.
                  .sort((left, right) => Number(focus.has(left.takeoff_item_id)) - Number(focus.has(right.takeoff_item_id))).map((item) => (
                  <g key={item.takeoff_item_id} data-network={networkLabel(item)} data-focus={focus.has(item.takeoff_item_id) || undefined}
                    stroke={colorOf.get(networkLabel(item)) ?? PALETTE[0]} strokeWidth={focus.has(item.takeoff_item_id) ? 7 : 3} strokeLinecap="round"
                    strokeOpacity={focus.size > 0 && !focus.has(item.takeoff_item_id) ? 0.35 : 1}>
                    {item.geometry.segments_m.map(([x0, y0, x1, y1], index) => (
                      <line key={index} x1={toScreen(x0)} y1={toScreen(y0)} x2={toScreen(x1)} y2={toScreen(y1)} />
                    ))}
                  </g>
                ))}
              </svg>
            ) : null}
          </div>
        </div>
        {planError || renderError || error ? <p className="text-xs text-warning">{planError || renderError || error}</p> : null}
      </div>
    </section>
  );
}
