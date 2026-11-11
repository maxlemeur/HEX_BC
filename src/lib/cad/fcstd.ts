// A FreeCAD document (.FCStd) is a zip: « Document.xml » lists the objects with
// their properties, « thumbnails/Thumbnail.png » is the image FreeCAD left of
// the model, and the solids themselves are OpenCASCADE shapes that only a
// geometry kernel can read. What is read here needs none: the release, the
// image, the objects with the dimensions FreeCAD wrote for them, and the
// sketches, whose lines, circles and arcs are plain numbers. Lengths are in
// millimetres whatever the unit the author worked in: that is how FreeCAD saves.
// The document also names its author, his company and the paths of his machine:
// the properties of the document itself are never read.

import { CadReadError } from "./dxf";
import type { CadSummary } from "./summary";
import { isZip, openZip } from "./zip";

export type CadModelDimensionKind = "length" | "area" | "volume" | "angle";

/** In millimetres, mm², mm³ or degrees. */
export type CadModelDimension = { name: string; kind: CadModelDimensionKind; value: number };

export type CadModelObject = {
  name: string;
  label: string;
  /** What FreeCAD calls its type: « Part::Box », « Part::FeaturePython ». */
  type: string;
  /** What the object is for its author: its IFC type when it has one (« Wall », « Pipe Segment »), else its tool (« Wire »), else the end of its type (« Box »). */
  kind: string;
  dimensions: CadModelDimension[];
};

export type CadModel = {
  objects: CadModelObject[];
  /** Objects that have a shape; `objects` holds the first of them. */
  total: number;
  /** Sketches that are drawn. */
  sketches: number;
  /** The document holds more than is shown: objects past those `objects` lists, or what `left` tells. */
  truncated: boolean;
  /**
   * `sketches`: the sketches hold more elements than are read; `unread`: they hold elements of a kind that is not drawn
   * (ellipses, splines, arcs on the other face); `dimensions`: an object listed has more dimensions than it lists.
   */
  left: { sketches: boolean; unread: boolean; dimensions: boolean };
};

/** `maxNames`: the objects a document may name, listed or not; `maxObjects`: those that are listed. */
export type FcstdLimits = { maxDocumentBytes: number; maxNames: number; maxObjects: number; maxDimensions: number; maxGeometry: number };

export const FCSTD_LIMITS: FcstdLimits = { maxDocumentBytes: 64 * 1024 * 1024, maxNames: 100_000, maxObjects: 2000, maxDimensions: 16, maxGeometry: 200_000 };

export type FcstdRead = {
  summary: CadSummary & { format: "fcstd"; model: CadModel };
  /** The sketches as a DXF in millimetres, one layer a sketch, each in its own plane; null without a sketch. */
  sketchesDxf: string | null;
};

const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Maps, not objects: what is looked up comes from the file, which may name a type « constructor ».
const DIMENSION_KINDS = new Map<string, CadModelDimensionKind>([
  ["App::PropertyLength", "length"],
  ["App::PropertyDistance", "length"],
  ["App::PropertyArea", "area"],
  ["App::PropertyVolume", "volume"],
  ["App::PropertyAngle", "angle"],
]);
const SKETCH_COLORS = [5, 1, 3, 6, 4, 30];
const MAX_LAYER_NAME = 60;
/** A name, a label or a type listed on the screen is cut there. */
const MAX_TEXT = 200;
/** A document of FreeCAD is a dozen tags deep: past this the tags are counted, not kept. */
const MAX_DEPTH = 64;
const ENTITIES = new Map([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"]]);

type Attributes = Record<string, string>;

function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-z]{1,8});/g, (whole, body: string) => {
    if (body[0] !== "#") return ENTITIES.get(body) ?? whole;
    const code = body[1] === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

const isSpace = (code: number) => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;

/**
 * The attributes of a tag, read from one sign « = » to the next: each character is
 * looked at a bounded number of times, whatever the tag holds.
 */
function attributesOf(body: string): Attributes {
  const attributes: Attributes = Object.create(null);
  for (let at = 0; at < body.length;) {
    const sign = body.indexOf("=", at);
    if (sign < 0) break;
    // The name is the word that ends at the sign, the value the quoted text that follows it.
    let nameEnd = sign;
    while (nameEnd > at && isSpace(body.charCodeAt(nameEnd - 1))) nameEnd -= 1;
    let nameStart = nameEnd;
    for (; nameStart > at; nameStart -= 1) {
      const code = body.charCodeAt(nameStart - 1);
      if (isSpace(code) || code === 0x22 || code === 0x27 || code === 0x2f) break;
    }
    let open = sign + 1;
    while (open < body.length && isSpace(body.charCodeAt(open))) open += 1;
    const quote = body[open];
    if (quote !== "\"" && quote !== "'") {
      at = sign + 1;
      continue;
    }
    const close = body.indexOf(quote, open + 1);
    if (close < 0) break;
    if (nameEnd > nameStart) attributes[body.slice(nameStart, nameEnd)] = decodeEntities(body.slice(open + 1, close));
    at = close + 1;
  }
  return attributes;
}

/**
 * Walks the tags of an XML text in one pass, without building a tree: a
 * document of FreeCAD is tens of megabytes of properties of which a few are kept.
 * Text between the tags is not read: FreeCAD writes its values as attributes.
 */
function walkXml(text: string, visit: { open(name: string, attributes: () => Attributes): void; close(name: string): void }): void {
  for (let at = 0; ;) {
    const start = text.indexOf("<", at);
    if (start < 0) return;
    if (text.startsWith("<!--", start)) {
      const end = text.indexOf("-->", start + 4);
      if (end < 0) return;
      at = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", start)) {
      const end = text.indexOf("]]>", start + 9);
      if (end < 0) return;
      at = end + 3;
      continue;
    }
    // The tag ends at the first « > » that is not inside a quoted value.
    let end = start + 1;
    for (let quote = 0; end < text.length; end += 1) {
      const code = text.charCodeAt(end);
      if (quote !== 0) {
        if (code === quote) quote = 0;
      } else if (code === 0x22 || code === 0x27) quote = code;
      else if (code === 0x3e) break;
    }
    if (end >= text.length) return;
    at = end + 1;
    const first = text.charCodeAt(start + 1);
    // « <?xml … ?> » and « <!DOCTYPE … > » say nothing of the document.
    if (first === 0x3f || first === 0x21) continue;
    const closing = first === 0x2f, empty = text.charCodeAt(end - 1) === 0x2f;
    const body = text.slice(start + (closing ? 2 : 1), empty ? end - 1 : end);
    const name = /^[^\s/]+/.exec(body)?.[0];
    if (!name) continue;
    if (closing) {
      visit.close(name);
      continue;
    }
    visit.open(name, () => attributesOf(body.slice(name.length)));
    if (empty) visit.close(name);
  }
}

type Shape = { tag: string; attributes: Attributes };
/** `cut`: the object has more dimensions than `dimensions` holds. */
type Found = { name: string; type: string; label: string; ifc: string | null; tool: string | null; shaped: boolean; dimensions: CadModelDimension[]; cut: boolean; geometry: Shape[] };

/** « 1.0.2R39319 (Git) » is FreeCAD 1.0, « 0.21.2R33771 (Git) » FreeCAD 0.21. */
function freecadVersion(program: string | undefined): CadSummary["version"] {
  const release = /^\s*(\d{1,4}\.\d{1,4})(?!\d)/.exec(program ?? "")?.[1];
  return release ? { code: release, label: `FreeCAD ${release}` } : null;
}

/** `closed`: the document ends as it began; one that does not was cut on its way, or damaged. */
function readDocument(text: string, limits: FcstdLimits): { version: CadSummary["version"]; found: Found[]; left: number; closed: boolean } | null {
  const stack: string[] = [];
  const byName = new Map<string, Found>();
  // `deep`: tags open past the depth that is kept; `left`: the objects and the sketch elements the limits left out.
  let isDocument = false, closed = false, version: CadSummary["version"] = null, left = 0, kept = 0, deep = 0;
  let current: Found | null = null, property: { name: string; type: string } | null = null;
  let enumeration: { chosen: number; seen: number } | null = null;
  let geometry: { construction: boolean; shape: Shape | null } | null = null;

  /** Null once the document has named as many objects as are kept. */
  const object = (name: string): Found | null => {
    let entry = byName.get(name);
    if (entry) return entry;
    if (byName.size >= limits.maxNames) {
      left += 1;
      return null;
    }
    byName.set(name, (entry = { name, type: "", label: "", ifc: null, tool: null, shaped: false, dimensions: [], cut: false, geometry: [] }));
    return entry;
  };

  walkXml(text, {
    open(name, attributes) {
      if (deep > 0 || stack.length >= MAX_DEPTH) {
        deep += 1;
        return;
      }
      const parent = stack[stack.length - 1];
      stack.push(name);
      if (stack.length === 1) {
        if (name !== "Document") return;
        const values = attributes();
        isDocument = values.SchemaVersion !== undefined || values.ProgramVersion !== undefined;
        version = freecadVersion(values.ProgramVersion);
        return;
      }
      if (!isDocument) return;
      if (name === "Object" && stack.length === 3) {
        const values = attributes();
        if (typeof values.name !== "string" || values.name === "") return;
        if (parent === "Objects") {
          const entry = object(values.name);
          if (entry) entry.type = values.type ?? "";
        } else if (parent === "ObjectData") current = object(values.name);
        return;
      }
      if (!current) return;
      // The properties of the object itself: those of its extensions sit deeper.
      if (name === "Property" && stack.length === 5 && parent === "Properties") {
        const values = attributes();
        property = { name: values.name ?? "", type: values.type ?? "" };
        if (property.type === "Part::PropertyPartShape") current.shaped = true;
        return;
      }
      if (!property) return;
      if (geometry) {
        if (name === "Construction") geometry.construction ||= attributes().value === "1";
        else if (name === "GeoExtension") geometry.construction ||= /1.$/.test(attributes().geometryModeFlags ?? "");
        else if (name !== "GeoExtensions" && !geometry.shape) geometry.shape = { tag: name, attributes: attributes() };
        return;
      }
      if (name === "Geometry" && property.name === "Geometry" && property.type === "Part::PropertyGeometryList") geometry = { construction: false, shape: null };
      else if (name === "String" && property.name === "Label") current.label = attributes().value ?? "";
      else if (name === "Python" && property.name === "Proxy") current.tool = (attributes().class ?? "").replace(/^_+/, "") || null;
      else if (name === "Integer" && property.name === "IfcType") {
        const chosen = Number(attributes().value);
        enumeration = Number.isInteger(chosen) && chosen >= 0 ? { chosen, seen: 0 } : null;
      } else if (name === "Enum" && enumeration) {
        // « Undefined » is FreeCAD's word for an object its author gave no IFC type.
        if (enumeration.seen === enumeration.chosen) current.ifc = (attributes().value ?? "").replace(/^Undefined$/, "") || null;
        enumeration.seen += 1;
      } else if (name === "Float") {
        const kind = DIMENSION_KINDS.get(property.type), value = Number(attributes().value);
        // A dimension left at zero says nothing of the object.
        if (kind && Number.isFinite(value) && value !== 0) {
          if (current.dimensions.length < limits.maxDimensions) current.dimensions.push({ name: listed(property.name), kind, value });
          else current.cut = true;
        }
      }
    },
    close(name) {
      if (deep > 0) {
        deep -= 1;
        return;
      }
      // A closing tag that does not match the open one is passed over: the walk stays where it was.
      if (stack[stack.length - 1] !== name) return;
      stack.pop();
      if (stack.length === 0) closed = isDocument;
      if (name === "Geometry" && geometry && current) {
        if (!geometry.construction && geometry.shape) {
          if (kept < limits.maxGeometry) {
            current.geometry.push(geometry.shape);
            kept += 1;
          } else left += 1;
        }
        geometry = null;
      } else if (name === "Property" && stack.length === 4) {
        property = null;
        enumeration = null;
        geometry = null;
      } else if (name === "Object" && stack.length === 2) current = null;
    },
  });
  return isDocument ? { version, found: [...byName.values()], left, closed } : null;
}

const real = (value: number) => (Number.isFinite(value) ? String(Number(value.toPrecision(15))) : "0");
/** A name on one line: a line break in it would pass for the next code of the DXF. */
const oneLine = (value: string) => value.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").trim();
const degrees = (radians: number) => (radians * 180) / Math.PI;
/** A text of the file as it is listed: on one line, and no longer than a line is read. */
function listed(value: string): string {
  return oneLine(value).slice(0, MAX_TEXT).trim();
}

function sketchesToDxf(found: Found[]): { dxf: string | null; sketches: number; unread: number } {
  const sketches = found.filter((entry) => entry.geometry.length > 0);
  const pairs: string[] = [];
  const put = (code: number, value: string | number) => pairs.push(String(code), String(value));
  // The reader of the DXF tells layers apart whatever their case, and has its own layer « 0 ».
  const used = new Set(["0"]), copies = new Map<string, number>();
  const layers = sketches.map((sketch) => {
    // Every element of a sketch repeats the name of its layer: a label of any length would be written as many times.
    const wanted = (oneLine(sketch.label) || oneLine(sketch.name)).slice(0, MAX_LAYER_NAME).trim() || "Esquisse", key = wanted.toUpperCase();
    // Two sketches of the same label stay two layers; the count goes on from the last copy, not from the first.
    let layer = wanted;
    for (let copy = copies.get(key) ?? 1; used.has(layer.toUpperCase());) {
      copy += 1;
      copies.set(key, copy);
      layer = `${wanted} (${copy})`;
    }
    used.add(layer.toUpperCase());
    return layer;
  });

  put(0, "SECTION"); put(2, "HEADER");
  put(9, "$ACADVER"); put(1, "AC1015");
  put(9, "$INSUNITS"); put(70, 4);
  put(0, "ENDSEC");
  put(0, "SECTION"); put(2, "TABLES"); put(0, "TABLE"); put(2, "LAYER"); put(70, layers.length);
  layers.forEach((layer, index) => {
    put(0, "LAYER"); put(2, layer); put(70, 0); put(62, SKETCH_COLORS[index % SKETCH_COLORS.length]);
  });
  put(0, "ENDTAB"); put(0, "ENDSEC");
  put(0, "SECTION"); put(2, "ENTITIES");
  let drawn = 0, unread = 0;
  sketches.forEach((sketch, index) => {
    for (const { tag, attributes } of sketch.geometry) {
      const value = (name: string) => Number(attributes[name]);
      const numbers = (...names: string[]) => names.every((name) => Number.isFinite(value(name)));
      // A curve drawn on the other face of its plane turns the other way: it is listed as not read instead of guessed.
      const faceUp = !(value("NormalZ") < 0);
      if (tag === "LineSegment" && numbers("StartX", "StartY", "EndX", "EndY")) {
        put(0, "LINE"); put(8, layers[index]);
        put(10, real(value("StartX"))); put(20, real(value("StartY"))); put(11, real(value("EndX"))); put(21, real(value("EndY")));
        drawn += 1;
      } else if (tag === "Circle" && numbers("CenterX", "CenterY", "Radius") && value("Radius") > 0) {
        put(0, "CIRCLE"); put(8, layers[index]);
        put(10, real(value("CenterX"))); put(20, real(value("CenterY"))); put(40, real(value("Radius")));
        drawn += 1;
      } else if (tag === "ArcOfCircle" && faceUp && numbers("CenterX", "CenterY", "Radius", "StartAngle", "EndAngle") && value("Radius") > 0) {
        // FreeCAD keeps the angles in radians from an axis it may have turned; a DXF wants degrees from the x axis.
        const turned = Number.isFinite(value("AngleXU")) ? value("AngleXU") : 0;
        put(0, "ARC"); put(8, layers[index]);
        put(10, real(value("CenterX"))); put(20, real(value("CenterY"))); put(40, real(value("Radius")));
        put(50, real(degrees(value("StartAngle") + turned))); put(51, real(degrees(value("EndAngle") + turned)));
        drawn += 1;
      } else if (tag !== "GeomPoint" && tag !== "Point") {
        // Ellipses, splines and the rest: counted, and named so that the drawing says what it does not show. A point draws nothing.
        unread += 1;
        if (/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(tag)) { put(0, `${tag.toUpperCase()}_NON_LU`); put(8, layers[index]); }
      }
    }
  });
  put(0, "ENDSEC"); put(0, "EOF");
  // Sketches of which nothing is drawn make no drawing: the model is then summed up.
  return drawn === 0 ? { dxf: null, sketches: 0, unread } : { dxf: `${pairs.join("\n")}\n`, sketches: sketches.length, unread };
}

function kindOf(entry: Found): string {
  return entry.ifc ?? entry.tool ?? (entry.type.split("::").pop() || entry.type || "Objet");
}

export async function readFcstd(bytes: Uint8Array, options: { limits?: Partial<FcstdLimits> } = {}): Promise<FcstdRead> {
  const limits = { ...FCSTD_LIMITS, ...options.limits };
  if (bytes.length === 0) throw new CadReadError("empty");
  const zip = isZip(bytes) ? openZip(bytes) : null;
  if (!zip || !zip.names.includes("Document.xml")) throw new CadReadError("not_fcstd");
  const xml = await zip.read("Document.xml", limits.maxDocumentBytes);
  // The archive names a document that it does not give back as it was saved.
  if (!xml) throw new CadReadError((zip.size("Document.xml") ?? 0) > limits.maxDocumentBytes ? "model_too_large" : "damaged_fcstd");
  const document = readDocument(new TextDecoder("utf-8").decode(xml), limits);
  if (!document) throw new CadReadError("not_fcstd");
  // What there is of a document cut on its way is not read: half a model would be listed and measured as a whole one.
  if (!document.closed) throw new CadReadError("damaged_fcstd");

  const image = await zip.read("thumbnails/Thumbnail.png", MAX_THUMBNAIL_BYTES);
  const thumbnail = image && PNG_SIGNATURE.every((value, index) => image[index] === value) ? { type: "image/png" as const, bytes: image } : null;
  const shaped = document.found.filter((entry) => entry.shaped);
  const { dxf, sketches, unread } = sketchesToDxf(document.found);
  const kept = shaped.slice(0, limits.maxObjects);
  const objects = kept.map((entry) => ({
    name: listed(entry.name), label: listed(entry.label) || listed(entry.name), type: listed(entry.type), kind: listed(kindOf(entry)), dimensions: entry.dimensions,
  }));
  // What the limits left out of the document may be elements of a sketch, or a sketch whole: the drawing is then not all of it.
  // Nor is it when a sketch holds an element that is not drawn.
  const left = { sketches: document.left > 0, unread: unread > 0, dimensions: kept.some((entry) => entry.cut) };
  return {
    summary: { format: "fcstd", version: document.version, thumbnail, model: { objects, total: shaped.length, sketches, truncated: shaped.length > objects.length || left.sketches || left.unread || left.dimensions, left } },
    sketchesDxf: dxf,
  };
}
