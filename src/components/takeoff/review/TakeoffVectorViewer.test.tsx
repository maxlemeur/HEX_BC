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
import { beforePassiveEffectsOf } from "@/test/before-passive-effects";

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

/** `held`: the reading answers once it resolves. */
function stubFetch(data: { pages: unknown[]; source_download_url: string | null }, fileUrls: Record<string, string | null>, held?: Promise<void>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (held && url.includes("/vector-pages")) await held;
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
      stop: { reason: "call_failed", message: "Un appel Decisions a échoué, aucun appel n’a été lancé ensuite : les groupes restants sont à revoir.", from_earlier_page: false } },
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

  it("names the local plan's requests and its probability for a local job (TI-704 option B), never Decisions", async () => {
    documents.set(UPLOAD, { pages: 1, failing: new Set() });
    stubPdfjs();
    const local = {
      ...decided,
      groups: [group("g-ef", "EF", "keyword", null), group("g-eu", "EU", "chatgpt", 0.95), group("g-eu2", "EU", "chatgpt", 0.85), group("g-none", null, null, null)],
      groups_total: 4, to_review: 1,
      decisions: { ...decided.decisions, prompt_version: "takeoff-vector-groups-v2-local", calls: { batch: 2, dedicated: 0, failed: 0 }, answered: 2,
        total_tokens: 100, stop: null },
    };
    const localItems = [items[0], { ...items[1], geometry: { ...geometry, network: "EU", groups: ["g-eu", "g-eu2"] } }];
    stubFetch({ pages: [{ ...page(1, null, 1, "plan.pdf"), reading: local, items: localItems }], source_download_url: UPLOAD }, {});
    render(<TakeoffVectorViewer jobId={JOB} planSetId={null} />);
    await settle();
    const row = (name: string) => screen.getByLabelText(`Afficher ${name}`).closest("label")!.textContent;
    expect(row("EU")).toBe("EU5.00 mChatGPT local 85 %");
    expect(screen.getByText(/^ChatGPT local :/).textContent).toBe("ChatGPT local : 2 demandes, 100 jetons, 2 réponses");
    expect(screen.queryByText(/^Decisions/)).toBeNull();
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

// TI-719, written before the fix: the page of the line in focus (the targeted review's focusItemIds) was chosen in an
// effect, which runs after the reading and its page list are shown. A page picked in between was replaced by that
// line's page. beforePassiveEffectsOf replays that ordering on every run.
describe("TakeoffVectorViewer, the page of the line in focus (TI-719)", () => {
  it("keeps a page picked as soon as the reading is shown instead of the focused line's page", async () => {
    documents.set(UPLOAD, { pages: 3, failing: new Set() });
    stubPdfjs();
    const pages = [page(1, null, 1, "plan.pdf"), page(2, null, 2, "plan.pdf"), page(3, null, 3, "plan.pdf")];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    stubFetch({ pages, source_download_url: UPLOAD }, {}, held);
    render(<TakeoffVectorViewer jobId={JOB} planSetId={null} focusItemIds={[pages[1].items[0].takeoff_item_id]} />);

    const picked = beforePassiveEffectsOf(() => screen.queryByLabelText("Page lue") !== null,
      () => fireEvent.change(screen.getByLabelText("Page lue"), { target: { value: pages[2].id } }));
    release();
    await picked.done();
    await settle();

    expect(screen.getByLabelText("Page lue")).toHaveValue(pages[2].id);
    expect(rendered.at(-1)).toEqual({ url: UPLOAD, page: 3 });
  });

  it("turns to the page of the line in focus, and to the next one's when the focus moves", async () => {
    documents.set(UPLOAD, { pages: 3, failing: new Set() });
    stubPdfjs();
    const pages = [page(1, null, 1, "plan.pdf"), page(2, null, 2, "plan.pdf"), page(3, null, 3, "plan.pdf")];
    stubFetch({ pages, source_download_url: UPLOAD }, {});
    const { rerender } = render(<TakeoffVectorViewer jobId={JOB} planSetId={null} focusItemIds={[pages[1].items[0].takeoff_item_id]} />);
    await settle();
    expect(screen.getByLabelText("Page lue")).toHaveValue(pages[1].id);

    fireEvent.change(screen.getByLabelText("Page lue"), { target: { value: pages[0].id } });
    rerender(<TakeoffVectorViewer jobId={JOB} planSetId={null} focusItemIds={[pages[2].items[0].takeoff_item_id]} />);
    await settle();
    expect(screen.getByLabelText("Page lue")).toHaveValue(pages[2].id);
    // A line without geometry leaves the page as it is.
    fireEvent.change(screen.getByLabelText("Page lue"), { target: { value: pages[0].id } });
    rerender(<TakeoffVectorViewer jobId={JOB} planSetId={null} focusItemIds={["99999999-9999-4999-8999-999999999999"]} />);
    await settle();
    expect(screen.getByLabelText("Page lue")).toHaveValue(pages[0].id);
  });
});

// TI-721, written before the fix: each page change reset zoom and pan, so a reviewer who went to another page and
// came back had lost the area they were inspecting. The army journeys read one page; the transitions are only
// reachable here. jsdom lays nothing out, so a page fits at 0.25 px per point: the geometry's width is
// `size_pt[0] × 0.25 × zoom` and the pan is the translation of the layer that holds the plan and its geometry.
describe("TakeoffVectorViewer, the view of each page (TI-721)", () => {
  // Page 2 is smaller than page 1 (A4 against A3), so a view carried from one page to the other would show.
  const A4 = [841.89, 595.28];
  const twoPages = () => [page(1, null, 1, "plan.pdf"), { ...page(2, null, 2, "plan.pdf"), reading: { ...reading, size_pt: A4 } }];
  const rounded = (value: number) => Math.round(value * 1000) / 1000;
  /** The width of a page of `points` fitted (0.25 px per point) then zoomed by `zoom`. */
  const fitted = (points: number, zoom = 1) => rounded(points * 0.25 * zoom);
  const geometryWidth = () => rounded(Number(screen.getByRole("img", { name: "Géométrie mesurée" }).getAttribute("width")));
  /** The layer's translation in pixels (jsdom writes `translate(0px, 0px)` back as `translate(0px)`). */
  const pan = (container: HTMLElement) => {
    const [x, y = 0] = (container.querySelector("canvas")!.parentElement!.style.transform.match(/-?\d+(\.\d+)?(?=px)/g) ?? []).map(Number);
    return { x, y };
  };
  const frameOf = (container: HTMLElement) => container.querySelector("canvas")!.parentElement!.parentElement!;
  const drag = (container: HTMLElement, by: { x: number; y: number }) => {
    const frame = frameOf(container);
    fireEvent.pointerDown(frame, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(frame, { clientX: 100 + by.x, clientY: 100 + by.y });
    fireEvent.pointerUp(frame, { clientX: 100 + by.x, clientY: 100 + by.y });
  };
  const turnTo = async (id: string) => {
    fireEvent.change(screen.getByLabelText("Page lue"), { target: { value: id } });
    await settle();
  };

  it("gives each page back its own zoom and pan when the reviewer returns to it, and opens a page never seen fitted", async () => {
    documents.set(UPLOAD, { pages: 2, failing: new Set() });
    stubPdfjs();
    const pages = twoPages();
    stubFetch({ pages, source_download_url: UPLOAD }, {});
    const { container } = render(<TakeoffVectorViewer jobId={JOB} planSetId={null} />);
    await settle();
    expect([geometryWidth(), pan(container)]).toEqual([fitted(1190.55), { x: 0, y: 0 }]);

    // Page 1: zoomed in twice (× 1.25²), then dragged to the area under inspection.
    fireEvent.click(screen.getByRole("button", { name: "Zoom avant" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom avant" }));
    drag(container, { x: -240, y: -120 });
    await settle();
    expect([geometryWidth(), pan(container)]).toEqual([fitted(1190.55, 1.5625), { x: -240, y: -120 }]);

    // Page 2, never seen: fitted to its own size.
    await turnTo(pages[1].id);
    expect([geometryWidth(), pan(container)]).toEqual([fitted(A4[0]), { x: 0, y: 0 }]);
    // Ctrl + wheel and a drag act on the page shown.
    fireEvent.wheel(frameOf(container), { deltaY: 100, ctrlKey: true });
    drag(container, { x: 30, y: 15 });
    await settle();
    expect([geometryWidth(), pan(container)]).toEqual([fitted(A4[0], 1 / 1.15), { x: 30, y: 15 }]);

    // Back on page 1: its zoom and pan, and the plan drawn at that zoom, not the fitted one.
    await turnTo(pages[0].id);
    expect([geometryWidth(), pan(container)]).toEqual([fitted(1190.55, 1.5625), { x: -240, y: -120 }]);
    expect(rendered.at(-1)).toEqual({ url: UPLOAD, page: 1 });
    expect(rounded(parseFloat(container.querySelector("canvas")!.style.width))).toBe(fitted(1190.55, 1.5625));

    // Back on page 2: its own view, not page 1's.
    await turnTo(pages[1].id);
    expect([geometryWidth(), pan(container)]).toEqual([fitted(A4[0], 1 / 1.15), { x: 30, y: 15 }]);

    // « Ajuster » fits the page shown again, and only that page.
    fireEvent.click(screen.getByRole("button", { name: "Ajuster" }));
    await settle();
    expect([geometryWidth(), pan(container)]).toEqual([fitted(A4[0]), { x: 0, y: 0 }]);
    await turnTo(pages[0].id);
    expect([geometryWidth(), pan(container)]).toEqual([fitted(1190.55, 1.5625), { x: -240, y: -120 }]);
  });

  it("keeps a page's view when the line in focus turns to another page and back (targeted review)", async () => {
    documents.set(UPLOAD, { pages: 2, failing: new Set() });
    stubPdfjs();
    const pages = twoPages();
    const lineOf = (index: number) => [pages[index].items[0].takeoff_item_id];
    stubFetch({ pages, source_download_url: UPLOAD }, {});
    const { container, rerender } = render(<TakeoffVectorViewer jobId={JOB} planSetId={null} focusItemIds={lineOf(0)} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Zoom avant" }));
    drag(container, { x: -80, y: -40 });
    await settle();

    rerender(<TakeoffVectorViewer jobId={JOB} planSetId={null} focusItemIds={lineOf(1)} />);
    await settle();
    expect(screen.getByLabelText("Page lue")).toHaveValue(pages[1].id);
    expect([geometryWidth(), pan(container)]).toEqual([fitted(A4[0]), { x: 0, y: 0 }]);

    rerender(<TakeoffVectorViewer jobId={JOB} planSetId={null} focusItemIds={lineOf(0)} />);
    await settle();
    expect(screen.getByLabelText("Page lue")).toHaveValue(pages[0].id);
    expect([geometryWidth(), pan(container)]).toEqual([fitted(1190.55, 1.25), { x: -80, y: -40 }]);
  });
});
