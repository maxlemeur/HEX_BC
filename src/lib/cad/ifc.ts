// An IFC model is what Revit, ArchiCAD or Allplan export of a building: its
// elements by class (pipe segment, fitting, terminal, wall), each with a type,
// a storey and a shape. It is read with web-ifc, which parses the file and
// meshes the shapes; what is made of it here is what a quantity take-off asks:
// how many of each type on each storey, the run of what is counted by its
// length, its section, and one mesh to look at.
//
// A length is, in this order: the one the file declares in its base quantities;
// the one read in the shape when it is a plain extrusion; the longest dimension
// of the mesh, which is approximate. The lengths written in property sets are
// not used: in a Revit export they are often a side of the section.
//
// The file also names its author, his company and the path it was saved to
// (header, IfcPerson, IfcOrganization, IfcProject, IfcSite, IfcBuilding): none
// of these is read.

import type { IfcAPI } from "web-ifc";

import { CadReadError } from "./dxf";

/** In millimetres: the diameter of a round section, or the two sides of a rectangular one, the longer first. */
export type IfcSection = [number] | [number, number];

/** The elements of one class, one type and one section on one storey. Lengths in metres, areas in m², volumes in m³. */
export type IfcRow = {
  /** Place of the class in `classes`. */
  cls: number;
  /** The name of the type; empty when the file gives none. */
  type: string;
  section: IfcSection | null;
  /** Place of the storey in `storeys`; -1 for what is in none. */
  storey: number;
  count: number;
  /** The sum of the lengths of the `lengths` elements that have one. */
  length: number;
  lengths: number;
  /** How many of these lengths the file declares. */
  stated: number;
  /** How many were measured on the mesh, as its longest dimension. */
  approximate: number;
  /** The sum of the areas the file declares, for `areas` elements. */
  area: number;
  areas: number;
  volume: number;
  volumes: number;
};

export type IfcPoint = [number, number, number];

/** A run of `indices` drawn or hidden together. */
export type IfcMeshGroup = { cls: number; storey: number; transparent: boolean; start: number; count: number; min: IfcPoint; max: IfcPoint };

/** Every shape as triangles, in metres, Y upwards, around an origin taken in the model so that the numbers stay small. */
export type IfcMesh = {
  positions: Float32Array;
  /** One for each position, each coordinate from -127 to 127. */
  normals: Int8Array;
  /** Red, green, blue and opacity of each vertex, from 0 to 255. */
  colors: Uint8Array;
  indices: Uint32Array;
  groups: IfcMeshGroup[];
  min: IfcPoint;
  max: IfcPoint;
  triangles: number;
  /** The model has more triangles than are kept. */
  truncated: boolean;
};

export type IfcStorey = { name: string; /** In metres; null when the file gives none. */ elevation: number | null };

export type IfcModel = {
  /** « IFC2X3 », « IFC4 ». */
  schema: string;
  /** The software that wrote the file, as the file names it. */
  application: string | null;
  /** The IFC classes met, by name: « IfcPipeSegment ». */
  classes: string[];
  /** From the lowest. */
  storeys: IfcStorey[];
  rows: IfcRow[];
  /** The elements of the file, and how many of them were read: those `rows` counts. */
  elements: number;
  counted: number;
  /**
   * `elements`: the file holds more elements than are read; `rows`: more types than are listed; `geometry`: more
   * triangles than are drawn; `apart`: shapes lost far from the rest of the model, which the mesh leaves out.
   */
  truncated: { elements: boolean; rows: boolean; geometry: boolean; apart: boolean };
  /** Null when nothing has a shape. */
  mesh: IfcMesh | null;
};

/** `maxRows`: past it, the types of a class are counted together. */
export type IfcLimits = { maxBytes: number; maxElements: number; maxRows: number; maxTriangles: number; maxVertices: number };

export const IFC_LIMITS: IfcLimits = { maxBytes: 64 * 1024 * 1024, maxElements: 200_000, maxRows: 2_000, maxTriangles: 2_000_000, maxVertices: 6_000_000 };

type WebIfc = typeof import("web-ifc");
type Line = Record<string, unknown>;

const HEADER_BYTES = 64 * 1024;
const TAIL_BYTES = 4 * 1024;
/** A name listed on the screen is cut there. */
const MAX_TEXT = 200;
const MAX_STOREYS = 1_000;
/** A storey is a few steps above what it holds: an element, its assembly, a room. */
const MAX_PARENTS = 32;
/** A duct with its taps has a handful of ports. */
const MAX_PORTS = 16;
/** Beyond this a length is not one of a building: it is a number the file got wrong. */
const MAX_METRES = 1e6;
/** A mesh whose origin is further than this from where most of the model is loses the millimetre: it is taken again from there. */
const RECENTRE_METRES = 1_000;
/** A shape is lost when it reaches further from the middle of the model than this, and than this many times what nearly all the others do. */
const APART_METRES = 1_000;
const APART_RATIO = 20;
const SI_PREFIXES = new Map([
  ["EXA", 1e18], ["PETA", 1e15], ["TERA", 1e12], ["GIGA", 1e9], ["MEGA", 1e6], ["KILO", 1e3], ["HECTO", 1e2], ["DECA", 10],
  ["DECI", 0.1], ["CENTI", 0.01], ["MILLI", 1e-3], ["MICRO", 1e-6], ["NANO", 1e-9], ["PICO", 1e-12], ["FEMTO", 1e-15], ["ATTO", 1e-18],
]);
/** The area and the volume kept of the several a set of base quantities may declare: the first of these it holds. */
const AREA_NAMES = ["netsidearea", "netarea", "netfloorarea", "netsurfacearea", "grosssidearea", "grossarea", "grossfloorarea", "grosssurfacearea", "area"];
const VOLUME_NAMES = ["netvolume", "grossvolume", "volume"];

/** The schema the header announces; null when the bytes are not those of an IFC model. Nothing else of the header is read. */
function announcedSchema(bytes: Uint8Array): string | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, HEADER_BYTES));
  if (!/^(?:\u00ef\u00bb\u00bf)?\s*ISO-10303-21\s*;/.test(head)) return null;
  return /FILE_SCHEMA\s*\(\s*\(\s*'(IFC[0-9A-Z_]{1,24})'/i.exec(head)?.[1].toUpperCase() ?? null;
}

/** A STEP file closes on « END-ISO-10303-21; »: one that does not was cut on its way. */
function isClosed(bytes: Uint8Array): boolean {
  return new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - TAIL_BYTES))).includes("END-ISO-10303-21");
}

const fieldValue = (field: unknown): unknown => (field !== null && typeof field === "object" && "value" in field ? (field as { value: unknown }).value : undefined);

function numberOf(field: unknown): number | null {
  const value = fieldValue(field);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOf(field: unknown): string {
  const value = fieldValue(field);
  // One line, without the characters that end one, and cut.
  return typeof value === "string" ? value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim().slice(0, MAX_TEXT).trimEnd() : "";
}

function refOf(field: unknown): number | null {
  const value = fieldValue(field);
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function refsOf(field: unknown): number[] {
  if (!Array.isArray(field)) return [];
  const refs: number[] = [];
  for (const entry of field) {
    const ref = refOf(entry);
    if (ref !== null) refs.push(ref);
  }
  return refs;
}

const metres = (value: number | null, factor: number) => (value !== null && value > 0 && value * factor <= MAX_METRES ? value * factor : null);

/** Eigenvectors of a symmetric matrix [xx, xy, xz, yy, yz, zz], as the columns of the result. */
function principalAxes(c: number[]): number[][] {
  const m = [[c[0], c[1], c[2]], [c[1], c[3], c[4]], [c[2], c[4], c[5]]], v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep += 1) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(m[p][q]) < 1e-300) continue;
      const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
      const t = (theta < 0 ? -1 : 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)), cos = 1 / Math.sqrt(t * t + 1), sin = t * cos;
      for (let k = 0; k < 3; k += 1) {
        const kp = m[k][p], kq = m[k][q];
        m[k][p] = cos * kp - sin * kq;
        m[k][q] = sin * kp + cos * kq;
      }
      for (let k = 0; k < 3; k += 1) {
        const pk = m[p][k], qk = m[q][k];
        m[p][k] = cos * pk - sin * qk;
        m[q][k] = sin * pk + cos * qk;
      }
      for (let k = 0; k < 3; k += 1) {
        const kp = v[k][p], kq = v[k][q];
        v[k][p] = cos * kp - sin * kq;
        v[k][q] = sin * kp + cos * kq;
      }
    }
  }
  return v;
}

/** The longest dimension of a cloud of points (x, y, z in a row), along the directions it spreads in. */
export function longestExtent(points: ArrayLike<number>): number {
  const count = Math.floor(points.length / 3);
  if (count < 2) return 0;
  const mean = [0, 0, 0];
  for (let at = 0; at < count * 3; at += 3) for (let k = 0; k < 3; k += 1) mean[k] += points[at + k] / count;
  const c = [0, 0, 0, 0, 0, 0];
  for (let at = 0; at < count * 3; at += 3) {
    const x = points[at] - mean[0], y = points[at + 1] - mean[1], z = points[at + 2] - mean[2];
    c[0] += x * x; c[1] += x * y; c[2] += x * z; c[3] += y * y; c[4] += y * z; c[5] += z * z;
  }
  const axes = principalAxes(c);
  let longest = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    let low = Infinity, high = -Infinity;
    for (let at = 0; at < count * 3; at += 3) {
      const along = points[at] * axes[0][axis] + points[at + 1] * axes[1][axis] + points[at + 2] * axes[2][axis];
      if (along < low) low = along;
      if (along > high) high = along;
    }
    if (high - low > longest) longest = high - low;
  }
  return Number.isFinite(longest) ? longest : 0;
}

/** A buffer that grows as the shapes come: their number is not known before the last one. */
class Grown<T extends Float32Array | Int8Array | Uint8Array> {
  length = 0;
  constructor(private data: T, private readonly make: (size: number) => T) {}
  /** Room for `more` values, whose place is returned. */
  reserve(more: number): { data: T; at: number } {
    if (this.length + more > this.data.length) {
      const larger = this.make(Math.max(this.data.length * 2, this.length + more));
      larger.set(this.data.subarray(0, this.length));
      this.data = larger;
    }
    const at = this.length;
    this.length += more;
    return { data: this.data, at };
  }
  done(): T {
    return this.data.slice(0, this.length) as T;
  }
}

type Entry = {
  cls: number;
  type: string;
  section: IfcSection | null;
  storey: number;
  length: number | null;
  source: "stated" | "shape" | "mesh" | null;
  area: number | null;
  volume: number | null;
  /** A segment whose run nothing says: it is measured on its mesh. */
  unmeasured: boolean;
};

type Stated = { length?: number; area?: number; volume?: number };

/** What one unit of the model is in metres, m² and m³; null for an area or a volume the model declares no unit of. */
type Units = { length: number; area: number | null; volume: number | null };

type Reading = { web: WebIfc; api: IfcAPI; model: number; limits: IfcLimits; line(id: number | null): Line | null; kind(id: number): number; ids(type: number, inherited: boolean): number[] };

function unitFactor(reading: Reading, unit: Line | null, power: number, depth = 0): number | null {
  if (!unit || depth > 4) return null;
  if ("ConversionFactor" in unit) {
    const measure = reading.line(refOf(unit.ConversionFactor));
    const value = measure ? numberOf(measure.ValueComponent) : null, base = measure ? unitFactor(reading, reading.line(refOf(measure.UnitComponent)), power, depth + 1) : null;
    return value !== null && value > 0 && base !== null ? value * base : null;
  }
  if (!("Name" in unit)) return null;
  const prefix = fieldValue(unit.Prefix);
  return (typeof prefix === "string" ? SI_PREFIXES.get(prefix) ?? 1 : 1) ** power;
}

function readUnits(reading: Reading): Units {
  // A length without a unit is in metres, as the format has it; an area in a model in millimetres could be either.
  const units: Units = { length: 1, area: null, volume: null };
  const project = reading.line(reading.ids(reading.web.IFCPROJECT, false)[0] ?? null);
  const assignment = reading.line((project && refOf(project.UnitsInContext)) ?? reading.ids(reading.web.IFCUNITASSIGNMENT, false)[0] ?? null);
  for (const ref of refsOf(assignment?.Units).slice(0, 64)) {
    const unit = reading.line(ref), type = unit ? fieldValue(unit.UnitType) : null;
    const key = type === "LENGTHUNIT" ? "length" : type === "AREAUNIT" ? "area" : type === "VOLUMEUNIT" ? "volume" : null;
    if (!key) continue;
    const factor = unitFactor(reading, unit, key === "length" ? 1 : key === "area" ? 2 : 3);
    if (factor !== null && Number.isFinite(factor) && factor > 0) units[key] = factor;
  }
  return units;
}

/**
 * How far apart the two farthest ports of an element are, in the unit of the model: the two ends of a segment.
 * Null with fewer than two ports, or when they are not all placed from one same placement.
 */
function portSpan(reading: Reading, ports: readonly number[] | undefined): number | null {
  if (!ports || ports.length < 2) return null;
  let from: number | null | undefined;
  const points: number[][] = [];
  for (const port of ports.slice(0, MAX_PORTS)) {
    const placement = reading.line(refOf(reading.line(port)?.ObjectPlacement));
    if (!placement) return null;
    const relativeTo = refOf(placement.PlacementRelTo);
    if (from !== undefined && from !== relativeTo) return null;
    from = relativeTo;
    const location = reading.line(refOf(reading.line(refOf(placement.RelativePlacement))?.Location));
    const coordinates = Array.isArray(location?.Coordinates) ? location.Coordinates.map(numberOf) : [];
    if (coordinates.length < 2 || coordinates.some((coordinate) => coordinate === null)) return null;
    points.push([coordinates[0]!, coordinates[1]!, coordinates[2] ?? 0]);
  }
  let span = 0;
  for (let a = 0; a < points.length; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) span = Math.max(span, Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1], points[a][2] - points[b][2]));
  }
  return span;
}

/** What tells the run of a segment beside its shape: the ends it connects by, the length the file declares for it, and whether it carries a flow. */
type RunHints = { ports: readonly number[] | undefined; stated: number | null; flow: boolean };

/**
 * The run and the section of a segment drawn as one extrusion; null for any other shape, and for one whose run
 * nothing tells. In the unit of the model, of which `millimetre` is one millimetre.
 */
function extrusionOf(reading: Reading, representation: number | null, hints: RunHints, millimetre: number): { run: number; section: IfcSection | null } | null {
  const { web } = reading;
  const shape = reading.line(representation);
  let apart: number | null | undefined;
  const span = () => (apart === undefined ? (apart = portSpan(reading, hints.ports)) : apart);
  /** Which of these sides a length is, to the millimetre or to two thousandths; -1 for none. */
  const told = (length: number | null, sides: readonly number[]) => (length !== null && length > 0 ? sides.findIndex((side) => Math.abs(side - length) <= Math.max(millimetre, 0.002 * length)) : -1);
  for (const ref of refsOf(shape?.Representations).slice(0, 16)) {
    const body = reading.line(ref);
    if (!body || textOf(body.RepresentationIdentifier).toLowerCase() !== "body") continue;
    let items = refsOf(body.Items);
    if (items.length === 1 && reading.kind(items[0]) === web.IFCMAPPEDITEM) {
      const mapped = reading.line(items[0]), target = reading.line(refOf(mapped?.MappingTarget));
      // A shape placed at another scale is not the one its numbers describe.
      if ([target?.Scale, target?.Scale2, target?.Scale3].some((scale) => (numberOf(scale) ?? 1) !== 1)) return null;
      items = refsOf(reading.line(refOf(reading.line(refOf(mapped?.MappingSource))?.MappedRepresentation))?.Items);
    }
    if (items.length !== 1 || reading.kind(items[0]) !== web.IFCEXTRUDEDAREASOLID) return null;
    const solid = reading.line(items[0]), depth = solid ? numberOf(solid.Depth) : null, profileRef = solid ? refOf(solid.SweptArea) : null;
    if (depth === null || depth <= 0 || profileRef === null) return null;
    const profile = reading.line(profileRef), kind = reading.kind(profileRef);
    if (profile && (kind === web.IFCCIRCLEPROFILEDEF || kind === web.IFCCIRCLEHOLLOWPROFILEDEF)) {
      const radius = numberOf(profile.Radius);
      return { run: depth, section: radius !== null && radius > 0 ? [2 * radius] : null };
    }
    if (profile && (kind === web.IFCRECTANGLEPROFILEDEF || kind === web.IFCRECTANGLEHOLLOWPROFILEDEF || kind === web.IFCROUNDEDRECTANGLEPROFILEDEF)) {
      const x = numberOf(profile.XDim), y = numberOf(profile.YDim);
      if (x === null || y === null || x <= 0 || y <= 0) return { run: depth, section: null };
      // A beam or a column is extruded along its axis. Revit draws a rectangular duct by its plan, extruded by its
      // height, or by its section, extruded by its run: the run is the side the file declares as its length, else the
      // side its two ends are apart by, else the longest one.
      const sides = [x, y, depth];
      const along = !hints.flow ? 2 : [told(hints.stated, sides), told(span(), sides), sides.indexOf(Math.max(x, y, depth))].find((side) => side >= 0)!;
      const [wide, narrow] = sides.filter((_, index) => index !== along).sort((a, b) => b - a);
      return { run: sides[along], section: [wide, narrow] };
    }
    // Any other profile may be the section of a duct or its plan: its depth is its run when its length or its ends say so.
    return !hints.flow || told(hints.stated, [depth]) === 0 || told(span(), [depth]) === 0 ? { run: depth, section: null } : null;
  }
  return null;
}

/** The length, the area and the volume each set of base quantities declares, by the number of the set. */
function readQuantitySets(reading: Reading, units: Units): Map<number, Stated> {
  const sets = new Map<number, Stated>();
  for (const id of reading.ids(reading.web.IFCELEMENTQUANTITY, false)) {
    const stated: Stated = {};
    let areaRank = AREA_NAMES.length, volumeRank = VOLUME_NAMES.length;
    for (const ref of refsOf(reading.line(id)?.Quantities).slice(0, 64)) {
      const quantity = reading.line(ref);
      if (!quantity) continue;
      const name = textOf(quantity.Name).toLowerCase(), own = refOf(quantity.Unit);
      // In the unit the quantity names for itself, else in that of the model; an area or a volume whose unit nothing says is not read.
      const scaled = (value: unknown, key: "length" | "area" | "volume", power: number) => {
        const factor = (own === null ? null : unitFactor(reading, reading.line(own), power)) ?? units[key];
        return factor === null ? null : metres(numberOf(value), factor);
      };
      if ("LengthValue" in quantity) {
        const length = scaled(quantity.LengthValue, "length", 1);
        if (name === "length" && length !== null && stated.length === undefined) stated.length = length;
      } else if ("AreaValue" in quantity) {
        const area = scaled(quantity.AreaValue, "area", 2), rank = AREA_NAMES.indexOf(name);
        if (area !== null && rank >= 0 && rank < areaRank) [stated.area, areaRank] = [area, rank];
      } else if ("VolumeValue" in quantity) {
        const volume = scaled(quantity.VolumeValue, "volume", 3), rank = VOLUME_NAMES.indexOf(name);
        if (volume !== null && rank >= 0 && rank < volumeRank) [stated.volume, volumeRank] = [volume, rank];
      }
    }
    if (stated.length !== undefined || stated.area !== undefined || stated.volume !== undefined) sets.set(id, stated);
  }
  return sets;
}

function readModel(reading: Reading, schema: string): IfcModel {
  const { web, api, limits } = reading;
  const units = readUnits(reading);

  const applicationLine = reading.line(reading.ids(web.IFCAPPLICATION, false)[0] ?? null);
  const software = applicationLine ? textOf(applicationLine.ApplicationFullName) : "", version = applicationLine ? textOf(applicationLine.Version) : "";
  const application = (software && version && !software.includes(version) ? `${software} ${version}` : software).slice(0, 80) || null;

  // The storeys, from the lowest.
  const storeyLines = reading.ids(web.IFCBUILDINGSTOREY, true).slice(0, MAX_STOREYS).map((id) => {
    const line = reading.line(id), elevation = line ? numberOf(line.Elevation) : null;
    return { id, name: (line && textOf(line.Name)) || "Niveau sans nom", elevation: elevation !== null && Math.abs(elevation * units.length) <= MAX_METRES ? Math.round(elevation * units.length * 1000) / 1000 + 0 : null };
  });
  storeyLines.sort((a, b) => (a.elevation ?? Infinity) - (b.elevation ?? Infinity) || a.name.localeCompare(b.name, "fr", { numeric: true }) || a.id - b.id);
  const storeyIndex = new Map(storeyLines.map((storey, index) => [storey.id, index]));

  // What holds what: a storey its elements, an assembly its parts, a storey its rooms.
  const parents = new Map<number, number>();
  for (const id of reading.ids(web.IFCRELCONTAINEDINSPATIALSTRUCTURE, false)) {
    const relation = reading.line(id), structure = relation ? refOf(relation.RelatingStructure) : null;
    if (structure !== null) for (const element of refsOf(relation?.RelatedElements)) parents.set(element, structure);
  }
  for (const id of reading.ids(web.IFCRELAGGREGATES, false)) {
    const relation = reading.line(id), whole = relation ? refOf(relation.RelatingObject) : null;
    if (whole !== null) for (const part of refsOf(relation?.RelatedObjects)) if (!parents.has(part)) parents.set(part, whole);
  }
  const storeyOf = (id: number) => {
    for (let at: number | undefined = id, steps = 0; at !== undefined && steps < MAX_PARENTS; at = parents.get(at), steps += 1) {
      const storey = storeyIndex.get(at);
      if (storey !== undefined) return storey;
    }
    return -1;
  };

  const typeOf = new Map<number, number>();
  for (const id of reading.ids(web.IFCRELDEFINESBYTYPE, false)) {
    const relation = reading.line(id), type = relation ? refOf(relation.RelatingType) : null;
    if (type !== null) for (const element of refsOf(relation?.RelatedObjects)) typeOf.set(element, type);
  }
  // A type is named by its line only when that line is one of a type: a person and a company have a name too.
  const typeIds = typeOf.size > 0 ? new Set(reading.ids(web.IFCTYPEOBJECT, true)) : new Set<number>();
  const typeNames = new Map<number, string>();
  const typeName = (id: number) => {
    let name = typeNames.get(id);
    if (name === undefined) typeNames.set(id, (name = typeIds.has(id) ? textOf(reading.line(id)?.Name) : ""));
    return name;
  };

  // The ends of the segments: IFC2X3 connects a port to its element, IFC4 nests it in it.
  const portIds = new Set(reading.ids(web.IFCDISTRIBUTIONPORT, true)), portsOf = new Map<number, number[]>();
  const port = (element: number | null, id: number | null) => {
    if (element === null || id === null || !portIds.has(id)) return;
    const known = portsOf.get(element);
    if (!known) portsOf.set(element, [id]);
    else if (known.length < MAX_PORTS) known.push(id);
  };
  if (portIds.size > 0) {
    for (const id of reading.ids(web.IFCRELCONNECTSPORTTOELEMENT, false)) {
      const relation = reading.line(id);
      if (relation) port(refOf(relation.RelatedElement), refOf(relation.RelatingPort));
    }
    for (const id of reading.ids(web.IFCRELNESTS, false)) {
      const relation = reading.line(id), whole = relation ? refOf(relation.RelatingObject) : null;
      for (const part of refsOf(relation?.RelatedObjects)) port(whole, part);
    }
  }

  const sets = readQuantitySets(reading, units);
  const statedOf = new Map<number, Stated>();
  if (sets.size > 0) {
    for (const id of reading.ids(web.IFCRELDEFINESBYPROPERTIES, false)) {
      const relation = reading.line(id), set = relation ? sets.get(refOf(relation.RelatingPropertyDefinition) ?? 0) : undefined;
      if (!set) continue;
      for (const element of refsOf(relation?.RelatedObjects)) statedOf.set(element, { ...set, ...statedOf.get(element) });
    }
  }

  // The elements: what is built or installed, not the openings cut in it nor the lines drawn for reference.
  const left = new Set([...reading.ids(web.IFCFEATUREELEMENT, true), ...reading.ids(web.IFCVIRTUALELEMENT, true)]);
  const elementIds = reading.ids(web.IFCELEMENT, true).filter((id) => !left.has(id));
  const flow = new Set(reading.ids(web.IFCFLOWSEGMENT, true));
  const linear = new Set([...flow, ...[web.IFCBEAM, web.IFCCOLUMN, web.IFCMEMBER, web.IFCPILE].flatMap((type) => reading.ids(type, true))]);
  const classIndex = new Map<number, number>(), classNames: string[] = [];
  const entries = new Map<number, Entry>();
  for (const id of elementIds.slice(0, limits.maxElements)) {
    const line = reading.line(id);
    if (!line) continue;
    const code = reading.kind(id);
    let cls = classIndex.get(code);
    if (cls === undefined) {
      classIndex.set(code, (cls = classNames.length));
      classNames.push(String(api.GetNameFromTypeCode(code)).slice(0, 80));
    }
    const typed = typeOf.get(id), stated = statedOf.get(id);
    const entry: Entry = {
      cls, type: (typed !== undefined && typeName(typed)) || textOf(line.ObjectType), section: null, storey: storeyOf(id),
      length: stated?.length ?? null, source: stated?.length !== undefined ? "stated" : null, area: stated?.area ?? null, volume: stated?.volume ?? null, unmeasured: false,
    };
    if (linear.has(id)) {
      const hints: RunHints = { ports: portsOf.get(id), stated: stated?.length === undefined ? null : stated.length / units.length, flow: flow.has(id) };
      const extrusion = extrusionOf(reading, refOf(line.Representation), hints, 0.001 / units.length);
      const run = extrusion ? metres(extrusion.run, units.length) : null;
      if (extrusion?.section) {
        const sides = extrusion.section.map((side) => metres(side, units.length));
        if (sides.every((side) => side !== null)) entry.section = sides.map((side) => Math.round(side! * 1e4) / 10) as IfcSection;
      }
      if (entry.length === null && run !== null) [entry.length, entry.source] = [run, "shape"];
      entry.unmeasured = entry.length === null;
    }
    entries.set(id, entry);
  }

  const { mesh, apart } = readMesh(reading, entries, storeyLines.length);

  // The classes by name, and the rows by class, type, section and storey.
  const order = classNames.map((_, index) => index).sort((a, b) => (classNames[a] < classNames[b] ? -1 : classNames[a] > classNames[b] ? 1 : 0));
  const place = new Map(order.map((cls, index) => [cls, index]));
  const rows = new Map<string, IfcRow>();
  let overflowed = false;
  for (const entry of entries.values()) {
    const cls = place.get(entry.cls)!;
    let key = `${cls}|${entry.storey}|${entry.section?.join("x") ?? ""}|${entry.type}`, row = rows.get(key);
    if (!row && rows.size >= limits.maxRows) {
      // Too many types to list: this one is counted with its class, on its storey.
      overflowed = true;
      key = `${cls}|${entry.storey}|+`;
      row = rows.get(key);
      if (!row) rows.set(key, (row = { cls, type: "", section: null, storey: entry.storey, count: 0, length: 0, lengths: 0, stated: 0, approximate: 0, area: 0, areas: 0, volume: 0, volumes: 0 }));
    }
    if (!row) rows.set(key, (row = { cls, type: entry.type, section: entry.section, storey: entry.storey, count: 0, length: 0, lengths: 0, stated: 0, approximate: 0, area: 0, areas: 0, volume: 0, volumes: 0 }));
    row.count += 1;
    if (entry.length !== null) {
      row.length += entry.length;
      row.lengths += 1;
      if (entry.source === "stated") row.stated += 1;
      if (entry.source === "mesh") row.approximate += 1;
    }
    if (entry.area !== null) [row.area, row.areas] = [row.area + entry.area, row.areas + 1];
    if (entry.volume !== null) [row.volume, row.volumes] = [row.volume + entry.volume, row.volumes + 1];
  }
  const sorted = [...rows.values()].sort((a, b) =>
    a.cls - b.cls
    || a.type.localeCompare(b.type, "fr", { numeric: true, sensitivity: "base" }) || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)
    || (b.section?.[0] ?? 0) - (a.section?.[0] ?? 0) || (b.section?.[1] ?? 0) - (a.section?.[1] ?? 0)
    || a.storey - b.storey);
  if (mesh) for (const group of mesh.groups) group.cls = place.get(group.cls)!;

  return {
    schema,
    application,
    classes: order.map((cls) => classNames[cls]),
    storeys: storeyLines.map(({ name, elevation }) => ({ name, elevation })),
    rows: sorted,
    elements: elementIds.length,
    counted: entries.size,
    truncated: { elements: elementIds.length > entries.size, rows: overflowed, geometry: mesh?.truncated ?? false, apart },
    mesh,
  };
}

/** One shape of an element, as it was added to the buffers: its triangles and the box around them. */
type Shape = { cls: number; storey: number; transparent: boolean; chunk: Uint32Array; min: IfcPoint; max: IfcPoint };

type Streamed = {
  positions: Float32Array; normals: Int8Array; colors: Uint8Array; shapes: Shape[];
  /** Where the positions are counted from, in the model; null when nothing has a shape. */
  origin: IfcPoint | null;
  truncated: boolean;
};

/**
 * Meshes the elements that were read, their positions counted from `origin`, or from the first shape met.
 * Measures on their mesh the segments whose run nothing else gives.
 */
function streamMesh(reading: Reading, entries: Map<number, Entry>, from: IfcPoint | null): Streamed {
  const { api, model, limits } = reading;
  const positions = new Grown(new Float32Array(3 * 4096), (size) => new Float32Array(size));
  const normals = new Grown(new Int8Array(3 * 4096), (size) => new Int8Array(size));
  const colors = new Grown(new Uint8Array(4 * 4096), (size) => new Uint8Array(size));
  const shapes: Shape[] = [];
  let origin = from, vertexCount = 0, triangles = 0, truncated = false;

  api.StreamAllMeshes(model, (flat) => {
    const entry = entries.get(flat.expressID);
    if (!entry) return;
    const cloud: number[] = [];
    for (let index = 0; index < flat.geometries.size(); index += 1) {
      const placed = flat.geometries.get(index), geometry = api.GetGeometry(model, placed.geometryExpressID);
      const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
      geometry.delete();
      const t = placed.flatTransformation, count = Math.floor(vertices.length / 6);
      if (count === 0 || indices.length < 3 || t.length < 16 || !t.every(Number.isFinite)) continue;
      origin ??= [t[12], t[13], t[14]];
      const drawn = triangles + indices.length / 3 <= limits.maxTriangles && vertexCount + count <= limits.maxVertices;
      if (!drawn) truncated = true;
      if (!drawn && !entry.unmeasured) continue;

      const place = drawn ? positions.reserve(count * 3) : null, normal = drawn ? normals.reserve(count * 3) : null, color = drawn ? colors.reserve(count * 4) : null;
      const rgba = [placed.color.x, placed.color.y, placed.color.z, placed.color.w].map((part) => Math.max(0, Math.min(255, Math.round(part * 255))));
      const min: IfcPoint = [Infinity, Infinity, Infinity], max: IfcPoint = [-Infinity, -Infinity, -Infinity];
      for (let vertex = 0; vertex < count; vertex += 1) {
        const at = vertex * 6, x = vertices[at], y = vertices[at + 1], z = vertices[at + 2];
        const px = t[0] * x + t[4] * y + t[8] * z + t[12] - origin[0], py = t[1] * x + t[5] * y + t[9] * z + t[13] - origin[1], pz = t[2] * x + t[6] * y + t[10] * z + t[14] - origin[2];
        if (entry.unmeasured) cloud.push(px, py, pz);
        if (!place || !normal || !color) continue;
        place.data[place.at + vertex * 3] = px;
        place.data[place.at + vertex * 3 + 1] = py;
        place.data[place.at + vertex * 3 + 2] = pz;
        // A corner that is not a number makes a box that is none: the shape is then left out.
        min[0] = Math.min(min[0], px); min[1] = Math.min(min[1], py); min[2] = Math.min(min[2], pz);
        max[0] = Math.max(max[0], px); max[1] = Math.max(max[1], py); max[2] = Math.max(max[2], pz);
        const a = vertices[at + 3], b = vertices[at + 4], c = vertices[at + 5];
        const nx = t[0] * a + t[4] * b + t[8] * c, ny = t[1] * a + t[5] * b + t[9] * c, nz = t[2] * a + t[6] * b + t[10] * c, norm = Math.hypot(nx, ny, nz) || 1;
        normal.data[normal.at + vertex * 3] = Math.round((nx / norm) * 127);
        normal.data[normal.at + vertex * 3 + 1] = Math.round((ny / norm) * 127);
        normal.data[normal.at + vertex * 3 + 2] = Math.round((nz / norm) * 127);
        color.data.set(rgba, color.at + vertex * 4);
      }
      if (!drawn) continue;
      // A triangle that points past the vertices of its shape is not drawn.
      const usable = indices.length - (indices.length % 3);
      const chunk = new Uint32Array(usable);
      let kept = 0;
      for (let at = 0; at < usable; at += 3) {
        if (indices[at] >= count || indices[at + 1] >= count || indices[at + 2] >= count) continue;
        chunk[kept] = indices[at] + vertexCount;
        chunk[kept + 1] = indices[at + 1] + vertexCount;
        chunk[kept + 2] = indices[at + 2] + vertexCount;
        kept += 3;
      }
      if (kept > 0) shapes.push({ cls: entry.cls, storey: entry.storey, transparent: placed.color.w < 0.999, chunk: kept === usable ? chunk : chunk.subarray(0, kept), min, max });
      triangles += kept / 3;
      vertexCount += count;
    }
    if (entry.unmeasured) {
      const length = longestExtent(cloud);
      if (length > 0 && length <= MAX_METRES) [entry.length, entry.source] = [length, "mesh"];
      entry.unmeasured = false;
    }
  });

  return { positions: positions.done(), normals: normals.done(), colors: colors.done(), shapes, origin, truncated };
}

const isBox = (shape: Shape) => shape.min.every(Number.isFinite) && shape.max.every(Number.isFinite);
/** How far a point is from another, along the axis it is furthest by. */
const farthest = (point: IfcPoint, from: IfcPoint) => Math.max(Math.abs(point[0] - from[0]), Math.abs(point[1] - from[1]), Math.abs(point[2] - from[2]));

/** Where most of the shapes are: the middle one of their centres, axis by axis. Null when no shape has a box. */
function middleOf(shapes: readonly Shape[]): IfcPoint | null {
  const boxed = shapes.filter(isBox);
  if (boxed.length === 0) return null;
  return [0, 1, 2].map((axis) => Float64Array.from(boxed, (shape) => (shape.min[axis] + shape.max[axis]) / 2).sort()[boxed.length >> 1]) as IfcPoint;
}

/**
 * The shapes of the elements that were read as one mesh. `apart` says that shapes were left out of it: those lost far
 * from the rest (a marker left at the origin of a survey, when the building is drawn where it stands), which would make
 * the model a dot in its own view, and those whose corners are not numbers.
 */
function readMesh(reading: Reading, entries: Map<number, Entry>, storeys: number): { mesh: IfcMesh | null; apart: boolean } {
  let streamed = streamMesh(reading, entries, null), middle = middleOf(streamed.shapes);
  if (streamed.origin && middle && Math.hypot(...middle) > RECENTRE_METRES) {
    // The first shape met was itself far from the others: they are meshed again around where they are.
    streamed = streamMesh(reading, entries, [streamed.origin[0] + middle[0], streamed.origin[1] + middle[1], streamed.origin[2] + middle[2]]);
    middle = middleOf(streamed.shapes);
  }
  const { shapes, truncated } = streamed;

  // What nearly all the shapes are within, from the middle one; a shape that reaches much further is lost.
  let kept: Shape[] = [];
  if (middle) {
    const centre = middle, boxed = shapes.filter(isBox);
    const spread = Float64Array.from(boxed, (shape) => farthest([(shape.min[0] + shape.max[0]) / 2, (shape.min[1] + shape.max[1]) / 2, (shape.min[2] + shape.max[2]) / 2], centre)).sort();
    const limit = Math.max(APART_METRES, APART_RATIO * spread[Math.floor(0.95 * (spread.length - 1))]);
    kept = boxed.filter((shape) => Math.max(farthest(shape.min, centre), farthest(shape.max, centre)) <= limit);
  }
  const apart = kept.length < shapes.length;

  const groups = new Map<number, { cls: number; storey: number; transparent: boolean; chunks: Uint32Array[]; count: number; min: IfcPoint; max: IfcPoint }>();
  let triangles = 0;
  for (const shape of kept) {
    const key = (shape.cls * (storeys + 1) + shape.storey + 1) * 2 + (shape.transparent ? 1 : 0);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { cls: shape.cls, storey: shape.storey, transparent: shape.transparent, chunks: [], count: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
    group.chunks.push(shape.chunk);
    group.count += shape.chunk.length;
    triangles += shape.chunk.length / 3;
    for (let axis = 0; axis < 3; axis += 1) {
      group.min[axis] = Math.min(group.min[axis], shape.min[axis]);
      group.max[axis] = Math.max(group.max[axis], shape.max[axis]);
    }
  }

  if (triangles === 0) {
    const none: IfcMesh = { positions: new Float32Array(), normals: new Int8Array(), colors: new Uint8Array(), indices: new Uint32Array(), groups: [], min: [0, 0, 0], max: [0, 0, 0], triangles: 0, truncated };
    return { mesh: truncated ? none : null, apart };
  }
  // What is opaque first, then what is seen through, each by class and storey.
  const ordered = [...groups.values()].sort((a, b) => Number(a.transparent) - Number(b.transparent) || a.cls - b.cls || a.storey - b.storey);
  const indices = new Uint32Array(triangles * 3);
  const min: IfcPoint = [Infinity, Infinity, Infinity], max: IfcPoint = [-Infinity, -Infinity, -Infinity];
  let start = 0;
  const listed: IfcMeshGroup[] = ordered.map((group) => {
    let at = start;
    for (const chunk of group.chunks) {
      indices.set(chunk, at);
      at += chunk.length;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], group.min[axis]);
      max[axis] = Math.max(max[axis], group.max[axis]);
    }
    const entry: IfcMeshGroup = { cls: group.cls, storey: group.storey, transparent: group.transparent, start, count: group.count, min: group.min, max: group.max };
    start = at;
    return entry;
  });
  return { mesh: { positions: streamed.positions, normals: streamed.normals, colors: streamed.colors, indices, groups: listed, min, max, triangles, truncated }, apart };
}

/**
 * Reads an IFC model. `wasmUrl` is where the browser fetches the WebAssembly of web-ifc;
 * Node finds it beside the package. Throws `CadReadError` for what is not an IFC model, or is one cut before its end.
 */
export async function readIfc(bytes: Uint8Array, options: { wasmUrl?: string; limits?: Partial<IfcLimits> } = {}): Promise<IfcModel> {
  const limits = { ...IFC_LIMITS, ...options.limits };
  if (bytes.length === 0) throw new CadReadError("empty");
  const schema = announcedSchema(bytes);
  if (schema === null) throw new CadReadError("not_ifc");
  if (bytes.length > limits.maxBytes) throw new CadReadError("too_large");
  // web-ifc reads what there is of a file cut on its way: half a model would be counted as a whole one.
  if (!isClosed(bytes)) throw new CadReadError("damaged_ifc");

  const web = await import("web-ifc");
  // A version of the format web-ifc has no schema for: IFC2X2 and older, or one to come.
  if (!web.SchemaNames.some((names) => names?.includes(schema))) throw new CadReadError("unsupported_ifc");
  const api = new web.IfcAPI();
  const { wasmUrl } = options;
  await api.Init(wasmUrl === undefined ? undefined : () => wasmUrl, true);
  api.SetLogLevel(web.LogLevel.LOG_LEVEL_OFF);
  let model = -1;
  try {
    model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
    // The header is that of a model, and the lines that follow it cannot be read.
    if (model < 0) throw new CadReadError("damaged_ifc");
    const opened = model;
    const reading: Reading = {
      web, api, model: opened, limits,
      line(id) {
        if (id === null) return null;
        try {
          const line: unknown = api.GetLine(opened, id, false);
          return line !== null && typeof line === "object" ? (line as Line) : null;
        } catch {
          // A line the file wrote wrong is a line it does not have.
          return null;
        }
      },
      kind: (id) => api.GetLineType(opened, id),
      ids(type, inherited) {
        const vector = api.GetLineIDsWithType(opened, type, inherited), ids: number[] = [];
        for (let index = 0, size = vector.size(); index < size; index += 1) ids.push(vector.get(index));
        return ids;
      },
    };
    return readModel(reading, schema);
  } finally {
    // Whatever the reading came to, the memory of the reader is given back: it is counted in hundreds of megabytes.
    try {
      if (model >= 0) api.CloseModel(model);
    } finally {
      api.Dispose();
    }
  }
}
