import { z } from "zod";

import { NETWORK_CODES, MATERIAL_CODES, type NetworkCode } from "@/lib/takeoff/bench/keys";
import { MM_PER_POINT, pointsToMetres } from "@/lib/takeoff/vectors/geometry";
import { VECTOR_ITEM_CONFIDENCE } from "@/lib/takeoff/vectors/items";
import type { NetworkRun } from "@/lib/takeoff/vectors/measure";
import type { VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import { OTHER_CLASSES } from "@/lib/takeoff/vectors/vocabulary";

// What the takeoff worker persists of a vector reading (TI-662, TI-664 §0 input
// contract), versioned and bounded like its tables (takeoff_vector_pages
// 256 KiB, takeoff_item_geometries 512 KiB):
// - per page: size, scale (status, reason, cartouche, format, cotes,
//   calibration), legend codes, groups (class, source, length; the longest 400),
//   detection, label counts, printed surfaces with their polygon area, zone and
//   level (page_triage of TI-663 when it exists, else the file name);
// - per item: network, material, DN, insulated, zone and level, the groups it
//   comes from, its centreline segments (or room polygon) in metres from the
//   page's top-left corner at the page scale, length, area, and the transform
//   to the common frame (null until TI-664 computes it). A length of more
//   than VECTOR_GEOMETRY_LIMITS.segments centrelines is several items of the
//   same designation, each holding all its centrelines, their quantities
//   adding up to the measured length: never a quantity with part of its
//   geometry.
// Only measured items have a geometry: a page whose scale is not verified has
// none, its page row says why. A room polygon over VECTOR_GEOMETRY_LIMITS.polygon
// points keeps its measured area without its outline (never a cut shape).

export const VECTOR_PERSISTENCE_SCHEMA_VERSION = 1;
export const VECTOR_PAGE_LIMITS = { groups: 400, cotes: 50, surfaces: 300, codes: 40 } as const;
export const VECTOR_GEOMETRY_LIMITS = { segments: 4000, polygon: 2000 } as const;

const finite = z.number().finite();
const text = (max: number) => z.string().max(max);
const VectorClassSchema = z.union([z.enum(NETWORK_CODES), z.enum(OTHER_CLASSES)]);

export const VectorPageRecordSchema = z.object({
  schema_version: z.literal(VECTOR_PERSISTENCE_SCHEMA_VERSION),
  reading_version: z.number().int().positive(),
  mode: z.enum(["layers", "colours", "raster"]),
  size_pt: z.tuple([finite, finite]),
  rotate: z.number().int(),
  location: z.object({ zone: text(16).nullable(), level: text(16).nullable(), source: z.enum(["page_triage", "file_name"]).nullable() }).strict(),
  scale: z.object({
    status: z.enum(["verified", "format", "calibrated", "unverified"]),
    reason: text(64).nullable(),
    denominator: finite.positive().nullable(),
    cartouche: z.object({ denominator: finite.positive(), text: text(120), labelled: z.boolean() }).strict().nullable(),
    format: z.object({ cartouche: text(40).nullable(), page_mm: z.tuple([finite, finite]), matches: z.boolean().nullable() }).strict(),
    cotes: z.array(z.object({ text: text(40), value_m: finite, measured_m: finite, consistent: z.boolean() }).strict()).max(VECTOR_PAGE_LIMITS.cotes),
    calibration: z.object({ denominator: finite.positive(), source: text(500) }).strict().nullable(),
  }).strict(),
  legend: z.array(z.enum(NETWORK_CODES)).max(VECTOR_PAGE_LIMITS.codes),
  detection: finite.min(0).max(1).nullable(),
  groups: z.array(z.object({
    id: text(120), class: VectorClassSchema.nullable(), source: text(16).nullable(), confidence: finite.nullable(),
    candidates: z.array(z.enum(NETWORK_CODES)).max(8), length_pt: finite, near_white: z.boolean(), colors: z.array(text(16)).max(4),
  }).strict()).max(VECTOR_PAGE_LIMITS.groups),
  groups_total: z.number().int().nonnegative(),
  labels: z.object({ blocks: z.number().int(), attached: z.number().int(), superposed: z.number().int(), incomplete: z.number().int() }).strict().nullable(),
  surfaces: z.array(z.object({ room: text(120), printed_m2: finite, polygon_m2: finite.nullable(), deviation: finite.nullable() }).strict())
    .max(VECTOR_PAGE_LIMITS.surfaces),
}).strict();
export type VectorPageRecord = z.infer<typeof VectorPageRecordSchema>;

export const VectorItemGeometrySchema = z.object({
  schema_version: z.literal(VECTOR_PERSISTENCE_SCHEMA_VERSION),
  kind: z.enum(["network", "insulation", "surface"]),
  network: z.enum(NETWORK_CODES).nullable(),
  material: z.enum(MATERIAL_CODES).nullable(),
  dn: finite.positive().nullable(),
  zone: text(16).nullable(),
  level: text(16).nullable(),
  groups: z.array(text(120)).max(64),
  /** Centreline segments x0, y0, x1, y1 in metres from the page's top-left corner. */
  segments_m: z.array(z.tuple([finite, finite, finite, finite])).max(VECTOR_GEOMETRY_LIMITS.segments),
  /** Room polygon, x, y pairs in metres. */
  polygon_m: z.array(finite).max(2 * VECTOR_GEOMETRY_LIMITS.polygon).nullable(),
  length_m: finite.nonnegative().nullable(),
  area_m2: finite.nonnegative().nullable(),
  /** Page metres to the common frame of the version (TI-664); null until computed. */
  transform: z.array(finite).length(6).nullable(),
}).strict();
export type VectorItemGeometry = z.infer<typeof VectorItemGeometrySchema>;

const LEVEL = /(?:^|[^A-Z0-9])(RDC|R\+\d{1,2}|R-\d{1,2}|SS\d{1,2}|N\d{1,2})(?![A-Z0-9])/i;
const ZONE = /(?:^|[^A-Z0-9])(Z\d{1,2})(?![A-Z0-9])/i;

/** Zone and level read in a file name (« Plan R+4 Z2.pdf »), the fallback before TI-663's page triage. */
export function locationFromFileName(fileName: string) {
  const name = fileName.normalize("NFC").replace(/\.pdf$/i, "");
  const level = LEVEL.exec(name)?.[1]?.toUpperCase() ?? null;
  const zone = ZONE.exec(name)?.[1]?.toUpperCase() ?? null;
  return { zone, level, source: level || zone ? ("file_name" as const) : null };
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** The page row of a reading, bounded: the longest groups first. */
export function vectorPageRecord(reading: VectorPageReading, location: VectorPageRecord["location"]): VectorPageRecord {
  const groups = [...reading.groups].sort((left, right) => right.length_pt - left.length_pt);
  return VectorPageRecordSchema.parse({
    schema_version: VECTOR_PERSISTENCE_SCHEMA_VERSION, reading_version: reading.version, mode: reading.mode, size_pt: reading.size_pt,
    rotate: reading.rotate, location,
    scale: {
      status: reading.scale.status, reason: reading.scale.reason?.slice(0, 64) ?? null, denominator: reading.scale.denominator,
      // Texts are cut to their bounds: a long scale note never fails the page (the extraction keeps up to 500 characters).
      cartouche: reading.scale.cartouche === null ? null : { ...reading.scale.cartouche, text: reading.scale.cartouche.text.slice(0, 120) },
      format: { cartouche: reading.scale.format.cartouche?.slice(0, 40) ?? null, page_mm: reading.scale.format.page_mm, matches: reading.scale.format.matches },
      cotes: reading.scale.cotes.slice(0, VECTOR_PAGE_LIMITS.cotes).map((cote) => ({
        text: cote.text.slice(0, 40), value_m: cote.value_m, measured_m: cote.measured_m, consistent: cote.consistent })),
      calibration: reading.scale.calibration === null ? null : { ...reading.scale.calibration, source: reading.scale.calibration.source.slice(0, 500) },
    },
    legend: [...new Set(reading.legend.entries.map((entry) => entry.network))].slice(0, VECTOR_PAGE_LIMITS.codes),
    detection: reading.detection,
    groups: groups.slice(0, VECTOR_PAGE_LIMITS.groups).map((group) => ({
      id: group.id.slice(0, 120), class: group.class, source: group.source, confidence: group.confidence, candidates: group.candidates.slice(0, 8),
      length_pt: round(group.length_pt, 1), near_white: group.nearWhite, colors: group.colors.slice(0, 4),
    })),
    groups_total: reading.groups.length,
    labels: reading.networks ? {
      blocks: reading.networks.labels.blocks, attached: reading.networks.labels.attached,
      superposed: reading.networks.labels.superposed, incomplete: reading.networks.labels.incomplete,
    } : null,
    surfaces: reading.surfaces.slice(0, VECTOR_PAGE_LIMITS.surfaces).map((surface) => ({
      room: surface.room.slice(0, 120), printed_m2: surface.printed_m2, polygon_m2: surface.polygon_m2, deviation: surface.deviation })),
  });
}

export type VectorItemRecord = {
  /** The item, as the worker inserts it into takeoff_items. */
  item: { designation: string; quantity: number; unit: string; confidence: number; evidence: string; category: string };
  geometry: VectorItemGeometry;
};

const MATERIAL_LABELS: Record<string, string> = {
  "inox-316l": "Inox 316L", "inox-304l": "Inox 304L", inox: "Inox", pvc: "PVC", "pvc-pression": "PVC pression",
  multicouche: "multicouche", per: "PER", pehd: "PEHD", pp: "PP", cuivre: "cuivre", fonte: "fonte SMU",
  "acier-galvanise": "acier galvanisé", "acier-noir": "acier noir", acier: "acier",
};

/**
 * A measured length (network or insulation) as parts of at most
 * VECTOR_GEOMETRY_LIMITS.segments runs, of nearly equal counts, so that each
 * item's geometry holds every centreline its quantity counts. A part's length
 * is its runs' length, rounded on their running sum: the parts add up to the
 * measured length exactly, the last one ending on it. One part (the total
 * itself) up to the limit; a part under 1 cm gives no item, as a total.
 */
function lengthParts(runs: readonly NetworkRun[], length_m: number, denominator: number) {
  const count = Math.max(1, Math.ceil(runs.length / VECTOR_GEOMETRY_LIMITS.segments));
  const size = Math.ceil(runs.length / count);
  const parts: Array<{ runs: NetworkRun[]; length_m: number; quantity: number }> = [];
  let points = 0, reached = 0;
  for (let index = 0; index < count; index += 1) {
    const part = runs.slice(index * size, (index + 1) * size);
    for (const run of part) points += run.length_pt;
    const end = index === count - 1 ? length_m : round(pointsToMetres(points, denominator), 3);
    parts.push({ runs: part, length_m: round(end - reached, 3), quantity: round(round(end, 2) - round(reached, 2), 2) });
    reached = end;
  }
  return parts.filter((part) => part.quantity >= 0.01);
}

/** « (partie 2 sur 3) » in the evidence of a split length; nothing for a whole one. */
function partOf(index: number, count: number) {
  return count > 1 ? ` (partie ${index + 1} sur ${count})` : "";
}

/**
 * The items of a measurable page with their geometry: one per network,
 * material and DN (and its insulation when labelled), one per room polygon.
 * The same keys as vectorItems (items.ts), with the centrelines kept: a key
 * over VECTOR_GEOMETRY_LIMITS.segments centrelines is several items (lengthParts).
 */
export function vectorItemRecords(reading: VectorPageReading, location: VectorPageRecord["location"]): VectorItemRecord[] {
  const denominator = reading.scale.denominator;
  if (denominator === null || reading.mode === "raster") return [];
  const metres = (value: number) => round((value * MM_PER_POINT * denominator) / 1000, 4);
  const segmentOf = ({ segment }: NetworkRun) => [metres(segment.x0), metres(segment.y0), metres(segment.x1), metres(segment.y1)] as [number, number, number, number];
  const scale = `1/${round(denominator, 2)} (${reading.scale.status})`;
  const groupsOf = (network: NetworkCode) => reading.groups
    .filter((group) => group.class === network || group.candidates.includes(network)).map((group) => group.id.slice(0, 120)).slice(0, 64);
  const records: VectorItemRecord[] = [];
  for (const total of reading.networks?.totals ?? []) {
    if (total.length_m === null || total.length_m < 0.01) continue;
    const runs = (reading.networks?.runs ?? []).filter((run) => run.network === total.network && run.material === total.material && run.dn === total.dn);
    const material = total.material ? MATERIAL_LABELS[total.material] ?? total.material : null;
    const code = total.network === "EUV" ? "EU/EV" : total.network;
    const base = { network: total.network, material: total.material, dn: total.dn, zone: location.zone, level: location.level,
      groups: groupsOf(total.network), polygon_m: null, area_m2: null, transform: null };
    const pipes = lengthParts(runs, total.length_m, denominator);
    pipes.forEach((part, index) => {
      const count = pipes.length > 1 ? part.runs.length : total.runs;
      records.push({
        item: {
          designation: [code, material, total.dn === null ? null : `DN ${total.dn}`].filter(Boolean).join(" "),
          quantity: part.quantity, unit: "ml", category: "réseau (lecture vectorielle)",
          confidence: total.dn !== null && total.material !== null ? VECTOR_ITEM_CONFIDENCE.labelled : VECTOR_ITEM_CONFIDENCE.review,
          evidence: `Lecture vectorielle : ${count} tronçon${count > 1 ? "s" : ""} d’axe${partOf(index, pipes.length)}, échelle ${scale}.`,
        },
        geometry: VectorItemGeometrySchema.parse({ schema_version: 1, kind: "network", ...base, segments_m: part.runs.map(segmentOf), length_m: part.length_m }),
      });
    });
    if (total.insulated_m !== null && total.insulated_m >= 0.01 && total.dn !== null) {
      const insulated = lengthParts(runs.filter((run) => run.insulated), total.insulated_m, denominator);
      insulated.forEach((part, index) => records.push({
        item: {
          designation: `${code} calorifuge DN ${total.dn}`, quantity: part.quantity, unit: "ml", category: "calorifuge (lecture vectorielle)",
          confidence: VECTOR_ITEM_CONFIDENCE.labelled,
          evidence: `Lecture vectorielle : tronçons dont le libellé indique un calorifuge${partOf(index, insulated.length)}, échelle ${scale}.`,
        },
        geometry: VectorItemGeometrySchema.parse({ schema_version: 1, kind: "insulation", ...base, material: "calorifuge",
          segments_m: part.runs.map(segmentOf), length_m: part.length_m }),
      }));
    }
  }
  // The rooms vectorItems measures (items.ts): the polygon area, never the printed surface, on the same page frame;
  // the rooms the page record keeps (VECTOR_PAGE_LIMITS.surfaces), never more.
  for (const surface of reading.surfaces.slice(0, VECTOR_PAGE_LIMITS.surfaces)) {
    if (surface.polygon_m2 === null || surface.polygon_m2 <= 0 || surface.outline === null) continue;
    const polygon = surface.outline.points.length <= 2 * VECTOR_GEOMETRY_LIMITS.polygon ? surface.outline.points.map(metres) : null;
    records.push({
      item: {
        designation: `Surface « ${surface.room.slice(0, 120)} »`, quantity: surface.polygon_m2, unit: "m2", category: "surface (polygone fermé)",
        confidence: VECTOR_ITEM_CONFIDENCE.labelled,
        evidence: `Aire du polygone fermé (${surface.polygon_points} points), échelle ${scale} ; surface imprimée en contrôle.`,
      },
      geometry: VectorItemGeometrySchema.parse({ schema_version: 1, kind: "surface", network: null, material: null, dn: null,
        zone: location.zone, level: location.level, groups: [surface.outline.group.slice(0, 120)], segments_m: [], polygon_m: polygon,
        length_m: null, area_m2: surface.polygon_m2, transform: null }),
    });
  }
  return records;
}

/** What a geometry weighs against the review's segment budget (read-contracts.ts): its centrelines, one edge per point of its room polygon. */
export function geometryWeight(geometry: { segments_m: readonly unknown[]; polygon_m: readonly unknown[] | null }) {
  return geometry.segments_m.length + (geometry.polygon_m?.length ?? 0) / 2;
}

/**
 * A job's vector items within what its review reads (geometries and segments, read-contracts.ts), in page order:
 * a page whose items would pass a limit keeps its record without its items, with the reason; the next pages may
 * still fit. The review never refuses a job (413) for the items its worker wrote.
 */
export function budgetVectorItems<T extends { items: VectorItemRecord[]; error: string | null }>(pages: readonly T[],
  limits: { geometries: number; segments: number }): T[] {
  let geometries = 0, segments = 0;
  return pages.map((page) => {
    if (page.items.length === 0) return page;
    const weight = page.items.reduce((sum, record) => sum + geometryWeight(record.geometry), 0);
    if (geometries + page.items.length > limits.geometries || segments + weight > limits.segments) {
      return { ...page, items: [], error: `item_budget: ${page.items.length} geometries and ${weight} segments over the ${limits.geometries} `
        + `geometries and ${limits.segments} segments the review reads` };
    }
    geometries += page.items.length;
    segments += weight;
    return page;
  });
}
