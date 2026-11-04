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
// How a class was read (TI-662 L3d, the worker's Decisions), written before the
// code: the army journey TKW10 covers one Decisions network and one failed
// call; mixed sources and the « à revoir » count are only reachable here:
// - a network does not say its source, or shows a Decisions class at a higher
//   confidence than its least sure group, or its sources in the order of its
//   groups instead of one order;
// - the page does not show the count of groups « à revoir » the worker made on
//   the whole page (classify.ts groupsToReview), or shows one for a row of
//   before it;
// - the page does not say what Decisions did, or why it stopped.
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

describe("TakeoffVectorViewer, class sources and Decisions (TI-662 L3d)", () => {
  const group = (id: string, cls: string | null, source: string | null, confidence: number | null, extra: Record<string, unknown> = {}) => ({
    id, class: cls, source, confidence, candidates: [], length_pt: 100, near_white: false, colors: ["#ff00ff"], ...extra,
  });
  const decided = {
    ...reading,
    groups: [
      group("g-ef", "EF", "keyword", null), group("g-eu", "EU", "decisions", 0.85), group("g-eu2", "EU", "decisions", 0.8),
      group("g-eu-key", "EU", "keyword", null), group("g-proposal", "EU", "decisions", 0.6), group("g-none", null, null, null),
    ],
    groups_total: 6,
    // As the worker counts them on the whole page: the proposal and the group without class.
    to_review: 2,
    decisions: { prompt_version: "takeoff-vector-groups-v1", candidates: 3, eligible: 3, left_out: 0, dedicated_left_out: 0, calls: { batch: 1, dedicated: 0, failed: 1 },
      answered: 3, total_tokens: 1200, latency_ms: 900,
      stop: { reason: "call_failed", message: "Un appel Decisions a échoué, aucun autre n’a été envoyé : les groupes restants sont à revoir.", from_earlier_page: false } },
  };
  const items = [
    { takeoff_item_id: "88888881-8888-4888-8888-888888888888", geometry: { ...geometry, groups: ["g-ef"] } },
    { takeoff_item_id: "88888882-8888-4888-8888-888888888888", geometry: { ...geometry, network: "EU", groups: ["g-eu", "g-eu2", "g-eu-key"] } },
  ];

  it("names each network's source, Decisions at its lowest confidence, and counts the groups still à revoir", async () => {
    documents.set(UPLOAD, { pages: 1, failing: new Set() });
    stubPdfjs();
    stubFetch({ pages: [{ ...page(1, null, 1, "plan.pdf"), reading: decided, items }], source_download_url: UPLOAD }, {});
    render(<TakeoffVectorViewer jobId={JOB} planSetId={null} />);
    await settle();
    const networks = screen.getByRole("group", { name: "Réseaux" });
    const row = (name: string) => screen.getByLabelText(`Afficher ${name}`).closest("label")!.textContent;
    expect(row("EF")).toBe("EF5.00 mmots-clés");
    expect(row("EU")).toBe("EU5.00 mmots-clés, Decisions 80 %");
    expect(networks.textContent).not.toContain("à revoir");
    expect(screen.getByText(/de tracés à revoir$/).textContent).toBe("2 groupes de tracés à revoir");
    expect(screen.getByText(/^Decisions :/).textContent).toMatch(/^Decisions : 1 appel, 1\s200 jetons, 3 réponses$/);
    expect(screen.getByRole("status").textContent).toBe(decided.decisions.stop.message);
  });

  it("says nothing of Decisions nor of groups to review for a reading without them", async () => {
    documents.set(UPLOAD, { pages: 1, failing: new Set() });
    stubPdfjs();
    // A row of before the count (no `to_review`), and one with nothing left to review.
    stubFetch({ pages: [page(1, null, 1, "plan.pdf"), { ...page(2, null, 2, "plan.pdf"), reading: { ...reading, to_review: 0 } }], source_download_url: UPLOAD }, {});
    render(<TakeoffVectorViewer jobId={JOB} planSetId={null} />);
    await settle();
    expect(screen.getByLabelText("Afficher EF")).toBeTruthy();
    expect(screen.queryByText(/^Decisions :/)).toBeNull();
    expect(screen.queryByText(/à revoir/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Page lue"), { target: { value: "77777772-7777-4777-8777-777777777777" } });
    await settle();
    expect(screen.queryByText(/à revoir/)).toBeNull();
  });
});
