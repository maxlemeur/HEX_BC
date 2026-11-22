"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";

import { pdfCanvasScale, type PdfPageFailure, type PdfPageSize } from "@/lib/takeoff/pdf-page-geometry";

export type { PdfPageFailure } from "@/lib/takeoff/pdf-page-geometry";

/**
 * The page reader of the review (lot 5, extracted from the vector viewer): one PDF loaded at a time, one page of it
 * drawn on a canvas at the screen's scale, whether or not an analysis read vectors on it (a scanned plan, a reading with
 * no vector page). The caller says which bytes to show (`source`), which original page (1-based) and at which scale; it
 * draws its own marks over the canvas from the page's size at scale 1 (the visible page, rotation applied).
 *
 * - A new source clears the canvas at once, stops the previous load and the render in progress, and is never drawn under
 *   another source's page: a document answers only for the key it was loaded for.
 * - The canvas is drawn under the pixel ceiling (pdf-page-geometry.ts) and stretched beyond.
 * - The URL is asked once per source, when its document is loaded (a private URL with a short life, validated by the
 *   server at that request); nothing is fetched while no source is given.
 */

export type PdfPageSource = {
  /** The identity of the bytes: two sources with one key are the same document. */
  key: string;
  /** The address of the bytes, asked when the document is loaded; null when there is none to show. */
  url: () => Promise<string | null>;
};

export type PdfPageState = {
  /** The page shown, at scale 1, once read from the document loaded for the current source. */
  size: PdfPageSize | null;
  pageCount: number | null;
  /** The document or the page is being read. */
  loading: boolean;
  rendering: boolean;
  failure: PdfPageFailure | null;
};

type LoadedDocument = { key: string; document: PDFDocumentProxy };
type LoadedPage = { key: string; number: number; page: PDFPageProxy; size: PdfPageSize };

async function openPdf(url: string): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const assetRoot = new URL("/assets/pdfjs/", window.location.origin).href;
  return pdfjs.getDocument({ url, useSystemFonts: true, cMapUrl: `${assetRoot}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assetRoot}standard_fonts/`, wasmUrl: `${assetRoot}wasm/`, iccUrl: `${assetRoot}iccs/` });
}

function clear(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

export function usePdfPage({ source, page, scale, canvas }: {
  source: PdfPageSource | null;
  /** The original page, 1-based; null shows nothing. */
  page: number | null;
  /** Screen pixels per point of the page at scale 1. */
  scale: number;
  canvas: RefObject<HTMLCanvasElement | null>;
}): PdfPageState {
  const key = source?.key ?? null;
  // The latest way to the bytes of this key: read when its document is loaded, never a reason to load again.
  const resolver = useRef(source?.url);
  resolver.current = source?.url;

  const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
  const [shown, setShown] = useState<LoadedPage | null>(null);
  const [sourceFailure, setSourceFailure] = useState<PdfPageFailure | null>(null);
  const [pageFailure, setPageFailure] = useState<PdfPageFailure | null>(null);
  const [opening, setOpening] = useState(false);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    setLoaded(null);
    setShown(null);
    setSourceFailure(null);
    setPageFailure(null);
    setRendering(false);
    // The previous source's page never stays painted under this one.
    clear(canvas.current);
    if (key === null) {
      setOpening(false);
      return;
    }
    setOpening(true);
    void (resolver.current?.() ?? Promise.resolve(null))
      .then(async (url) => {
        if (!active) return;
        if (!url) {
          setSourceFailure("unavailable");
          setOpening(false);
          return;
        }
        task = await openPdf(url);
        if (!active) {
          void task.destroy().catch(() => undefined);
          return;
        }
        const document = await task.promise;
        if (!active) return;
        setLoaded({ key, document });
        setOpening(false);
      })
      .catch(() => {
        if (!active) return;
        setSourceFailure("load_failed");
        setOpening(false);
      });
    return () => {
      active = false;
      void task?.destroy().catch(() => undefined);
    };
  }, [key, canvas]);

  useEffect(() => {
    setShown(null);
    setPageFailure(null);
    if (!loaded || page === null) return;
    let active = true;
    loaded.document.getPage(page).then((proxy) => {
      if (!active) return;
      const unit = proxy.getViewport({ scale: 1 });
      setShown({ key: loaded.key, number: page, page: proxy, size: { width: unit.width, height: unit.height } });
    }).catch(() => {
      if (!active) return;
      clear(canvas.current);
      setPageFailure("page_missing");
    });
    return () => {
      active = false;
    };
  }, [loaded, page, canvas]);

  useEffect(() => {
    const element = canvas.current;
    // A page read for another source (the previous plan) is never drawn under this one.
    if (!shown || !loaded || shown.key !== loaded.key || shown.number !== page || !element) return;
    const backing = pdfCanvasScale(shown.size, scale, window.devicePixelRatio);
    if (!(backing > 0)) return;
    let active = true;
    let task: RenderTask | undefined;
    setPageFailure(null);
    setRendering(true);
    try {
      const viewport = shown.page.getViewport({ scale: backing });
      element.width = Math.ceil(viewport.width);
      element.height = Math.ceil(viewport.height);
      element.style.width = `${shown.size.width * scale}px`;
      element.style.height = `${shown.size.height * scale}px`;
      task = shown.page.render({ canvas: element, viewport });
      task.promise.then(() => {
        if (active) setRendering(false);
      }).catch(() => {
        // A cancelled render (zoom, page or source change) is not a failure: its effect is no longer active.
        if (!active) return;
        setRendering(false);
        setPageFailure("render_failed");
      });
    } catch {
      setRendering(false);
      setPageFailure("render_failed");
    }
    return () => {
      active = false;
      task?.cancel();
    };
  }, [shown, loaded, page, scale, canvas]);

  const current = shown && loaded && shown.key === loaded.key && shown.number === page ? shown : null;
  return {
    size: current?.size ?? null,
    pageCount: loaded?.document.numPages ?? null,
    loading: opening || (loaded !== null && page !== null && current === null && pageFailure === null),
    rendering,
    failure: sourceFailure ?? pageFailure,
  };
}
