import { useState } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { downloadBlob } from "@/lib/browser-download";
import { readDxf } from "@/lib/cad/dxf";
import { dxfBytes, insert, layer, line, lwpolyline } from "@/lib/cad/dxf.test-utils";
import type { CadOriginal } from "@/lib/cad/original";
import type { CadModel } from "@/lib/cad/fcstd";
import type { IfcModel } from "@/lib/cad/ifc";
import type { CadPlot } from "@/lib/cad/plot";
import type { CadSummary } from "@/lib/cad/summary";
import type { CadWorkerRequest, CadWorkerResponse } from "@/workers/cad-reader.worker";
import { IntakeCadPreview } from "./IntakeCadPreview";

const { routerRefreshMock } = vi.hoisted(() => ({ routerRefreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefreshMock }) }));
vi.mock("@/lib/browser-download", () => ({ downloadBlob: vi.fn() }));

type WorkerStub = {
  onmessage: ((event: { data: CadWorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage: ReturnType<typeof vi.fn<(request: CadWorkerRequest, transfer: Transferable[]) => void>>;
  terminate: ReturnType<typeof vi.fn<() => void>>;
};

function installWorkers() {
  const workers: WorkerStub[] = [];
  vi.stubGlobal("Worker", vi.fn(function WorkerConstructor() {
    const worker: WorkerStub = { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() };
    workers.push(worker);
    return worker;
  }));
  return workers;
}

type Upload = { status: number; body: unknown };
const ACCEPTED: Upload = { status: 200, body: { ok: true, data: { uploadId: "u1", files: [{ documentId: "d2", fileName: "Réseaux (tracé 1-50).pdf", status: "uploaded" }] } } };

/** The original downloads; what the dossier answers to a file sent to it is the test's to say. */
function installFetch(upload: Upload = ACCEPTED) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    if (init?.method === "POST") return { ok: upload.status < 400, status: upload.status, json: async () => upload.body };
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function lastRequest(worker: () => WorkerStub | undefined, count = 1): Promise<CadWorkerRequest> {
  await waitFor(() => expect(worker()?.postMessage).toHaveBeenCalledTimes(count));
  return (worker() as WorkerStub).postMessage.mock.calls[count - 1][0];
}

const answer = (worker: WorkerStub, response: CadWorkerResponse) => act(() => worker.onmessage?.({ data: response }));

// Layers: « 0 », EF, EU and ARCHI, which the file turns off. In millimetres: 4,5 m on EF, 2,5 m on EU, 10 m on ARCHI.
const fixture = {
  layers: [layer("EF", 5), layer("EU", 30), layer("ARCHI", -8)],
  entities: [
    line("EF", 0, 0, 3000, 0),
    lwpolyline("EF", [[0, 0], [0, 1000], [500, 1000]]),
    line("EU", 0, 0, 0, 2500),
    line("ARCHI", 0, 0, 10000, 0),
  ],
};
const drawing = readDxf(dxfBytes(fixture));
const unitless = readDxf(dxfBytes({ ...fixture, header: [[9, "$ACADVER"], [1, "AC1027"]] }));
const DOWNLOAD = "/api/affaires/p1/intake/files/d1/preview?download=1";

const DRAWING = "/api/affaires/p1/intake/files/d1/drawing";

// A fictional boiler room as FreeCAD would describe it: lengths in mm, areas in mm².
const MODEL: CadModel = {
  total: 4, sketches: 0, truncated: false, left: { objects: false, sketches: false, unread: false, dimensions: false },
  objects: [
    { name: "Pipe", label: "Départ chauffage", type: "Part::FeaturePython", kind: "Pipe Segment", dimensions: [{ name: "Diameter", kind: "length", value: 33.7 }, { name: "Length", kind: "length", value: 4250.5 }] },
    { name: "Pipe001", label: "Retour chauffage", type: "Part::FeaturePython", kind: "Pipe Segment", dimensions: [{ name: "Diameter", kind: "length", value: 33.7 }, { name: "Length", kind: "length", value: 1749.5 }] },
    { name: "Wall", label: "Mur étanche", type: "Part::FeaturePython", kind: "Wall", dimensions: [{ name: "HorizontalArea", kind: "area", value: 1.2e6 }] },
    { name: "Box", label: "Ballon", type: "Part::Box", kind: "Box", dimensions: [] },
  ],
};
const fcstdSummary = (model: CadModel = MODEL): CadSummary => ({ format: "fcstd", version: { code: "1.0", label: "FreeCAD 1.0" }, thumbnail: null, model });
const FCSTD = { fileName: "Chaufferie.FCStd" };

// What the reader gives of a fictional IFC model: two pipes of 3 m each in the basement. Its mesh stays out: no graphics card here.
const IFC_MODEL: IfcModel = {
  schema: "IFC4", application: "Maquetteur Fictif 2026", classes: ["IfcPipeSegment"], storeys: [{ name: "Sous-sol", elevation: -3 }],
  rows: [{ cls: 0, type: "Tuyau PVC:Évacuation", section: [110], storey: 0, count: 2, length: 6, lengths: 2, stated: 0, approximate: 0, area: 0, areas: 0, volume: 0, volumes: 0 }],
  elements: 2, counted: 2, truncated: { elements: false, rows: false, geometry: false, apart: false },
  mesh: {
    positions: new Float32Array(9), normals: new Int8Array(9), colors: new Uint8Array(12), indices: new Uint32Array(3),
    groups: [{ cls: 0, storey: 0, transparent: false, start: 0, count: 3, min: [0, 0, 0], max: [1, 1, 1] }],
    min: [0, 0, 0], max: [1, 1, 1], triangles: 1, truncated: false,
  },
};
const IFC = { fileName: "Chaufferie.ifc" };
const DWG: CadOriginal = { kind: "summary", summary: { format: "dwg", version: { code: "AC1032", label: "AutoCAD 2018" }, thumbnail: null } };

function Harness({ canManage, onEnlargeableChange, dwg = false, fileName }: { canManage: boolean; onEnlargeableChange(enlargeable: boolean): void; dwg?: boolean; fileName?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <IntakeCadPreview
      projectId="p1"
      fileName={fileName ?? (dwg ? "Réseaux.dwg" : "Réseaux.dxf")}
      url={DOWNLOAD}
      drawingUrl={dwg ? DRAWING : undefined}
      canManage={canManage}
      expanded={expanded}
      onExpandedChange={setExpanded}
      onEnlargeableChange={onEnlargeableChange}
    />
  );
}

/** The preview once its worker has read the original. */
async function opened(original: CadOriginal, options: { canManage?: boolean; upload?: Upload; fileName?: string } = {}) {
  const workers = installWorkers();
  const fetchMock = installFetch(options.upload);
  const onEnlargeableChange = vi.fn<(enlargeable: boolean) => void>();
  render(<Harness canManage={options.canManage ?? true} onEnlargeableChange={onEnlargeableChange} fileName={options.fileName} />);
  expect(screen.getByRole("status")).toHaveTextContent(original.kind === "ifc" ? "Lecture de la maquette…" : "Lecture du plan…");
  const request = await lastRequest(() => workers[0]);
  await answer(workers[0], { requestId: request.requestId, ok: true, type: "read", original });
  return { worker: workers[0], workers, fetchMock, onEnlargeableChange, request };
}

/** The large view, opened from the line under the plan. */
async function enlarged(original: CadOriginal = { kind: "drawing", drawing }, options: { canManage?: boolean; upload?: Upload; fileName?: string } = {}) {
  const view = await opened(original, options);
  await userEvent.click(screen.getByRole("button", { name: "Calques et quantités" }));
  return { ...view, dialog: within(await screen.findByRole("dialog")) };
}

const plotted = (plot: Partial<CadPlot> = {}): CadPlot => ({
  bytes: new Uint8Array([37, 80, 68, 70]), denominator: 50, scaleSource: "fit", otherScales: [], sheet_mm: [420, 297],
  layers: ["EF", "EU"], paths: 3, texts: 0, omitted: { hatches: 0, texts: 0 }, ...plot,
});

/** Asks for the plot and answers it as the worker would. */
async function plot(view: Awaited<ReturnType<typeof enlarged>>, response: (requestId: string) => CadWorkerResponse) {
  await userEvent.click(view.dialog.getByRole("button", { name: "Ajouter le tracé PDF au dossier" }));
  const request = await lastRequest(() => view.worker, 2);
  await answer(view.worker, response(request.requestId));
  return request;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("IntakeCadPreview", () => {
  it("downloads the original, has it read and shows the plan with what its layers draw", async () => {
    const { fetchMock, request, onEnlargeableChange } = await opened({ kind: "drawing", drawing });
    expect(fetchMock.mock.calls[0][0]).toBe(DOWNLOAD);
    expect(request).toMatchObject({ type: "read", fileName: "Réseaux.dxf" });
    expect(screen.getByRole("img", { name: "Plan Réseaux.dxf" })).toBeInTheDocument();
    expect(screen.getByText("2 calques · 7 m de tracé")).toBeInTheDocument();
    expect(onEnlargeableChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows what a DWG says of itself, and how to have its plan read", async () => {
    const { onEnlargeableChange } = await opened(DWG);
    expect(screen.getByText("Format DWG AutoCAD 2018")).toBeInTheDocument();
    expect(screen.getByText(/Enregistrez ce plan en DXF/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Calques et quantités" })).not.toBeInTheDocument();
    expect(onEnlargeableChange).toHaveBeenLastCalledWith(false);
  });

  it("shows a DWG as the plan the server converted it to, and says in the large view that it is a conversion", async () => {
    const workers = installWorkers();
    const fetchMock = installFetch();
    const onEnlargeableChange = vi.fn<(enlargeable: boolean) => void>();
    render(<Harness canManage dwg onEnlargeableChange={onEnlargeableChange} />);
    const first = await lastRequest(() => workers[0]);
    await answer(workers[0], { requestId: first.requestId, ok: true, type: "read", original: DWG });
    expect(screen.getByRole("status")).toHaveTextContent("Conversion du DWG…");

    const second = await lastRequest(() => workers[0], 2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([DOWNLOAD, DRAWING]);
    expect(second).toMatchObject({ type: "read", fileName: "Réseaux.dwg.dxf" });
    await answer(workers[0], { requestId: second.requestId, ok: true, type: "read", original: { kind: "drawing", drawing } });
    expect(screen.getByRole("img", { name: "Plan Réseaux.dwg" })).toBeInTheDocument();
    expect(onEnlargeableChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole("button", { name: "Calques et quantités" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("DWG AutoCAD 2018, converti par LibreDWG · 2 calques · 7 m de tracé")).toBeInTheDocument();
    expect(dialog.getByText(/vérifiez une cote connue avant de vous fier aux quantités/)).toBeInTheDocument();
    expect(dialog.getByText("Tracé").nextElementSibling).toHaveTextContent("7 m");
    expect(dialog.getByRole("button", { name: "Ajouter le tracé PDF au dossier" })).toBeEnabled();
  });

  it("keeps what a DWG says of itself, with the server's reason, when it is not converted", async () => {
    const workers = installWorkers();
    const refusal = "Ce DWG est enregistré dans un format antérieur à AutoCAD R13, que MergeOne ne convertit pas.";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url === DRAWING
        ? { ok: false, status: 422, json: async () => ({ error: { code: "DWG_CONVERSION_OLD_FORMAT", message: refusal } }) }
        : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }));
    const onEnlargeableChange = vi.fn<(enlargeable: boolean) => void>();
    render(<Harness canManage dwg onEnlargeableChange={onEnlargeableChange} />);
    const first = await lastRequest(() => workers[0]);
    await answer(workers[0], { requestId: first.requestId, ok: true, type: "read", original: { kind: "summary", summary: { format: "dwg", version: { code: "AC1009", label: "AutoCAD R11/R12" }, thumbnail: null } } });
    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(screen.getByText("Format DWG AutoCAD R11/R12")).toBeInTheDocument();
    expect(screen.queryByText(/Enregistrez ce plan en DXF/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Calques et quantités" })).not.toBeInTheDocument();
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1);
    expect(onEnlargeableChange).toHaveBeenLastCalledWith(false);
    // Asking again would be refused again.
    expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
  });

  it("offers to ask again for the drawing of a DWG when the server was busy", async () => {
    const workers = installWorkers();
    let busy = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url === DRAWING && busy
        ? { ok: false, status: 503, json: async () => ({ error: { code: "DWG_CONVERSION_BUSY", message: "Le serveur convertit déjà plusieurs DWG. Réessayez dans un instant." } }) }
        : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }));
    render(<Harness canManage dwg onEnlargeableChange={vi.fn()} />);
    const first = await lastRequest(() => workers[0]);
    await answer(workers[0], { requestId: first.requestId, ok: true, type: "read", original: DWG });
    expect(await screen.findByText("Le serveur convertit déjà plusieurs DWG. Réessayez dans un instant.")).toBeInTheDocument();

    busy = false;
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    const again = await lastRequest(() => workers[1]);
    await answer(workers[1], { requestId: again.requestId, ok: true, type: "read", original: DWG });
    const converted = await lastRequest(() => workers[1], 2);
    await answer(workers[1], { requestId: converted.requestId, ok: true, type: "read", original: { kind: "drawing", drawing } });
    expect(screen.getByRole("img", { name: "Plan Réseaux.dwg" })).toBeInTheDocument();
  });

  it("shows the picture a Revit model carries, and lets go of it when closed", async () => {
    // jsdom makes no address for a blob: the test lends it the two functions, and takes them back.
    const createObjectURL = vi.fn(() => "blob:apercu"), revokeObjectURL = vi.fn();
    const before = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    onTestFinished(() => void Object.assign(URL, before));
    const thumbnail = { type: "image/png" as const, bytes: new Uint8Array([137, 80, 78, 71]) };
    await opened({ kind: "summary", summary: { format: "rvt", version: null, thumbnail } });
    expect(screen.getByRole("img", { name: "Aperçu enregistré dans le fichier" })).toHaveAttribute("src", "blob:apercu");
    expect(screen.getByText("Version non lue")).toBeInTheDocument();
    // What is not read says the way that is: the export of the model in IFC.
    expect(screen.getByText(/Une maquette Revit n’est pas lue dans MergeOne\. Exportez-la en IFC depuis Revit et déposez ce fichier pour la voir en 3D et relever ses quantités/)).toBeInTheDocument();
    cleanup();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:apercu");
  });

  it("shows what a FreeCAD model holds, and lists its objects with their dimensions in the large view", async () => {
    const { onEnlargeableChange } = await opened({ kind: "summary", summary: fcstdSummary() }, FCSTD);
    expect(screen.getByText("Maquette FreeCAD 1.0")).toBeInTheDocument();
    expect(screen.getByText("4 objets")).toBeInTheDocument();
    expect(screen.getByText(/ne sont pas dessinés dans MergeOne/)).toBeInTheDocument();
    expect(onEnlargeableChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole("button", { name: "Objets et dimensions" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Maquette FreeCAD 1.0 · 4 objets")).toBeInTheDocument();
    // By kind: two pipes whose lengths FreeCAD wrote add up to 6 m; no length is invented for the others.
    const kinds = within(dialog.getByRole("table", { name: "Objets par nature" }));
    expect(within(kinds.getByRole("row", { name: /Pipe Segment/ })).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Pipe Segment", "2", "6 m"]);
    expect(within(kinds.getByRole("row", { name: /Wall/ })).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Wall", "1", ""]);
    const objects = within(dialog.getByRole("table", { name: "Objets et dimensions" }));
    expect(within(objects.getByRole("row", { name: /Départ chauffage/ })).getAllByRole("cell").map((cell) => cell.textContent?.replace(/\s/gu, " ")))
      .toEqual(["Départ chauffage", "Pipe Segment", "Diamètre 33,7 mm · Longueur 4 250,5 mm"]);
    expect(objects.getAllByRole("row")).toHaveLength(5);
    // Nothing to plot from a model that has no sketch.
    expect(dialog.queryByRole("button", { name: "Ajouter le tracé PDF au dossier" })).not.toBeInTheDocument();
  });

  it("exports the objects of a model as a CSV named after it", async () => {
    await opened({ kind: "summary", summary: fcstdSummary() }, FCSTD);
    await userEvent.click(screen.getByRole("button", { name: "Objets et dimensions" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Exporter les objets (CSV)" }));
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe("Chaufferie - objets.csv");
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(await blob.text()).toContain("Départ chauffage;Pipe Segment;Part::FeaturePython;Longueur;4250,5;mm");
  });

  it("says when a model holds more objects than it lists", async () => {
    const many: CadModel = { ...MODEL, total: 2500, truncated: true };
    await opened({ kind: "summary", summary: fcstdSummary(many) }, FCSTD);
    expect(screen.getByText(/^2\s500 objets$/u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Objets et dimensions" }));
    expect(within(await screen.findByRole("dialog")).getByRole("alert")).toHaveTextContent(/Cette maquette n’a pas été lue en entier : 4 de ses 2\s500 objets sont listés et exportés\./u);
  });

  it("says when an object of a model has more dimensions than it lists, with what else was left out", async () => {
    await opened({ kind: "summary", summary: fcstdSummary({ ...MODEL, truncated: true, left: { objects: false, sketches: false, unread: false, dimensions: true } }) }, FCSTD);
    await userEvent.click(screen.getByRole("button", { name: "Objets et dimensions" }));
    expect(within(await screen.findByRole("dialog")).getByRole("alert")).toHaveTextContent("Cette maquette n’a pas été lue en entier : certains de ses objets ont plus de dimensions qu’il n’en est listé.");
    cleanup();

    await opened({ kind: "summary", summary: fcstdSummary({ ...MODEL, truncated: true, left: { objects: true, sketches: false, unread: false, dimensions: false } }) }, FCSTD);
    await userEvent.click(screen.getByRole("button", { name: "Objets et dimensions" }));
    expect(within(await screen.findByRole("dialog")).getByRole("alert")).toHaveTextContent("Cette maquette n’a pas été lue en entier : elle nomme plus d’objets que MergeOne n’en lit, leur nombre est un minimum.");
    cleanup();

    await opened({ kind: "summary", summary: fcstdSummary({ ...MODEL, total: 2500, truncated: true, left: { objects: false, sketches: true, unread: true, dimensions: true } }) }, FCSTD);
    await userEvent.click(screen.getByRole("button", { name: "Objets et dimensions" }));
    expect(within(await screen.findByRole("dialog")).getByRole("alert")).toHaveTextContent(
      /Cette maquette n’a pas été lue en entier : 4 de ses 2\s500 objets sont listés et exportés ; ses esquisses comptent trop d’éléments pour être toutes dessinées ; des éléments de ses esquisses, comme les ellipses et les splines, ne sont pas dessinés ; certains de ses objets ont plus de dimensions qu’il n’en est listé\./u,
    );
  });

  it("has no large view for a model in which nothing has a shape", async () => {
    const { onEnlargeableChange } = await opened({ kind: "summary", summary: fcstdSummary({ objects: [], total: 0, sketches: 0, truncated: false, left: { objects: false, sketches: false, unread: false, dimensions: false } }) }, FCSTD);
    expect(screen.getByText("Aucun objet ayant une forme")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Objets et dimensions" })).not.toBeInTheDocument();
    expect(onEnlargeableChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says, where there is no large view to say it, that a model names more objects than were read", async () => {
    // Nothing has a shape among the objects that were read: those that follow were not looked at, and may have one.
    await opened({ kind: "summary", summary: fcstdSummary({ objects: [], total: 0, sketches: 0, truncated: true, left: { objects: true, sketches: false, unread: false, dimensions: false } }) }, FCSTD);
    expect(screen.getByText("Aucun objet ayant une forme parmi ceux qui ont été lus")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Cette maquette nomme plus d’objets que MergeOne n’en lit : les suivants, avec leurs formes et leurs esquisses, n’ont pas été lus.");
    expect(screen.queryByRole("button", { name: "Objets et dimensions" })).not.toBeInTheDocument();
  });

  it("shows what an IFC model holds and lists its quantities in the large view, even in a browser without a 3D view", async () => {
    const { onEnlargeableChange } = await opened({ kind: "ifc", model: IFC_MODEL }, IFC);
    expect(screen.getByText("IFC4 · 2 éléments · 1 niveau")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("La vue 3D n’est pas disponible dans ce navigateur. Les quantités de la maquette restent disponibles.");
    expect(onEnlargeableChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole("button", { name: "Vue 3D et quantités" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/^Écrite par Maquetteur Fictif 2026 · /)).toBeInTheDocument();
    const types = within(dialog.getByRole("table", { name: "Quantités par type" }));
    expect(within(types.getByRole("row", { name: /Tuyau PVC:Évacuation/ })).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Tuyau PVC:Évacuation Ø 110 mm", "2", "6 m"]);
    // A model is not a plan: nothing to plot for the métré.
    expect(dialog.queryByRole("button", { name: "Ajouter le tracé PDF au dossier" })).not.toBeInTheDocument();
  });

  it("ends the worker once an IFC model is read: its reader holds much memory, and nothing more is asked of it", async () => {
    const { worker } = await opened({ kind: "ifc", model: IFC_MODEL }, IFC);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("IFC4 · 2 éléments · 1 niveau")).toBeInTheDocument();
  });

  it("keeps the worker of a drawing, which it plots", async () => {
    const { worker } = await opened({ kind: "drawing", drawing });
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("has no large view for an IFC model without any element", async () => {
    const { onEnlargeableChange } = await opened({ kind: "ifc", model: { ...IFC_MODEL, classes: [], storeys: [], rows: [], elements: 0, mesh: null } }, IFC);
    expect(screen.getByText("IFC4 · Aucun élément")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vue 3D et quantités" })).not.toBeInTheDocument();
    expect(onEnlargeableChange).toHaveBeenLastCalledWith(false);
  });

  it("draws the sketches of a FreeCAD model, and says in the large view what they are and what the model holds", async () => {
    const { dialog } = await enlarged({ kind: "drawing", drawing, source: fcstdSummary({ ...MODEL, sketches: 3 }) }, FCSTD);
    expect(screen.getByRole("img", { name: "Plan Chaufferie.FCStd" })).toBeInTheDocument();
    expect(dialog.getByText(/^Esquisses de la maquette FreeCAD 1\.0 · /)).toBeInTheDocument();
    expect(dialog.getByText(/Chaque esquisse est dessinée dans son propre plan/)).toBeInTheDocument();
    expect(dialog.queryByText(/LibreDWG/)).not.toBeInTheDocument();
    expect(dialog.getByRole("table", { name: "Objets par nature" })).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Exporter les objets (CSV)" })).toBeInTheDocument();
    // The sketches are a drawing like another: measured by layer, and plotted for the métré.
    expect(dialog.getByRole("button", { name: "Ajouter le tracé PDF au dossier" })).toBeInTheDocument();
  });

  it("says why a file was not read and reads it again when asked", async () => {
    const workers = installWorkers();
    installFetch();
    render(<Harness canManage onEnlargeableChange={vi.fn()} />);
    const first = await lastRequest(() => workers[0]);
    await answer(workers[0], { requestId: first.requestId, ok: false, type: "read", reason: "binary_dxf" });
    expect(screen.getByRole("alert")).toHaveTextContent("Ce DXF est au format binaire.");

    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    const second = await lastRequest(() => workers[1]);
    await answer(workers[1], { requestId: second.requestId, ok: true, type: "read", original: { kind: "drawing", drawing } });
    expect(screen.getByText("2 calques · 7 m de tracé")).toBeInTheDocument();
  });

  it("lists in the large view the layers that draw something, with their lengths", async () => {
    const { dialog } = await enlarged();
    expect(dialog.getByRole("heading", { name: "Réseaux.dxf" })).toBeInTheDocument();
    expect(dialog.getByText("AutoCAD 2013 · 2 calques · 7 m de tracé")).toBeInTheDocument();
    expect(dialog.queryByText(/LibreDWG/)).not.toBeInTheDocument();
    expect(dialog.getByRole("img", { name: "Plan Réseaux.dxf" })).toBeInTheDocument();
    const rows = dialog.getAllByRole("listitem").map((row) => row.textContent);
    // By name; a layer the file turns off is listed, and counts for nothing until it is shown.
    expect(rows).toEqual(["ARCHI", "EF4,5 m", "EU2,5 m"]);
    expect(dialog.getByRole("checkbox", { name: /^EF/ })).toBeChecked();
    expect(dialog.getByRole("checkbox", { name: /^ARCHI/ })).not.toBeChecked();
    expect(dialog.getByText("Tracé").nextElementSibling).toHaveTextContent("7 m");
    expect(dialog.getByRole("button", { name: "Comme dans le fichier" })).toBeDisabled();
  });

  it("counts only the layers shown", async () => {
    const { dialog } = await enlarged();
    await userEvent.click(dialog.getByRole("checkbox", { name: /^EU/ }));
    expect(dialog.getByText("Tracé").nextElementSibling).toHaveTextContent("4,5 m");
    expect(screen.getAllByText("1 calque · 4,5 m de tracé")).toHaveLength(1);

    await userEvent.click(dialog.getByRole("button", { name: "Tout afficher" }));
    expect(dialog.getByText("Tracé").nextElementSibling).toHaveTextContent("17 m");
    expect(dialog.getByRole("checkbox", { name: /^ARCHI/ })).toBeChecked();
    expect(dialog.getAllByRole("listitem")[0]).toHaveTextContent("ARCHI10 m");

    await userEvent.click(dialog.getByRole("button", { name: "Comme dans le fichier" }));
    expect(dialog.getByText("Tracé").nextElementSibling).toHaveTextContent("7 m");
    expect(dialog.getByRole("checkbox", { name: /^ARCHI/ })).not.toBeChecked();
  });

  it("measures in the unit chosen", async () => {
    const { dialog } = await enlarged();
    const unit = dialog.getByRole("combobox", { name: "Unité du dessin" });
    expect(within(unit).getAllByRole("option").map((option) => option.textContent)).toEqual(["Millimètres (unité du fichier)", "Centimètres", "Mètres", "Unités du dessin"]);
    await userEvent.selectOptions(unit, "Centimètres");
    expect(dialog.getByText("Tracé").nextElementSibling).toHaveTextContent("70 m");
    await userEvent.selectOptions(unit, "Unités du dessin");
    expect(dialog.getByText("Tracé").nextElementSibling).toHaveTextContent("7 000 u");
    expect(dialog.getByText(/choisissez l’unité pour les lire en mètres/)).toBeInTheDocument();
  });

  it("counts the blocks placed and names them by layer", async () => {
    const withBlocks = readDxf(dxfBytes({
      layers: [layer("EF", 5)],
      blocks: [{ name: "VANNE", entities: [line("0", 0, 0, 100, 0)] }],
      entities: [line("EF", 0, 0, 1000, 0), insert("EF", "VANNE", 0, 0), insert("EF", "VANNE", 500, 0)],
    }));
    const { dialog } = await enlarged({ kind: "drawing", drawing: withBlocks });
    expect(dialog.getByText("Blocs posés").nextElementSibling).toHaveTextContent("2");
    expect(dialog.getByText("Blocs par calque (1)")).toBeInTheDocument();
    expect(dialog.getByRole("row", { name: "VANNE EF 2", hidden: true })).toBeInTheDocument();
  });

  it("exports the quantities shown as a CSV named after the plan", async () => {
    const { dialog } = await enlarged();
    await userEvent.click(dialog.getByRole("button", { name: "Exporter les quantités (CSV)" }));
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe("Réseaux - quantités.csv");
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const csv = await blob.text();
    expect(csv).toContain("EF");
    expect(csv).not.toContain("ARCHI");
  });

  it("plots the layers shown and adds the PDF to the dossier", async () => {
    const view = await enlarged();
    await userEvent.selectOptions(view.dialog.getByRole("combobox", { name: "Échelle du tracé" }), "1/50");
    const request = await plot(view, (requestId) => ({ requestId, ok: true, type: "plot", plot: plotted({ scaleSource: "requested", omitted: { hatches: 2, texts: 1 } }) }));
    expect(request).toMatchObject({ type: "plot", options: { shown: [true, true, true, false], metresPerUnit: 0.001, denominator: 50, title: "Réseaux.dxf" } });

    const done = await view.dialog.findByRole("status");
    expect(done).toHaveTextContent("« Réseaux (tracé 1-50).pdf » est dans le dossier : 1/50 sur une feuille de 420 × 297 mm.");
    expect(done).toHaveTextContent("2 hachures ne sont pas tracées : le PDF porte le tracé seul.");
    expect(done).toHaveTextContent("1 ligne de texte n’est pas écrite.");
    expect(done).not.toHaveTextContent("annonce");

    const [url, init] = view.fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/affaires/p1/intake/files");
    const sent = (init.body as FormData).get("files") as File;
    expect([sent.name, sent.type, sent.size]).toEqual(["Réseaux (tracé 1-50).pdf", "application/pdf", 4]);
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("says where the scale of an automatic plot comes from", async () => {
    const view = await enlarged();
    const request = await plot(view, (requestId) => ({ requestId, ok: true, type: "plot", plot: plotted({ scaleSource: "drawing", otherScales: [100, 200] }) }));
    expect(request).toMatchObject({ options: { denominator: undefined } });
    const done = await view.dialog.findByRole("status");
    expect(done).toHaveTextContent("L’échelle est celle que le plan annonce.");
    expect(done).toHaveTextContent("Le plan annonce aussi 1/100, 1/200 : le métré demandera laquelle retenir.");
  });

  it("says once that the plan announces several scales", async () => {
    const view = await enlarged();
    await plot(view, (requestId) => ({ requestId, ok: true, type: "plot", plot: plotted({ scaleSource: "fit", otherScales: [50, 100] }) }));
    const done = await view.dialog.findByRole("status");
    expect(done).toHaveTextContent("Le plan annonce plusieurs échelles (1/50, 1/100) : le tracé prend la plus grande qui tient sur une feuille A0, et le métré demandera laquelle retenir.");
    expect(done).not.toHaveTextContent("Le plan n’annonce pas d’échelle");
    expect(done).not.toHaveTextContent("annonce aussi");
  });

  it("says why a plot was refused, and sends nothing to the dossier", async () => {
    const view = await enlarged();
    await plot(view, (requestId) => ({ requestId, ok: false, type: "plot", reason: "does_not_fit" }));
    expect(await view.dialog.findByRole("alert")).toHaveTextContent("Le plan ne tient pas sur une feuille à cette échelle : choisissez une échelle plus petite.");
    expect(view.fetchMock).toHaveBeenCalledTimes(1);
    expect(routerRefreshMock).not.toHaveBeenCalled();
    expect(view.dialog.getByRole("button", { name: "Ajouter le tracé PDF au dossier" })).toBeEnabled();
  });

  it("says what the dossier answered when it refuses the plot", async () => {
    const view = await enlarged({ kind: "drawing", drawing }, { upload: { status: 409, body: { error: { code: "conflict", message: "Le dossier est verrouillé." } } } });
    await plot(view, (requestId) => ({ requestId, ok: true, type: "plot", plot: plotted() }));
    expect(await view.dialog.findByRole("alert")).toHaveTextContent("Le dossier est verrouillé.");
    expect(view.dialog.queryByRole("status")).not.toBeInTheDocument();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("does not plot before the unit is known, nor when nothing is shown", async () => {
    const { dialog } = await enlarged({ kind: "drawing", drawing: unitless });
    const button = dialog.getByRole("button", { name: "Ajouter le tracé PDF au dossier" });
    expect(button).toBeDisabled();
    expect(dialog.getByText("Choisissez l’unité du dessin pour tracer à l’échelle.")).toBeInTheDocument();
    await userEvent.selectOptions(dialog.getByRole("combobox", { name: "Unité du dessin" }), "Millimètres");
    expect(button).toBeEnabled();
    await userEvent.click(dialog.getByRole("checkbox", { name: /^EF/ }));
    await userEvent.click(dialog.getByRole("checkbox", { name: /^EU/ }));
    expect(button).toBeDisabled();
    expect(screen.getAllByText("Aucun calque affiché")).toHaveLength(1);
  });

  it("keeps the plot from who cannot change the dossier", async () => {
    const { dialog } = await enlarged({ kind: "drawing", drawing }, { canManage: false });
    expect(dialog.getByRole("button", { name: "Exporter les quantités (CSV)" })).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Ajouter le tracé PDF au dossier" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("heading", { name: "Tracé PDF pour le métré" })).not.toBeInTheDocument();
  });

  it("warns that a drawing read in part gives minimum quantities", async () => {
    const cut = readDxf(dxfBytes(fixture), { limits: { maxEntities: 2 } });
    const { dialog } = await enlarged({ kind: "drawing", drawing: cut });
    const warning = dialog.getByRole("alert");
    expect(warning).toHaveTextContent("Ce dessin compte trop d’objets : la lecture s’est arrêtée avant la fin.");
    expect(warning).toHaveTextContent("Les quantités affichées sont un minimum.");
  });

  it("says of sketches not all drawn that their quantities are a minimum, and why", async () => {
    const partial = { ...drawing, truncated: true, warnings: [{ code: "sketch_unread" as const }], unsupported: [{ type: "ELLIPSE_NON_LU", count: 2 }] };
    const { dialog } = await enlarged({ kind: "drawing", drawing: partial, source: fcstdSummary({ ...MODEL, sketches: 1, truncated: true, left: { objects: false, sketches: false, unread: true, dimensions: false } }) }, FCSTD);
    const [warning] = dialog.getAllByRole("alert");
    expect(warning).toHaveTextContent("Des éléments des esquisses ne sont pas dessinés, comme les ellipses et les splines : ils sont comptés sous « Objets non lus ».");
    expect(warning).toHaveTextContent("Les quantités affichées sont un minimum.");
    expect(dialog.getByText("ELLIPSE_NON_LU × 2")).toBeInTheDocument();
  });
});
