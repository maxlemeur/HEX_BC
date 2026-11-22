import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The page reader extracted from the vector viewer (lot 5): it shows a plan's page whether or not an analysis read
// vectors on it. Ways it could show the wrong bytes or nothing, written with the extraction:
// - a scanned plan (a page with no vector reading at all) is not drawn, because only the vector viewer drew pages;
// - a page turned by its /Rotate is drawn at the unturned size, so what is drawn over it lands beside its object;
// - a source changed while its first page is still rendering lets the old render finish on the canvas, or the old
//   document stay loaded, or flags the cancelled render as a failure;
// - a page beyond the document, or bytes without an address, shows the previous plan instead of saying so.
// pdfjs is replaced by documents whose pages have a size, an optional quarter turn and a render that can be held.

const { getDocument, documents } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  documents: new Map<string, { pages: number; rotated?: Set<number>; held?: boolean; size?: { width: number; height: number } }>(),
}));
vi.mock("pdfjs-dist", () => ({ getDocument, GlobalWorkerOptions: {} }));

import { usePdfPage, type PdfPageSource, type PdfPageState } from "@/components/takeoff/review/usePdfPage";
import { PDF_MAX_CANVAS_PIXELS } from "@/lib/takeoff/pdf-page-geometry";

const A3 = { width: 1190.55, height: 841.89 };
const renders: Array<{ url: string; page: number; cancelled: boolean; settled: boolean; release: () => void }> = [];
const destroyed: string[] = [];

function stubPdfjs() {
  getDocument.mockImplementation(({ url }: { url: string }) => {
    const document = documents.get(url)!;
    return {
      promise: Promise.resolve({
        numPages: document.pages,
        getPage: (number: number) => (number > document.pages ? Promise.reject(new Error("Invalid page request."))
          : Promise.resolve({
            getViewport: ({ scale }: { scale: number }) => (document.size
              ? { width: document.size.width * scale, height: document.size.height * scale }
              : document.rotated?.has(number)
                ? { width: A3.height * scale, height: A3.width * scale } : { width: A3.width * scale, height: A3.height * scale }),
            render: () => {
              let release: () => void = () => undefined;
              let reject: (error: Error) => void = () => undefined;
              const entry = { url, page: number, cancelled: false, settled: false, release: () => release() };
              renders.push(entry);
              const promise = new Promise<void>((resolve, fail) => {
                release = () => {
                  entry.settled = true;
                  resolve();
                };
                reject = fail;
              });
              if (!document.held) entry.release();
              return { promise, cancel: () => {
                entry.cancelled = true;
                reject(new Error("Rendering cancelled"));
              } };
            },
          })),
      }),
      destroy: () => {
        destroyed.push(url);
        return Promise.resolve();
      },
    };
  });
}

const sourceOf = (url: string | null, key = url ?? "none"): PdfPageSource => ({ key, url: async () => url });

let state: PdfPageState | null = null;
const record = (value: PdfPageState) => {
  state = value;
};
function Reader({ source, page, scale }: { source: PdfPageSource | null; page: number | null; scale: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const value = usePdfPage({ source, page, scale, canvas });
  useEffect(() => record(value));
  return <canvas ref={canvas} data-testid="page" />;
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

const canvas = () => screen.getByTestId("page") as HTMLCanvasElement;

afterEach(() => {
  cleanup();
  getDocument.mockReset();
  documents.clear();
  renders.length = 0;
  destroyed.length = 0;
  state = null;
});

describe("usePdfPage", () => {
  it("draws the asked page of a scanned plan, with no vector reading, at the screen's scale", async () => {
    documents.set("https://files.test/scan.pdf", { pages: 3 });
    stubPdfjs();
    render(<Reader source={sourceOf("https://files.test/scan.pdf")} page={2} scale={0.5} />);
    await settle();
    expect(renders.map(({ page }) => page)).toEqual([2]);
    expect(state).toMatchObject({ size: A3, pageCount: 3, loading: false, rendering: false, failure: null });
    expect(parseFloat(canvas().style.width)).toBeCloseTo(A3.width * 0.5, 6);
    expect(canvas().width).toBeGreaterThan(0);
  });

  it("gives a page turned by its /Rotate its turned size, and draws the canvas at it", async () => {
    documents.set("https://files.test/turned.pdf", { pages: 2, rotated: new Set([2]) });
    stubPdfjs();
    const { rerender } = render(<Reader source={sourceOf("https://files.test/turned.pdf")} page={1} scale={1} />);
    await settle();
    expect(state?.size).toEqual(A3);
    rerender(<Reader source={sourceOf("https://files.test/turned.pdf")} page={2} scale={1} />);
    await settle();
    expect(state?.size).toEqual({ width: A3.height, height: A3.width });
    expect([parseFloat(canvas().style.width), parseFloat(canvas().style.height)]).toEqual([A3.height, A3.width]);
    expect(canvas().width).toBeLessThan(canvas().height);
  });

  it("stays under the pixel ceiling at a deep zoom", async () => {
    documents.set("https://files.test/a0.pdf", { pages: 1 });
    stubPdfjs();
    render(<Reader source={sourceOf("https://files.test/a0.pdf")} page={1} scale={8} />);
    await settle();
    // Review of PR 2 (written before the fix): both dimensions rounded up made 4,871 × 3,445 = 16,780,595 pixels.
    expect(canvas().width * canvas().height).toBeLessThanOrEqual(PDF_MAX_CANVAS_PIXELS);
    expect(canvas().width).toBeGreaterThan(4_800);
    expect(parseFloat(canvas().style.width)).toBeCloseTo(A3.width * 8, 6);
  });

  it("stops the render and the document of a source changed mid-render, and never paints the old one", async () => {
    documents.set("https://files.test/a.pdf", { pages: 1, held: true });
    documents.set("https://files.test/b.pdf", { pages: 1 });
    stubPdfjs();
    const { rerender } = render(<Reader source={sourceOf("https://files.test/a.pdf")} page={1} scale={1} />);
    await settle();
    expect(renders).toHaveLength(1);
    expect(state?.rendering).toBe(true);
    const first = renders[0]!;

    rerender(<Reader source={sourceOf("https://files.test/b.pdf")} page={1} scale={1} />);
    await settle();
    expect(first.cancelled).toBe(true);
    expect(destroyed).toEqual(["https://files.test/a.pdf"]);
    expect(renders.at(-1)).toMatchObject({ url: "https://files.test/b.pdf", page: 1, settled: true });
    expect(state).toMatchObject({ failure: null, rendering: false });

    // The old render answering late changes nothing.
    first.release();
    await settle();
    expect(state).toMatchObject({ failure: null, rendering: false });
    expect(renders.filter(({ url }) => url === "https://files.test/a.pdf")).toHaveLength(1);
  });

  // Review of PR 2 (written before the fix): from page 1 of A to page 1 of B at another scale, B without an address,
  // the hook rendered A again at the new scale, left its canvas painted and reported « rendering » with the failure.
  it("never draws, keeps or reports the previous plan once another source is requested", async () => {
    documents.set("https://files.test/a.pdf", { pages: 1 });
    stubPdfjs();
    const { rerender } = render(<Reader source={sourceOf("https://files.test/a.pdf")} page={1} scale={1} />);
    await settle();
    expect(renders).toHaveLength(1);

    rerender(<Reader source={sourceOf(null, "piece-b")} page={1} scale={2} />);
    await settle();
    expect(renders).toHaveLength(1);
    expect([canvas().width, canvas().height]).toEqual([0, 0]);
    expect(state).toMatchObject({ failure: "unavailable", rendering: false, size: null, pageCount: null, loading: false });
  });

  // Review of PR 2 (written before the fix): a crop of 0.0005 × 10,000 points gave a 1 × 18,317,868 canvas (the short side
  // floored to zero, then raised to one).
  it("stays under the pixel ceiling for a page cropped to a sliver", async () => {
    documents.set("https://files.test/sliver.pdf", { pages: 1, size: { width: 0.0005, height: 10_000 } });
    stubPdfjs();
    render(<Reader source={sourceOf("https://files.test/sliver.pdf")} page={1} scale={2_000} />);
    await settle();
    expect(canvas().width * canvas().height).toBeLessThanOrEqual(PDF_MAX_CANVAS_PIXELS);
    expect(canvas().width * canvas().height).toBeGreaterThan(0);
  });

  // Review of PR 2 (written before the fix): a page change that cancelled a pending render, to a page the plan does not
  // have, reported « page_missing » with « rendering » still true.
  it("never reports a failure with a render in progress", async () => {
    documents.set("https://files.test/a.pdf", { pages: 2, held: true });
    stubPdfjs();
    const { rerender } = render(<Reader source={sourceOf("https://files.test/a.pdf")} page={1} scale={1} />);
    await settle();
    expect(state?.rendering).toBe(true);
    rerender(<Reader source={sourceOf("https://files.test/a.pdf")} page={5} scale={1} />);
    await settle();
    expect(renders[0]!.cancelled).toBe(true);
    expect(state).toMatchObject({ failure: "page_missing", rendering: false });
  });

  it("clears the canvas and says so for bytes without an address, then for a page the plan does not have", async () => {
    documents.set("https://files.test/a.pdf", { pages: 2 });
    stubPdfjs();
    const { rerender } = render(<Reader source={sourceOf("https://files.test/a.pdf")} page={1} scale={1} />);
    await settle();
    expect(canvas().width).toBeGreaterThan(0);

    rerender(<Reader source={sourceOf(null, "piece-without-copy")} page={1} scale={1} />);
    await settle();
    expect(state?.failure).toBe("unavailable");
    expect([canvas().width, canvas().height]).toEqual([0, 0]);

    rerender(<Reader source={sourceOf("https://files.test/a.pdf")} page={5} scale={1} />);
    await settle();
    expect(state).toMatchObject({ failure: "page_missing", size: null, loading: false });
    expect([canvas().width, canvas().height]).toEqual([0, 0]);
  });

  it("asks for nothing while no source is given", async () => {
    stubPdfjs();
    render(<Reader source={null} page={1} scale={1} />);
    await settle();
    expect(getDocument).not.toHaveBeenCalled();
    expect(state).toMatchObject({ size: null, pageCount: null, loading: false, failure: null });
  });
});
