import { strToU8, zipSync } from "fflate";

// Hand-written documents in the shape FreeCAD saves: a fictional boiler room, no real file.
/** The first bytes of a PNG, which is all the reader checks of the image. */
export const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3);
export const property = (name: string, type: string, inner: string) => `<Property name="${name}" type="${type}" status="1">\n${inner}\n</Property>`;
export const label = (value: string) => property("Label", "App::PropertyString", `<String value="${value}"/>`);
export const float = (name: string, type: string, value: number) => property(name, `App::Property${type}`, `<Float value="${value.toFixed(16)}"/>`);
export const shape = (name: string) => property("Shape", "Part::PropertyPartShape", `<Part file="${name}.Shape.brp"/>`);
export const ifcType = (chosen: number) => property("IfcType", "App::PropertyEnumeration", `<Integer value="${chosen}" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Pipe Fitting"/><Enum value="Pipe Segment"/><Enum value="Wall"/><Enum value="Undefined"/></CustomEnumList>`);
export const tool = (module: string, name: string) => property("Proxy", "App::PropertyPythonObject", `<Python value="e30=" encoded="yes" module="${module}" class="${name}"/>`);
export const element = (type: string, inner: string, construction = false) =>
  `<Geometry type="Part::Geom${type}" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="000000000000000000000000000000${construction ? "1" : "0"}0" geometryLayer="0"/></GeoExtensions>${inner}<Construction value="${construction ? 1 : 0}"/></Geometry>`;
export const segment = (x0: number, y0: number, x1: number, y1: number, construction = false) =>
  element("LineSegment", `<LineSegment StartX="${x0}" StartY="${y0}" StartZ="0" EndX="${x1}" EndY="${y1}" EndZ="0"/>`, construction);
export const geometry = (name: string, elements: string[]) => property(name, "Part::PropertyGeometryList", `<GeometryList count="${elements.length}">${elements.join("")}</GeometryList>`);

export type FcstdEntry = { type: string; name: string; properties: string[] };

export function documentXml(entries: FcstdEntry[], version = "1.0.2R39319 (Git)"): string {
  return [
    `<?xml version='1.0' encoding='utf-8'?>`,
    `<!-- FreeCAD Document, see https://www.freecad.org for more information... -->`,
    `<Document SchemaVersion="4" ProgramVersion="${version}" FileVersion="1">`,
    `<Properties Count="4">${[
      property("CreatedBy", "App::PropertyString", `<String value="Camille Fictif"/>`),
      property("Company", "App::PropertyString", `<String value="Plomberie Imaginaire"/>`),
      property("FileName", "App::PropertyString", `<String value="/home/camille/secret/chaufferie.FCStd"/>`),
      float("Length", "Length", 987654),
    ].join("")}</Properties>`,
    `<Objects Count="${entries.length}">${entries.map((entry, index) => `<Object type="${entry.type}" name="${entry.name}" id="${index + 1}" />`).join("")}</Objects>`,
    `<ObjectData Count="${entries.length}">${entries
      .map((entry) => `<Object name="${entry.name}" Extensions="True"><Extensions Count="1"><Extension type="Part::AttachExtension" name="AttachExtension"></Extension></Extensions><Properties Count="${entry.properties.length}">${entry.properties.join("")}</Properties></Object>`)
      .join("")}</ObjectData>`,
    `</Document>`,
  ].join("\n");
}

/** The archive FreeCAD would save around that document, with whatever else is put beside it. */
export const fcstd = (xml: string, more: Record<string, Uint8Array> = {}) => zipSync({ "Document.xml": strToU8(xml), "GuiDocument.xml": strToU8("<Document/>"), ...more });

export const BOILER_ROOM: FcstdEntry[] = [
  { type: "Part::Box", name: "Box", properties: [label("Ballon &amp; socle"), float("Length", "Length", 800), float("Width", "Length", 600), float("Height", "Length", 1900), float("LengthFwd", "Distance", 0), shape("Box")] },
  { type: "Part::FeaturePython", name: "Pipe", properties: [label("Départ chauffage"), tool("ArchPipe", "_ArchPipe"), ifcType(1), float("Diameter", "Length", 33.7), float("Length", "Length", 4250.5), shape("Pipe")] },
  { type: "Part::FeaturePython", name: "Wall", properties: [label("Mur &#233;tanche"), tool("ArchWall", "_Wall"), ifcType(2), float("HorizontalArea", "Area", 1.2e6), float("Volume", "Volume", 3e9), float("Angle", "Angle", 90), shape("Wall")] },
  { type: "App::DocumentObjectGroup", name: "Group", properties: [label("Chaufferie")] },
  { type: "Part::Part2DObjectPython", name: "Wire", properties: [label("Tracé"), tool("draftobjects.wire", "Wire"), ifcType(3), shape("Wire")] },
];

/** The same boiler room with two sketches: its walls, 4 m by 2 m, and one hole of 250 mm in radius. */
export const SKETCHED_ROOM: FcstdEntry[] = [
  ...BOILER_ROOM,
  { type: "Sketcher::SketchObject", name: "Sketch", properties: [label("Local technique"), shape("Sketch"), geometry("Geometry", [segment(0, 0, 4000, 0), segment(4000, 0, 4000, 2000), segment(4000, 2000, 0, 2000), segment(0, 2000, 0, 0)])] },
  { type: "Sketcher::SketchObject", name: "Sketch001", properties: [label("Réservations"), shape("Sketch001"), geometry("Geometry", [element("Circle", `<Circle CenterX="500" CenterY="500" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" AngleXU="0" Radius="250"/>`)])] },
];
