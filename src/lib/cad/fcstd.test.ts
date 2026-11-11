import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { CadReadError, readDxf } from "./dxf";
import { readFcstd } from "./fcstd";
import { BOILER_ROOM, PNG, SKETCHED_ROOM, documentXml, element, fcstd, float, geometry, label, segment, shape, type FcstdEntry } from "./fcstd.test-utils";
import { measureCadDrawing } from "./quantities";

describe("FreeCAD documents", () => {
  it("says the release, shows the image and lists the objects that have a shape with their dimensions", async () => {
    const { summary, sketchesDxf } = await readFcstd(fcstd(documentXml(BOILER_ROOM), { "thumbnails/Thumbnail.png": PNG }));
    expect(summary.format).toBe("fcstd");
    expect(summary.version).toEqual({ code: "1.0", label: "FreeCAD 1.0" });
    expect(summary.thumbnail).toEqual({ type: "image/png", bytes: PNG });
    expect(sketchesDxf).toBeNull();
    expect(summary.model).toEqual({
      total: 4,
      sketches: 0,
      truncated: false,
      left: { sketches: false, unread: false, dimensions: false },
      objects: [
        { name: "Box", label: "Ballon & socle", type: "Part::Box", kind: "Box", dimensions: [{ name: "Length", kind: "length", value: 800 }, { name: "Width", kind: "length", value: 600 }, { name: "Height", kind: "length", value: 1900 }] },
        { name: "Pipe", label: "Départ chauffage", type: "Part::FeaturePython", kind: "Pipe Segment", dimensions: [{ name: "Diameter", kind: "length", value: 33.7 }, { name: "Length", kind: "length", value: 4250.5 }] },
        { name: "Wall", label: "Mur étanche", type: "Part::FeaturePython", kind: "Wall", dimensions: [{ name: "HorizontalArea", kind: "area", value: 1.2e6 }, { name: "Volume", kind: "volume", value: 3e9 }, { name: "Angle", kind: "angle", value: 90 }] },
        { name: "Wire", label: "Tracé", type: "Part::Part2DObjectPython", kind: "Wire", dimensions: [] },
      ],
    });
  });

  it("reads nothing of the document's own properties: author, company, paths", async () => {
    const read = await readFcstd(fcstd(documentXml(BOILER_ROOM)));
    const said = JSON.stringify(read);
    for (const secret of ["Camille", "Imaginaire", "secret", "987654"]) expect(said).not.toContain(secret);
    expect(read.summary.thumbnail).toBeNull();
  });

  it("names the release of older and newer FreeCAD, or none when the document does not say", async () => {
    expect((await readFcstd(fcstd(documentXml([], "0.21.2R33771 (Git)")))).summary.version).toEqual({ code: "0.21", label: "FreeCAD 0.21" });
    expect((await readFcstd(fcstd(documentXml([], "26.3R48259 (Git)")))).summary.version).toEqual({ code: "26.3", label: "FreeCAD 26.3" });
    expect((await readFcstd(fcstd(documentXml([], "inconnue")))).summary.version).toBeNull();
  });

  it("draws the sketches as a DXF in millimetres, one layer a sketch, without their construction lines", async () => {
    const quarter = element("ArcOfCircle", `<ArcOfCircle CenterX="0" CenterY="0" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" AngleXU="0" Radius="1000" StartAngle="0" EndAngle="${Math.PI / 2}"/>`);
    const turned = element("ArcOfCircle", `<ArcOfCircle CenterX="0" CenterY="0" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" AngleXU="${Math.PI / 2}" Radius="1000" StartAngle="0" EndAngle="${Math.PI}"/>`);
    const entries: FcstdEntry[] = [
      { type: "Sketcher::SketchObject", name: "Sketch", properties: [label("Local technique"), shape("Sketch"), geometry("Geometry", [segment(0, 0, 4000, 0), segment(4000, 0, 4000, 2000), segment(4000, 2000, 0, 2000), segment(0, 2000, 0, 0), segment(0, 0, 4000, 2000, true)]), geometry("ExternalGeo", [segment(0, 0, 99999, 0)])] },
      { type: "Sketcher::SketchObject", name: "Sketch001", properties: [label("Réservations"), shape("Sketch001"), geometry("Geometry", [
        element("Circle", `<Circle CenterX="500" CenterY="500" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" AngleXU="0" Radius="250"/>`), quarter, turned,
        element("Point", `<GeomPoint X="1" Y="2" Z="0"/>`),
        element("Ellipse", `<Ellipse CenterX="0" CenterY="0" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" MajorRadius="20" MinorRadius="10" AngleXU="0"/>`),
        element("ArcOfCircle", `<ArcOfCircle CenterX="0" CenterY="0" CenterZ="0" NormalX="0" NormalY="0" NormalZ="-1" AngleXU="0" Radius="10" StartAngle="0" EndAngle="1"/>`),
      ])] },
    ];
    const { summary, sketchesDxf } = await readFcstd(fcstd(documentXml(entries)));
    // An ellipse and an arc on the other face are not drawn: the model says that its sketches hold more than the drawing shows.
    expect(summary.model).toMatchObject({ total: 2, sketches: 2, truncated: true, left: { sketches: false, unread: true, dimensions: false } });
    const drawing = readDxf(strToU8(sketchesDxf!));
    expect(drawing.units.metresPerUnit).toBe(0.001);
    // The reader always knows layer « 0 »: no sketch is drawn on it.
    expect(drawing.layers.map((layer) => layer.name)).toEqual(["0", "Local technique", "Réservations"]);
    expect(drawing.unsupported).toEqual([{ type: "ARCOFCIRCLE_NON_LU", count: 1 }, { type: "ELLIPSE_NON_LU", count: 1 }]);
    const quantities = measureCadDrawing(drawing);
    const room = quantities.layers.find((row) => row.name === "Local technique")!, holes = quantities.layers.find((row) => row.name === "Réservations")!;
    // Four walls of 4 m and 2 m; a circle of 250 mm, a quarter and a half of a circle of 1 m.
    expect(room.length).toBeCloseTo(12, 9);
    expect(holes.length).toBeCloseTo((2 * Math.PI * 250 + (Math.PI / 2) * 1000 + Math.PI * 1000) / 1000, 6);
    // The arc whose axis is turned by a quarter runs from 90° to 270°: it reaches x = -1000 and never x = +1000.
    expect(drawing.extents!.x0).toBeCloseTo(-1000, 6);
    expect(drawing.extents!.x1).toBeCloseTo(4000, 6);
  });

  it("keeps two sketches of the same label apart and a hostile label on its line", async () => {
    const entries: FcstdEntry[] = [
      { type: "Sketcher::SketchObject", name: "Sketch", properties: [label("Plan"), geometry("Geometry", [segment(0, 0, 10, 0)])] },
      { type: "Sketcher::SketchObject", name: "Sketch001", properties: [label("Plan"), geometry("Geometry", [segment(0, 0, 0, 10)])] },
      { type: "Sketcher::SketchObject", name: "Sketch002", properties: [label("A&#10;0&#10;SECTION&#10;2&#10;ENTITIES"), geometry("Geometry", [segment(0, 0, 5, 5)])] },
    ];
    const drawing = readDxf(strToU8((await readFcstd(fcstd(documentXml(entries)))).sketchesDxf!));
    expect(drawing.layers.map((layer) => layer.name)).toEqual(["0", "Plan", "Plan (2)", "A 0 SECTION 2 ENTITIES"]);
    expect(drawing.paths.count).toBe(3);
    expect(drawing.unsupported).toEqual([]);
  });

  it("cuts a label too long to name a layer, and still keeps two such sketches apart", async () => {
    const long = "Réseau ".repeat(100);
    const entries: FcstdEntry[] = [
      { type: "Sketcher::SketchObject", name: "Sketch", properties: [label(long), geometry("Geometry", [segment(0, 0, 10, 0)])] },
      { type: "Sketcher::SketchObject", name: "Sketch001", properties: [label(long), geometry("Geometry", [segment(0, 0, 0, 10)])] },
    ];
    const names = readDxf(strToU8((await readFcstd(fcstd(documentXml(entries)))).sketchesDxf!)).layers.map((layer) => layer.name);
    expect(names).toHaveLength(3);
    expect(names[1]).toBe(long.slice(0, 60).trim());
    expect(names[2]).toBe(`${names[1]} (2)`);
  });

  it("is not fooled by a type, an entity or an attribute named like a property of Object", async () => {
    const hostile = (type: string) => `<Property name="Length" type="${type}" status="1"><Float value="12"/></Property>`;
    const entries: FcstdEntry[] = [{
      type: "constructor", name: "__proto__",
      properties: [label("&constructor; &toString; &amp;"), hostile("constructor"), hostile("__proto__"), hostile("toString"), `<Property name="Shape" type="Part::PropertyPartShape" __proto__="x" constructor="y"><Part file="a.brp"/></Property>`, float("Width", "Length", 5)],
    }];
    const { summary } = await readFcstd(fcstd(documentXml(entries)));
    expect(summary.model.objects).toEqual([{ name: "__proto__", label: "&constructor; &toString; &", type: "constructor", kind: "constructor", dimensions: [{ name: "Width", kind: "length", value: 5 }] }]);
    // What is read goes from the worker to the page: it must hold nothing a message cannot carry.
    expect(structuredClone(summary.model)).toEqual(summary.model);
  });

  it("cuts the texts too long to be listed, and a release too long to be one", async () => {
    const long = "Très long ".repeat(1000);
    const entries: FcstdEntry[] = [{ type: `Part::${"T".repeat(5000)}`, name: "N".repeat(5000), properties: [label(long), float("D".repeat(5000), "Length", 5), shape("Box")] }];
    const { summary } = await readFcstd(fcstd(documentXml(entries, `${"9".repeat(5000)}.1`)));
    const [listed] = summary.model.objects;
    expect(listed.label).toBe(long.slice(0, 200).trim());
    expect([listed.name.length, listed.type.length, listed.kind.length, listed.dimensions[0].name.length]).toEqual([200, 200, 200, 200]);
    expect(summary.version).toBeNull();
  });

  it("keeps apart sketches whose labels differ by their case only, and keeps layer « 0 » free", async () => {
    const entries: FcstdEntry[] = [
      { type: "Sketcher::SketchObject", name: "Sketch", properties: [label("Plan RDC"), geometry("Geometry", [segment(0, 0, 1000, 0)])] },
      { type: "Sketcher::SketchObject", name: "Sketch001", properties: [label("PLAN RDC"), geometry("Geometry", [segment(0, 0, 3000, 0)])] },
      { type: "Sketcher::SketchObject", name: "Sketch002", properties: [label("0"), geometry("Geometry", [segment(0, 0, 5000, 0)])] },
    ];
    const drawing = readDxf(strToU8((await readFcstd(fcstd(documentXml(entries)))).sketchesDxf!));
    expect(drawing.layers.map((layer) => layer.name)).toEqual(["0", "Plan RDC", "PLAN RDC (2)", "0 (2)"]);
    const lengths = Object.fromEntries(measureCadDrawing(drawing).layers.map((row) => [row.name, row.length]));
    expect(lengths).toEqual({ "Plan RDC": 1, "PLAN RDC (2)": 3, "0 (2)": 5 });
  });

  it("names thousands of sketches of one label without slowing down", async () => {
    const entries = Array.from({ length: 20_000 }, (_, index): FcstdEntry => ({ type: "Sketcher::SketchObject", name: `Sketch${index}`, properties: [label("Plan"), geometry("Geometry", [segment(0, 0, 10, 0)])] }));
    const archive = fcstd(documentXml(entries));
    const started = performance.now();
    const { summary, sketchesDxf } = await readFcstd(archive);
    // Naming each sketch after trying every name already taken took 26 s here; it takes a fraction of a second.
    expect(performance.now() - started).toBeLessThan(5000);
    expect(summary.model.sketches).toBe(20_000);
    expect(sketchesDxf).toContain("\nPlan (20000)\n");
  });

  it("reads a tag that holds a long run of text without a sign in a time that follows its length", async () => {
    const junk = "a".repeat(400_000);
    const xml = documentXml(BOILER_ROOM).replace(`<Document SchemaVersion="4"`, `<Document ${junk} SchemaVersion="4" ${junk}`);
    const archive = fcstd(xml), started = performance.now();
    const { summary } = await readFcstd(archive);
    // Looking for a name from every character of the run took two and a half minutes here.
    expect(performance.now() - started).toBeLessThan(5000);
    expect(summary).toMatchObject({ version: { label: "FreeCAD 1.0" }, model: { total: 4 } });
  });

  it("reads attributes written with single quotes, spaces around the sign, or a quote inside the value", async () => {
    const xml = documentXml([{ type: "Part::Box", name: "Box", properties: [`<Property name = 'Label' type="App::PropertyString"><String value = "L'atelier &quot;nord&quot; a=b"/></Property>`, shape("Box")] }]);
    expect((await readFcstd(fcstd(xml))).summary.model.objects[0].label).toBe("L'atelier \"nord\" a=b");
  });

  it("does not keep more names than its limit, nor go deeper than a document does", async () => {
    const many = Array.from({ length: 50 }, (_, index): FcstdEntry => ({ type: "Part::Box", name: `Box${index}`, properties: [label(`Caisse ${index}`), shape("Box")] }));
    const capped = (await readFcstd(fcstd(documentXml(many)), { limits: { maxNames: 20 } })).summary.model;
    expect(capped).toMatchObject({ total: 20, truncated: true });
    expect(capped.objects.map((entry) => entry.name)).toEqual(many.slice(0, 20).map((entry) => entry.name));

    // A hundred thousand tags opened one inside the other, then a real document's content: nothing of it is at its place, nothing is listed.
    const deep = `<Document SchemaVersion="4">${"<a>".repeat(100_000)}<Objects><Object type="Part::Box" name="Box"/></Objects>${"</a>".repeat(100_000)}</Document>`;
    expect((await readFcstd(fcstd(deep))).summary.model).toMatchObject({ total: 0, objects: [] });
  });

  it("sums up a model whose sketches hold nothing it can draw", async () => {
    const entries: FcstdEntry[] = [
      ...BOILER_ROOM,
      { type: "Sketcher::SketchObject", name: "Sketch", properties: [label("Ovale"), shape("Sketch"), geometry("Geometry", [
        element("Ellipse", `<Ellipse CenterX="0" CenterY="0" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" MajorRadius="20" MinorRadius="10" AngleXU="0"/>`),
        element("Point", `<GeomPoint X="1" Y="2" Z="0"/>`),
      ])] },
    ];
    const { summary, sketchesDxf } = await readFcstd(fcstd(documentXml(entries)));
    expect(sketchesDxf).toBeNull();
    expect(summary.model).toMatchObject({ total: 5, sketches: 0, truncated: true, left: { sketches: false, unread: true, dimensions: false } });

    // A point draws nothing and leaves nothing out; a construction line is not part of the drawing either.
    const plain: FcstdEntry[] = [{ type: "Sketcher::SketchObject", name: "Sketch", properties: [label("Local"), shape("Sketch"), geometry("Geometry", [
      segment(0, 0, 4000, 0), segment(0, 0, 4000, 2000, true), element("Point", `<GeomPoint X="1" Y="2" Z="0"/>`),
    ])] }];
    expect((await readFcstd(fcstd(documentXml(plain)))).summary.model).toMatchObject({ sketches: 1, truncated: false, left: { sketches: false, unread: false, dimensions: false } });
  });

  it("says when it lists or draws less than the document holds", async () => {
    const many = Array.from({ length: 5 }, (_, index): FcstdEntry => ({ type: "Part::Box", name: `Box${index}`, properties: [label(`Caisse ${index}`), float("Length", "Length", 10), float("Width", "Length", 20), float("Height", "Length", 30), shape("Box")] }));
    const listed = (await readFcstd(fcstd(documentXml(many)), { limits: { maxObjects: 3, maxDimensions: 2 } })).summary.model;
    expect(listed).toMatchObject({ total: 5, truncated: true });
    expect(listed.objects.map((entry) => [entry.name, entry.dimensions.length])).toEqual([["Box0", 2], ["Box1", 2], ["Box2", 2]]);

    const sketch: FcstdEntry[] = [{ type: "Sketcher::SketchObject", name: "Sketch", properties: [label("Plan"), geometry("Geometry", [segment(0, 0, 10, 0), segment(10, 0, 10, 10), segment(10, 10, 0, 10)])] }];
    const drawn = await readFcstd(fcstd(documentXml(sketch)), { limits: { maxGeometry: 2 } });
    expect(drawn.summary.model).toMatchObject({ truncated: true, left: { sketches: true, dimensions: false } });
    expect(readDxf(strToU8(drawn.sketchesDxf!)).paths.count).toBe(2);
  });

  it("says when an object has more dimensions than it lists, and only then", async () => {
    const box = (name: string, shaped = true): FcstdEntry => ({ type: "Part::Box", name, properties: [label(name), float("Length", "Length", 10), float("Width", "Length", 20), float("Height", "Length", 30), ...(shaped ? [shape(name)] : [])] });
    const whole = (await readFcstd(fcstd(documentXml([box("Box")])), { limits: { maxDimensions: 3 } })).summary.model;
    expect(whole).toMatchObject({ total: 1, truncated: false, left: { sketches: false, unread: false, dimensions: false } });

    const cut = (await readFcstd(fcstd(documentXml([box("Box")])), { limits: { maxDimensions: 2 } })).summary.model;
    expect(cut.objects[0].dimensions).toHaveLength(2);
    expect(cut).toMatchObject({ total: 1, truncated: true, left: { sketches: false, dimensions: true } });

    // A dimension left at zero is not one that was left out.
    const zero: FcstdEntry = { type: "Part::Box", name: "Box", properties: [label("Box"), float("Length", "Length", 10), float("Width", "Length", 20), float("Height", "Length", 0), shape("Box")] };
    expect((await readFcstd(fcstd(documentXml([zero])), { limits: { maxDimensions: 2 } })).summary.model).toMatchObject({ truncated: false, left: { dimensions: false } });

    // Nor does an object that is not listed, having no shape, make the list incomplete.
    const unlisted = (await readFcstd(fcstd(documentXml([box("Sans forme", false), zero])), { limits: { maxDimensions: 2 } })).summary.model;
    expect(unlisted).toMatchObject({ total: 1, truncated: false, left: { dimensions: false } });
  });

  it("refuses what is not a FreeCAD document", async () => {
    const reason = (bytes: Uint8Array, limits = {}) => readFcstd(bytes, { limits }).then(() => "read", (error: unknown) => (error instanceof CadReadError ? error.reason : String(error)));
    expect(await reason(new Uint8Array())).toBe("empty");
    expect(await reason(strToU8("0\nSECTION\n2\nHEADER\n"))).toBe("not_fcstd");
    expect(await reason(zipSync({ "word/document.xml": strToU8("<w:document/>") }))).toBe("not_fcstd");
    expect(await reason(fcstd(`<?xml version="1.0"?><svg><Objects><Object type="Part::Box" name="Box"/></Objects></svg>`))).toBe("not_fcstd");
    expect(await reason(fcstd("ni balise ni document"))).toBe("not_fcstd");
    expect(await reason(fcstd(documentXml(BOILER_ROOM)), { maxDocumentBytes: 100 })).toBe("model_too_large");
    const damaged = fcstd(documentXml(BOILER_ROOM));
    damaged.fill(0xff, 50, 90);
    expect(await reason(damaged)).toBe("damaged_fcstd");
  });

  it("says of a document cut before its end, or whose tags do not match, that it is damaged: half a model is not read as a whole one", async () => {
    const reason = (bytes: Uint8Array) => readFcstd(bytes).then(() => "read", (error: unknown) => (error instanceof CadReadError ? error.reason : String(error)));
    const xml = documentXml(SKETCHED_ROOM);
    // Cut among its objects, in the middle of a sketch, in a tag, in a comment; and a tag that is closed by another.
    for (const cut of [xml.slice(0, xml.indexOf("<ObjectData") + 200), xml.slice(0, xml.indexOf("Réservations")), `${xml.slice(0, -12)}<Object name="x`, xml.replace("<ObjectData", "<!-- sans fin <ObjectData"), xml.replace("</Properties></Object>", "</Object>")]) {
      expect(await reason(fcstd(cut))).toBe("damaged_fcstd");
    }
    // What follows the end of the document takes nothing from it.
    expect((await readFcstd(fcstd(`${xml}\n<!-- fin -->\n`))).summary.model).toMatchObject({ total: 6, sketches: 2, truncated: false });

    // The document whole, in an archive that says its bytes are not the ones that were saved.
    const stale = fcstd(xml);
    const view = new DataView(stale.buffer, stale.byteOffset, stale.byteLength);
    for (let entry = 0; entry + 4 <= stale.length; entry += 1) if (view.getUint32(entry, true) === 0x02014b50) view.setUint32(entry + 16, view.getUint32(entry + 16, true) ^ 1, true);
    expect(await reason(stale)).toBe("damaged_fcstd");
  });

  it("is not fooled by a thumbnail that is not an image", async () => {
    expect((await readFcstd(fcstd(documentXml([]), { "thumbnails/Thumbnail.png": strToU8("<script>") }))).summary.thumbnail).toBeNull();
  });
});
