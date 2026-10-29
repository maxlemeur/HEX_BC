"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Minus,
  Plus,
} from "lucide-react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";

/** Canvas rendering also works in browsers that do not provide a native PDF plugin. */
export function IntakePdfPreview({ url, name }: { url: string; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
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
    setError("");
    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const assetRoot = new URL("/assets/pdfjs/", window.location.origin)
          .href;
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
          setError(
            "Impossible d’afficher ce PDF. Vous pouvez le télécharger ou l’ouvrir dans Drive.",
          );
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
    setError("");
    void pdf
      .getPage(page)
      .then(async (source) => {
        if (!active) return;
        const base = source.getViewport({ scale: 1 });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const scale = Math.max(0.05, (width - 32) / base.width) * zoom;
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
    <div className="document-pdf-viewer">
      <div className="document-pdf-toolbar">
        <div>
          <button
            className="document-desk-icon"
            disabled={!pdf || page <= 1}
            aria-label="Page PDF précédente"
            onClick={() => setPage((prior) => prior - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {page} / {pdf?.numPages ?? "…"}
          </span>
          <button
            className="document-desk-icon"
            disabled={!pdf || page >= pdf.numPages}
            aria-label="Page PDF suivante"
            onClick={() => setPage((prior) => prior + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div>
          <button
            className="document-desk-icon"
            disabled={!pdf || zoom <= 0.5}
            aria-label="Réduire le PDF"
            onClick={() => setZoom((prior) => Math.max(0.5, prior - 0.25))}
          >
            <Minus size={14} />
          </button>
          <button
            className="document-desk-text"
            onClick={() => setZoom(1)}
            title="Ajuster à la largeur"
          >
            {Math.round(zoom * 100)} %
          </button>
          <button
            className="document-desk-icon"
            disabled={!pdf || zoom >= 3}
            aria-label="Agrandir le PDF"
            onClick={() => setZoom((prior) => Math.min(3, prior + 0.25))}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="document-pdf-pages" ref={container}>
        {loading && (
          <div className="document-pdf-loading" role="status">
            <LoaderCircle size={22} className="animate-spin" />
            <span>Affichage du PDF…</span>
          </div>
        )}
        {error && (
          <p className="document-preview-empty" role="alert">
            {error}
          </p>
        )}
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${name} — page ${page}`}
          style={{ visibility: loading || error ? "hidden" : "visible" }}
        />
      </div>
    </div>
  );
}
