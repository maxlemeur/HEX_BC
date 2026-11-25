"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, LoaderCircle, Minus, Plus } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import { Button } from "@/components/ui/button";

/**
 * Renders an untrusted PDF original onto a canvas via pdfjs-dist so that the PDF never runs inside the
 * application's origin (the download route keeps `Content-Disposition: attachment`).
 */
export function MaterialRequestPdfViewer({
  url,
  name,
  downloadUrl,
  className,
}: Readonly<{
  url: string;
  name: string;
  downloadUrl: string;
  className?: string;
}>) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth || 320);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    setPdf(null);
    setPage(1);
    setZoom(1);
    setLoading(true);
    setError(null);
    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const assetRoot = new URL("/assets/pdfjs/", window.location.origin).href;
        task = pdfjs.getDocument({
          url,
          useSystemFonts: true,
          cMapUrl: `${assetRoot}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assetRoot}standard_fonts/`,
          wasmUrl: `${assetRoot}wasm/`,
          iccUrl: `${assetRoot}iccs/`,
        });
        const document = await task.promise;
        if (active) setPdf(document);
      })
      .catch(() => {
        if (active) {
          setError("Impossible d’afficher ce PDF ici. Vous pouvez le télécharger pour le consulter.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
      void task?.destroy().catch(() => undefined);
    };
  }, [url]);

  useEffect(() => {
    if (!pdf || !width || !canvas.current) return;
    const element = canvas.current;
    let active = true;
    let render: RenderTask | undefined;
    setLoading(true);
    setError(null);
    void pdf
      .getPage(page)
      .then(async (source) => {
        if (!active) return;
        const base = source.getViewport({ scale: 1 });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const scale = Math.max(0.05, (width - 24) / base.width) * zoom;
        const viewport = source.getViewport({ scale: scale * ratio });
        element.width = Math.ceil(viewport.width);
        element.height = Math.ceil(viewport.height);
        element.style.width = `${viewport.width / ratio}px`;
        element.style.height = `${viewport.height / ratio}px`;
        render = source.render({ canvas: element, viewport });
        await render.promise;
        if (active) setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError("Cette page du PDF n’a pas pu être affichée.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
      render?.cancel();
    };
  }, [pdf, page, zoom, width]);

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-border bg-surface-subtle ${className ?? "aspect-square w-full"}`}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!pdf || page <= 1}
            aria-label="Page PDF précédente"
            onClick={() => setPage((prior) => prior - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {page} / {pdf?.numPages ?? "…"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!pdf || page >= pdf.numPages}
            aria-label="Page PDF suivante"
            onClick={() => setPage((prior) => prior + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!pdf || zoom <= 0.5}
            aria-label="Réduire le PDF"
            onClick={() => setZoom((prior) => Math.max(0.5, prior - 0.25))}
          >
            <Minus aria-hidden="true" />
          </Button>
          <button
            type="button"
            className="rounded px-1 text-xs tabular-nums text-muted-foreground hover:text-foreground"
            onClick={() => setZoom(1)}
            title="Ajuster à la largeur"
          >
            {Math.round(zoom * 100)} %
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!pdf || zoom >= 3}
            aria-label="Agrandir le PDF"
            onClick={() => setZoom((prior) => Math.min(3, prior + 0.25))}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div ref={container} className="relative min-h-0 flex-1 overflow-auto p-3">
        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            <span>Affichage du PDF…</span>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="space-y-2 py-4 text-center text-xs text-danger">
            <p>{error}</p>
            <a
              href={downloadUrl}
              download={name}
              className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
            >
              <Download aria-hidden="true" className="size-3.5" />
              Télécharger le PDF
            </a>
          </div>
        ) : null}
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${name} — page ${page}`}
          className="mx-auto block bg-white shadow-xs"
          style={{ visibility: loading || error ? "hidden" : "visible" }}
        />
      </div>
    </div>
  );
}
