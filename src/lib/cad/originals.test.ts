import { describe, expect, it } from "vitest";

import { openCfb } from "@/lib/cad/cfb";
import { CadReadError } from "@/lib/cad/dxf";
import { dxfBytes, line } from "@/lib/cad/dxf.test-utils";
import { BOILER_ROOM, PNG, SKETCHED_ROOM, documentXml, fcstd } from "@/lib/cad/fcstd.test-utils";
import { readCadOriginal } from "@/lib/cad/original";
import { basicFileInfo, cfbBytes, dibBytes, dwgBytes, pngBytes, revitPreview } from "@/lib/cad/originals.test-utils";
import { readDwgSummary, readRvtSummary } from "@/lib/cad/summary";

const filled = (length: number, seed: number) => Uint8Array.from({ length }, (_, index) => (index * seed + 3) & 255);
const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);
const reasonOf = (run: () => unknown) => {
  try { run(); } catch (error) { return error instanceof CadReadError ? error.reason : error; }
  return null;
};

describe("openCfb", () => {
  const small = filled(700, 7), large = filled(9000, 11), exact = filled(4096, 13);
  const streams = [{ name: "BasicFileInfo", bytes: small }, { name: "RevitPreview4.0", bytes: large }, { name: "Contents", bytes: exact }, { name: "Vide", bytes: new Uint8Array(0) }];

  it.each([9, 12] as const)("reads back small and large streams, with sectors of 2^%i bytes", (shift) => {
    const file = openCfb(cfbBytes(streams, shift));
    expect(file?.names).toEqual(["BasicFileInfo", "RevitPreview4.0", "Contents", "Vide"]);
    expect(file?.read("BasicFileInfo", 1 << 20)).toEqual(small);
    expect(file?.read("RevitPreview4.0", 1 << 20)).toEqual(large);
    expect(file?.read("Contents", 1 << 20)).toEqual(exact);
    expect(file?.read("Vide", 1 << 20)).toEqual(new Uint8Array(0));
  });

  it("finds a stream whatever the case of its name, and says when there is none", () => {
    const file = openCfb(cfbBytes(streams));
    expect(file?.read("basicfileinfo", 1 << 20)).toEqual(small);
    expect(file?.read("Formats", 1 << 20)).toBeNull();
  });

  it("stops at the size asked for", () => {
    const file = openCfb(cfbBytes(streams));
    expect(file?.read("RevitPreview4.0", 1000)).toEqual(large.subarray(0, 1000));
    expect(file?.read("BasicFileInfo", 100)).toEqual(small.subarray(0, 100));
  });

  it("is not fooled by another file, an absurd header or a cut file", () => {
    expect(openCfb(new Uint8Array(0))).toBeNull();
    expect(openCfb(new TextEncoder().encode("AC1032 not a compound file".padEnd(600, " ")))).toBeNull();
    const absurd = cfbBytes(streams);
    absurd[0x1e] = 31;
    expect(openCfb(absurd)).toBeNull();
    const cut = openCfb(cfbBytes(streams).slice(0, 2048));
    expect(cut === null || cut.read("RevitPreview4.0", 1 << 20) === null).toBe(true);
    expect(openCfb(cfbBytes(streams).slice(0, 600))).toBeNull();
  });

  it("does not loop on a chain that comes back on itself", () => {
    const bytes = cfbBytes(streams);
    // Sectors: the allocation table, two of directory, the small streams' table, two of small streams, then the large stream.
    const firstLarge = 1 + 2 + 1 + 2;
    new DataView(bytes.buffer).setUint32(512 + 4 * firstLarge, firstLarge, true);
    const file = openCfb(bytes);
    expect(file?.read("BasicFileInfo", 1 << 20)).toEqual(small);
    expect(file?.read("RevitPreview4.0", 1 << 20)).toBeNull();
    const directory = cfbBytes(streams);
    new DataView(directory.buffer).setUint32(512 + 4 * 1, 1, true);
    expect(openCfb(directory)).toBeNull();
  });

  it("does not loop on directory entries that point at each other", () => {
    const bytes = cfbBytes(streams);
    // Entry 2's right sibling is entry 1 again.
    new DataView(bytes.buffer).setUint32(2 * 512 + 128 * 2 + 0x48, 1, true);
    expect(openCfb(bytes)?.names).toEqual(["BasicFileInfo", "RevitPreview4.0"]);
  });
});

describe("readDwgSummary", () => {
  it("names the release from the first six bytes", () => {
    expect(readDwgSummary(dwgBytes())).toEqual({ format: "dwg", version: { code: "AC1032", label: "AutoCAD 2018" }, thumbnail: null });
    expect(readDwgSummary(dwgBytes({ version: "AC1015" })).version).toEqual({ code: "AC1015", label: "AutoCAD 2000" });
    expect(readDwgSummary(dwgBytes({ version: "AC1099" })).version).toEqual({ code: "AC1099", label: "AC1099" });
  });

  it("refuses what is not a DWG", () => {
    expect(reasonOf(() => readDwgSummary(new Uint8Array(0)))).toBe("empty");
    expect(reasonOf(() => readDwgSummary(dxfBytes({ entities: [line("EF", 0, 0, 1, 0)] })))).toBe("not_dwg");
    expect(reasonOf(() => readDwgSummary(new TextEncoder().encode("AC10")))).toBe("not_dwg");
  });

  it("takes the PNG preview as it is, before the bitmap", () => {
    const png = pngBytes(200);
    expect(readDwgSummary(dwgBytes({ images: [{ code: 1, bytes: filled(80, 3) }, { code: 6, bytes: png }] })).thumbnail).toEqual({ type: "image/png", bytes: png });
    expect(readDwgSummary(dwgBytes({ images: [{ code: 2, bytes: dibBytes(24) }, { code: 6, bytes: png }] })).thumbnail?.type).toBe("image/png");
  });

  it.each([
    ["24 bits", dibBytes(24), 54],
    ["256 colours", dibBytes(8), 14 + 40 + 1024],
    ["16 colours out of 256", dibBytes(8, 4, 4, 16), 14 + 40 + 64],
  ])("gives the bitmap preview the file header it lacks (%s)", (_, dib, pixels) => {
    const thumbnail = readDwgSummary(dwgBytes({ images: [{ code: 1, bytes: filled(80, 3) }, { code: 2, bytes: dib }] })).thumbnail;
    expect(thumbnail?.type).toBe("image/bmp");
    const bytes = thumbnail?.bytes ?? new Uint8Array(0);
    expect([bytes[0], bytes[1]]).toEqual([0x42, 0x4d]);
    expect(u32(bytes, 2)).toBe(14 + dib.length);
    expect(u32(bytes, 10)).toBe(pixels);
    expect(bytes.subarray(14)).toEqual(dib);
  });

  it("has no preview to show from a metafile, a foreign image or none", () => {
    expect(readDwgSummary(dwgBytes({ images: [{ code: 3, bytes: filled(120, 5) }] })).thumbnail).toBeNull();
    expect(readDwgSummary(dwgBytes({ images: [{ code: 6, bytes: filled(120, 5) }] })).thumbnail).toBeNull();
    expect(readDwgSummary(dwgBytes({ images: [{ code: 2, bytes: filled(30, 5) }] })).thumbnail).toBeNull();
    expect(readDwgSummary(dwgBytes({ images: [] })).thumbnail).toBeNull();
  });

  it("looks for the preview where it is when the header points elsewhere", () => {
    const png = pngBytes(64);
    expect(readDwgSummary(dwgBytes({ images: [{ code: 6, bytes: png }], address: 0, padding: 900 })).thumbnail?.bytes).toEqual(png);
    expect(readDwgSummary(dwgBytes({ images: [{ code: 6, bytes: png }], address: 0x7fffffff })).thumbnail?.bytes).toEqual(png);
  });

  it("gives up the preview of a cut file without failing", () => {
    const whole = dwgBytes({ images: [{ code: 6, bytes: pngBytes(400) }] });
    for (const cut of [0x90, 0xa0, whole.length - 300]) {
      expect(readDwgSummary(dwgBytes({ images: [{ code: 6, bytes: pngBytes(400) }], cut }))).toMatchObject({ version: { code: "AC1032" }, thumbnail: null });
    }
  });
});

describe("readRvtSummary", () => {
  const info2022 = "Worksharing: Not enabled\r\nUsername: jdupont\r\nCentral Model Path: \r\nFormat: 2022\r\nBuild: 20210224_1515(x64)\r\nLast Save Path: C:\\Users\\jdupont\\Maquette.rvt\r\n";
  const info2016 = "Worksharing: Not enabled\r\nUsername: jdupont\r\nRevit Build: Autodesk Revit 2016 (Build: 20150220_1215(x64))\r\nLast Save Path: C:\\Users\\jdupont\\Maquette.rvt\r\n";

  it("reads the release Revit wrote, whatever the alignment of its text", () => {
    for (const head of [14, 15]) {
      const summary = readRvtSummary(cfbBytes([{ name: "BasicFileInfo", bytes: basicFileInfo(info2022, head) }]));
      expect(summary).toEqual({ format: "rvt", version: { code: "2022", label: "Revit 2022" }, thumbnail: null });
    }
    expect(readRvtSummary(cfbBytes([{ name: "BasicFileInfo", bytes: basicFileInfo(info2016) }])).version).toEqual({ code: "2016", label: "Revit 2016" });
    expect(readRvtSummary(cfbBytes([{ name: "BasicFileInfo", bytes: basicFileInfo("Revit Build: Autodesk Revit Architecture 2012 (Build: x)\r\n") }], 12)).version?.code).toBe("2012");
  });

  it("returns neither the user name nor the paths the file carries", () => {
    const summary = readRvtSummary(cfbBytes([{ name: "BasicFileInfo", bytes: basicFileInfo(info2022) }, { name: "RevitPreview4.0", bytes: revitPreview(pngBytes(50)) }]));
    expect(JSON.stringify({ ...summary, thumbnail: null })).not.toMatch(/jdupont|Users|Maquette/);
    expect(Object.keys(summary).sort()).toEqual(["format", "thumbnail", "version"]);
  });

  it("cuts the preview out of its stream, to the end of the image", () => {
    const png = pngBytes(6000);
    const summary = readRvtSummary(cfbBytes([{ name: "BasicFileInfo", bytes: basicFileInfo(info2022) }, { name: "RevitPreview4.0", bytes: revitPreview(png, 300, 77) }], 12));
    expect(summary.thumbnail).toEqual({ type: "image/png", bytes: png });
  });

  it("says what it could not read rather than guess", () => {
    expect(readRvtSummary(cfbBytes([{ name: "Contents", bytes: filled(100, 3) }]))).toEqual({ format: "rvt", version: null, thumbnail: null });
    expect(readRvtSummary(cfbBytes([{ name: "BasicFileInfo", bytes: basicFileInfo("Worksharing: Not enabled\r\n") }, { name: "RevitPreview4.0", bytes: filled(500, 9) }]))).toEqual({ format: "rvt", version: null, thumbnail: null });
    expect(readRvtSummary(cfbBytes([]).slice(0, 10))).toEqual({ format: "rvt", version: null, thumbnail: null });
    const cutPreview = revitPreview(pngBytes(500)).slice(0, 600);
    expect(readRvtSummary(cfbBytes([{ name: "RevitPreview4.0", bytes: cutPreview }])).thumbnail).toBeNull();
  });

  it("refuses what is not a Revit container", () => {
    expect(reasonOf(() => readRvtSummary(new Uint8Array(0)))).toBe("empty");
    expect(reasonOf(() => readRvtSummary(dwgBytes()))).toBe("not_rvt");
  });
});

describe("readCadOriginal", () => {
  const refusal = (fileName: string, bytes: Uint8Array) => readCadOriginal(fileName, bytes).then(() => null, (error: unknown) => (error instanceof CadReadError ? error.reason : error));

  it("reads a DXF as a drawing and sums up a DWG or an RVT, by the extension of the file", async () => {
    const drawing = await readCadOriginal("Plan R+1.DXF", dxfBytes({ entities: [line("EF", 0, 0, 1000, 0)] }));
    expect(drawing.kind === "drawing" && drawing.drawing.paths.count).toBe(1);
    expect(drawing).not.toHaveProperty("source");
    expect(await readCadOriginal("reseaux.DWG", dwgBytes())).toEqual({ kind: "summary", summary: { format: "dwg", version: { code: "AC1032", label: "AutoCAD 2018" }, thumbnail: null } });
    expect(await readCadOriginal("maquette.rvt", cfbBytes([]))).toEqual({ kind: "summary", summary: { format: "rvt", version: null, thumbnail: null } });
  });

  it("sums up a FreeCAD document that has no sketch, with its objects", async () => {
    const original = await readCadOriginal("Chaufferie.FCStd", fcstd(documentXml(BOILER_ROOM)));
    expect(original).toMatchObject({ kind: "summary", summary: { format: "fcstd", version: { code: "1.0", label: "FreeCAD 1.0" }, thumbnail: null, model: { total: 4, sketches: 0, truncated: false } } });
  });

  it("draws the sketches of a FreeCAD document in millimetres, and keeps what the document says beside the drawing", async () => {
    const original = await readCadOriginal("chaufferie.fcstd", fcstd(documentXml(SKETCHED_ROOM), { "thumbnails/Thumbnail.png": PNG }));
    if (original.kind !== "drawing") throw new Error("drawing expected");
    expect(original.drawing.layers.map((layer) => layer.name)).toEqual(["0", "Local technique", "Réservations"]);
    expect(original.drawing.units.metresPerUnit).toBe(0.001);
    expect(original.drawing.paths.count).toBe(5);
    expect(original.source).toMatchObject({ format: "fcstd", version: { label: "FreeCAD 1.0" }, thumbnail: { type: "image/png", bytes: PNG }, model: { total: 6, sketches: 2 } });
  });

  it("sums up a FreeCAD document whose sketches make a drawing too heavy to read, and says they are not drawn", async () => {
    const original = await readCadOriginal("chaufferie.fcstd", fcstd(documentXml(SKETCHED_ROOM)), { limits: { maxBytes: 200 } });
    expect(original).toMatchObject({ kind: "summary", summary: { format: "fcstd", model: { total: 6, sketches: 0, truncated: true } } });
  });

  it("refuses a file whose content is not what its name says", async () => {
    expect(await refusal("plan.dwg", dxfBytes({}))).toBe("not_dwg");
    expect(await refusal("plan.dxf", dwgBytes())).toBe("not_dxf");
    expect(await refusal("plan.rvt", dwgBytes())).toBe("not_rvt");
    expect(await refusal("plan.fcstd", dwgBytes())).toBe("not_fcstd");
    expect(await refusal("plan.FCStd", new Uint8Array())).toBe("empty");
    expect(await refusal("plan.ifc", dwgBytes())).toBe("unsupported");
    expect(await refusal("plan.fcstd1", fcstd(documentXml(BOILER_ROOM)))).toBe("unsupported");
    expect(await refusal("plan", dwgBytes())).toBe("unsupported");
  });
});
