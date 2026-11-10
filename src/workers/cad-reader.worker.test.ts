import { describe, expect, it } from "vitest";

import { dxfBytes, layer, line, rec, type DxfFixture } from "@/lib/cad/dxf.test-utils";
import { BOILER_ROOM, PNG, SKETCHED_ROOM, documentXml, fcstd } from "@/lib/cad/fcstd.test-utils";
import { readCadOriginal } from "@/lib/cad/original";
import { dwgBytes, pngBytes } from "@/lib/cad/originals.test-utils";
import { createCadReader, type CadWorkerRequest } from "@/workers/cad-reader.worker";

/** Two networks in millimetres, the second on a frozen layer. */
const plan: DxfFixture = {
  layers: [layer("EF", 5), rec("LAYER", [2, "EU"], [70, 1], [62, 30])],
  entities: [line("EF", 0, 0, 8000, 0), line("EF", 8000, 0, 8000, 4000), line("EU", 0, 1000, 5000, 1000)],
};

const buffer = (bytes: Uint8Array) => bytes.slice().buffer;
const readRequest = (fileName: string, bytes: Uint8Array, requestId = "r1"): CadWorkerRequest => ({ requestId, type: "read", fileName, buffer: buffer(bytes) });

describe("createCadReader", () => {
  it("reads a DXF as the library does and answers a message that can be posted", async () => {
    const reply = await createCadReader()(readRequest("Réseaux.DXF", dxfBytes(plan)));
    expect(reply.response).toEqual({ requestId: "r1", ok: true, type: "read", original: await readCadOriginal("Réseaux.DXF", dxfBytes(plan)) });
    // The worker keeps the drawing to plot it later: it posts a copy, so nothing is transferred.
    expect(reply.transfer).toEqual([]);
    expect(structuredClone(reply.response)).toEqual(reply.response);
  });

  it("plots the drawing it has read, with the layers, unit and scale asked for", async () => {
    const reader = createCadReader();
    await reader(readRequest("plan.dxf", dxfBytes(plan)));
    const reply = await reader({ requestId: "p1", type: "plot", options: { shown: [false, true, true], denominator: 50, title: "Plan" } });
    if (!reply.response.ok || reply.response.type !== "plot") throw new Error("plot expected");
    const { plot } = reply.response;
    expect(reply.response.requestId).toBe("p1");
    expect(new TextDecoder("latin1").decode(plot.bytes.subarray(0, 5))).toBe("%PDF-");
    expect(plot).toMatchObject({ denominator: 50, scaleSource: "requested", layers: ["EF", "EU"], paths: 3 });
    // The PDF goes to the page without a copy.
    expect(plot.bytes.byteLength).toBe(plot.bytes.buffer.byteLength);
    expect(reply.transfer).toEqual([plot.bytes.buffer]);
  });

  it("plots what the file shows when no layer is asked for", async () => {
    const reader = createCadReader();
    await reader(readRequest("plan.dxf", dxfBytes(plan)));
    const reply = await reader({ requestId: "p2", type: "plot", options: {} });
    expect(reply.response).toMatchObject({ ok: true, type: "plot", plot: { layers: ["EF"], paths: 2 } });
  });

  it("says why a plot is refused", async () => {
    const reader = createCadReader();
    await reader(readRequest("plan.dxf", dxfBytes(plan)));
    expect((await reader({ requestId: "p3", type: "plot", options: { denominator: 3 } })).response)
      .toEqual({ requestId: "p3", ok: false, type: "plot", reason: "invalid_denominator" });
    expect((await reader({ requestId: "p4", type: "plot", options: { metresPerUnit: null } })).response)
      .toEqual({ requestId: "p4", ok: false, type: "plot", reason: "unknown_unit" });
    expect((await reader({ requestId: "p5", type: "plot", options: { shown: [false, false, false] } })).response)
      .toEqual({ requestId: "p5", ok: false, type: "plot", reason: "empty" });
  });

  it("has nothing to plot before a drawing is read", async () => {
    const reply = await createCadReader()({ requestId: "p0", type: "plot", options: {} });
    expect(reply).toEqual({ response: { requestId: "p0", ok: false, type: "plot", reason: "no_drawing" }, transfer: [] });
  });

  it("sums up a DWG and hands over its preview alone, not the file around it", async () => {
    const png = pngBytes(64), file = dwgBytes({ version: "AC1032", images: [{ code: 6, bytes: png }] });
    const reply = await createCadReader()(readRequest("plan.dwg", file));
    if (!reply.response.ok || reply.response.type !== "read" || reply.response.original.kind !== "summary") throw new Error("summary expected");
    const { summary } = reply.response.original;
    expect(summary.version).toEqual({ code: "AC1032", label: "AutoCAD 2018" });
    expect(summary.thumbnail?.type).toBe("image/png");
    expect(summary.thumbnail?.bytes).toEqual(png);
    expect(summary.thumbnail?.bytes.buffer.byteLength).toBe(png.byteLength);
    expect(reply.transfer).toEqual([summary.thumbnail?.bytes.buffer]);
  });

  it("sums up a FreeCAD document with its objects, and hands over its image alone", async () => {
    const reply = await createCadReader()(readRequest("Chaufferie.FCStd", fcstd(documentXml(BOILER_ROOM), { "thumbnails/Thumbnail.png": PNG })));
    if (!reply.response.ok || reply.response.type !== "read" || reply.response.original.kind !== "summary") throw new Error("summary expected");
    const { summary } = reply.response.original;
    expect(summary).toMatchObject({ format: "fcstd", version: { label: "FreeCAD 1.0" }, model: { total: 4, sketches: 0 } });
    expect(summary.thumbnail?.bytes).toEqual(PNG);
    expect(summary.thumbnail?.bytes.buffer.byteLength).toBe(PNG.byteLength);
    expect(reply.transfer).toEqual([summary.thumbnail?.bytes.buffer]);
    expect(structuredClone(reply.response)).toEqual(reply.response);
  });

  it("draws the sketches of a FreeCAD document, keeps the drawing to plot it and says what the document holds", async () => {
    const reader = createCadReader();
    const reply = await reader(readRequest("Chaufferie.FCStd", fcstd(documentXml(SKETCHED_ROOM), { "thumbnails/Thumbnail.png": PNG })));
    if (!reply.response.ok || reply.response.type !== "read" || reply.response.original.kind !== "drawing") throw new Error("drawing expected");
    const { drawing, source } = reply.response.original;
    expect(drawing.layers.map((entry) => entry.name)).toEqual(["0", "Local technique", "Réservations"]);
    expect(source).toMatchObject({ format: "fcstd", model: { total: 6, sketches: 2 } });
    // The image of the model goes to the page without the archive around it.
    expect(source?.thumbnail?.bytes).toEqual(PNG);
    expect(source?.thumbnail?.bytes.buffer.byteLength).toBe(PNG.byteLength);
    expect(reply.transfer).toEqual([source?.thumbnail?.bytes.buffer]);

    const plotted = await reader({ requestId: "p8", type: "plot", options: { denominator: 50 } });
    expect(plotted.response).toMatchObject({ ok: true, type: "plot", plot: { denominator: 50, layers: ["Local technique", "Réservations"], paths: 5 } });
  });

  it("forgets the drawing when another original is read, even one it cannot read", async () => {
    const reader = createCadReader();
    await reader(readRequest("plan.dxf", dxfBytes(plan)));
    await reader(readRequest("plan.dwg", dwgBytes({ version: "AC1032" }), "r2"));
    expect((await reader({ requestId: "p6", type: "plot", options: {} })).response).toMatchObject({ ok: false, reason: "no_drawing" });

    await reader(readRequest("plan.dxf", dxfBytes(plan), "r3"));
    expect((await reader(readRequest("vide.dxf", new Uint8Array(0), "r4"))).response).toEqual({ requestId: "r4", ok: false, type: "read", reason: "empty" });
    expect((await reader({ requestId: "p7", type: "plot", options: {} })).response).toMatchObject({ ok: false, reason: "no_drawing" });
  });

  it.each([
    ["binaire.dxf", new Uint8Array(Buffer.from("AutoCAD Binary DXF\r\n\x1a\0", "latin1")), "binary_dxf"],
    ["texte.dxf", new Uint8Array(Buffer.from("Bonjour,\r\nceci n'est pas un plan.\r\n")), "not_dxf"],
    ["faux.dwg", new Uint8Array(Buffer.from("%PDF-1.7 pas un DWG")), "not_dwg"],
    ["faux.rvt", new Uint8Array(Buffer.from("%PDF-1.7 pas un RVT")), "not_rvt"],
    ["faux.fcstd", new Uint8Array(Buffer.from("%PDF-1.7 pas un FCStd")), "not_fcstd"],
    ["plan.pdf", new Uint8Array(Buffer.from("%PDF-1.7")), "unsupported"],
  ])("says why %s is not read", async (fileName, bytes, reason) => {
    const reply = await createCadReader()(readRequest(fileName, bytes));
    expect(reply).toEqual({ response: { requestId: "r1", ok: false, type: "read", reason }, transfer: [] });
  });

  it("answers a failure it did not foresee without its message", async () => {
    const reply = await createCadReader()({ requestId: "r9", type: "read", fileName: null as never, buffer: buffer(dxfBytes(plan)) });
    expect(reply).toEqual({ response: { requestId: "r9", ok: false, type: "read", reason: "failed" }, transfer: [] });
  });
});
