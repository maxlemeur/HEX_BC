import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Ways the review viewer of a vector reading (TI-662, review of PR #147) could
// show the wrong plan or a wrong message when its page changes, written before
// the fix. The army journeys (TKW08, TKW09) cover one page with its plan drawn
// and a missing upload; the transitions between pages are only reachable here:
// - one page whose render fails keeps that warning on every other page of the
//   same upload, which renders fine;
// - a page without source PDF keeps the previous plan painted under its
//   geometry beside « n’est pas disponible ».
// pdfjs is replaced by a document whose getPage rejects a page beyond its count
// (« Invalid page request », as pdfjs 6.4 does) and whose render may fail.

const { getDocument, documents } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  documents: new Map<string, { pages: number; failing: Set<number> }>(),
}));
vi.mock("pdfjs-dist", () => ({ getDocument, GlobalWorkerOptions: {} }));

import { TakeoffVectorViewer } from "@/components/takeoff/review/TakeoffVectorViewer";

const JOB = "11111111-1111-4111-8111-111111111111";
const PLAN_SET = "44444444-4444-4444-8444-444444444444";
const FILE_A = "55555555-5555-4555-8555-555555555555";
const FILE_B = "66666666-6666-4666-8666-666666666666";
const UPLOAD = "http://127.0.0.1:54321/storage/v1/object/sign/takeoff-files/t/j/plan.pdf?token=fictional";

const reading = {
  schema_version: 1, reading_version: 4, mode: "layers", size_pt: [1190.55, 841.89], rotate: 0,
  location: { zone: null, level: null, source: null },
  scale: { status: "format", reason: null, denominator: 50, cartouche: null,
    format: { cartouche: "Format A3", page_mm: [420, 297], matches: true }, cotes: [], calibration: null },
  legend: [], detection: 1, groups: [], groups_total: 0, labels: null, surfaces: [],
};
const geometry = { schema_version: 1, kind: "network", network: "EF", material: "per", dn: 16, zone: null, level: null, groups: [],
  segments_m: [[1.25, 6.03, 6.25, 6.03]], polygon_m: null, length_m: 5, area_m2: null, transform: null };

function page(index: number, planFileId: string | null, sourcePage: number, fileName: string) {
  const id = `7777777${index}-7777-4777-8777-777777777777`;
  return { id, plan_file_id: planFileId, source_file_name: fileName, source_page: sourcePage, reading,
    items: [{ takeoff_item_id: `8888888${index}-8888-4888-8888-888888888888`, geometry }] };
}

/** The urls each getDocument was given and the (document, page) each render drew. */
const rendered: Array<{ url: string; page: number }> = [];

function stubPdfjs() {
  getDocument.mockImplementation(({ url }: { url: string }) => {
    const document = documents.get(url)!;
    return {
      promise: Promise.resolve({
        getPage: (number: number) => (number > document.pages ? Promise.reject(new Error("Invalid page request."))
          : Promise.resolve({
            getViewport: ({ scale }: { scale: number }) => ({ width: 1190.55 * scale, height: 841.89 * scale }),
            render: () => {
              rendered.push({ url, page: number });
              return { promise: document.failing.has(number) ? Promise.reject(new Error("render failed")) : Promise.resolve(), cancel: () => undefined };
            },
          })),
      }),
      destroy: () => Promise.resolve(),
    };
  });
}

function stubFetch(data: { pages: unknown[]; source_download_url: string | null }, fileUrls: Record<string, string | null>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const file = Object.keys(fileUrls).find((id) => url.includes(`/files/${id}`));
    const body = url.includes("/vector-pages") ? { job_id: JOB, ...data } : { plan_file: { id: file, download_url: file ? fileUrls[file] : null } };
    return { ok: true, status: 200, json: async () => ({ ok: true, data: body }) };
  }));
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

const warning = () => screen.queryByText(/n’a pas pu être affiché|n’est pas disponible/)?.textContent ?? null;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  getDocument.mockReset();
  documents.clear();
  rendered.length = 0;
});

describe("TakeoffVectorViewer, page changes (review of PR #147)", () => {
  it("clears a render failure when another page of the same upload is drawn", async () => {
    documents.set(UPLOAD, { pages: 2, failing: new Set([1]) });
    stubPdfjs();
    const pages = [page(1, null, 1, "plan.pdf"), page(2, null, 2, "plan.pdf")];
    stubFetch({ pages, source_download_url: UPLOAD }, {});
    render(<TakeoffVectorViewer jobId={JOB} planSetId={null} />);
    await settle();
    expect(warning()).toBe("Le plan de cette page n’a pas pu être affiché ; la géométrie reste visible.");
    fireEvent.change(screen.getByLabelText("Page lue"), { target: { value: pages[1].id } });
    await settle();
    expect(rendered.at(-1)).toEqual({ url: UPLOAD, page: 2 });
    expect(warning()).toBeNull();
  });

  it("clears the previous plan from the canvas when the next page has no source PDF", async () => {
    documents.set("https://files.test/a.pdf", { pages: 1, failing: new Set() });
    stubPdfjs();
    const pages = [page(1, FILE_A, 1, "a.pdf"), page(2, FILE_B, 1, "b.pdf")];
    stubFetch({ pages, source_download_url: null }, { [FILE_A]: "https://files.test/a.pdf", [FILE_B]: null });
    const { container } = render(<TakeoffVectorViewer jobId={JOB} planSetId={PLAN_SET} />);
    await settle();
    const canvas = container.querySelector("canvas")!;
    expect(canvas.width).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Page lue"), { target: { value: pages[1].id } });
    await settle();
    expect(warning()).toBe("Le plan source de cette page n’est pas disponible ; la géométrie reste visible.");
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(screen.queryByLabelText("Rendu du plan")).toBeNull();
  });
});
