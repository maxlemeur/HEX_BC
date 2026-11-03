import { z } from "zod";

import { NETWORK_CODES, MATERIAL_CODES, type NetworkCode } from "@/lib/takeoff/bench/keys";
import { MM_PER_POINT } from "@/lib/takeoff/vectors/geometry";
import { VECTOR_ITEM_CONFIDENCE } from "@/lib/takeoff/vectors/items";
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
//   to the common frame (null until TI-664 computes it).
// Only measured items have a geometry: a page whose scale is not verified has
// none, its page row says why.

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
      status: reading.scale.status, reason: reading.scale.reason, denominator: reading.scale.denominator, cartouche: reading.scale.cartouche,
      format: { cartouche: reading.scale.format.cartouche, page_mm: reading.scale.format.page_mm, matches: reading.scale.format.matches },
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
 * The items of a measurable page with their geometry: one per network,
 * material and DN (and its insulation when labelled), one per room polygon.
 * The same keys as vectorItems (items.ts), with the centrelines kept.
 */
export function vectorItemRecords(reading: VectorPageReading, location: VectorPageRecord["location"]): VectorItemRecord[] {
  const denominator = reading.scale.denominator;
  if (denominator === null || reading.mode === "raster") return [];
  const metres = (value: number) => round((value * MM_PER_POINT * denominator) / 1000, 4);
  const scale = `1/${round(denominator, 2)} (${reading.scale.status})`;
  const groupsOf = (network: NetworkCode) => reading.groups
    .filter((group) => group.class === network || group.candidates.includes(network)).map((group) => group.id.slice(0, 120)).slice(0, 64);
  const records: VectorItemRecord[] = [];
  for (const total of reading.networks?.totals ?? []) {
    if (total.length_m === null || total.length_m < 0.01) continue;
    const runs = (reading.networks?.runs ?? []).filter((run) => run.network === total.network && run.material === total.material && run.dn === total.dn);
    const segments = runs.slice(0, VECTOR_GEOMETRY_LIMITS.segments).map((run) =>
      [metres(run.segment.x0), metres(run.segment.y0), metres(run.segment.x1), metres(run.segment.y1)] as [number, number, number, number]);
    const material = total.material ? MATERIAL_LABELS[total.material] ?? total.material : null;
    const code = total.network === "EUV" ? "EU/EV" : total.network;
    const base = { network: total.network, material: total.material, dn: total.dn, zone: location.zone, level: location.level,
      groups: groupsOf(total.network), segments_m: segments, polygon_m: null, area_m2: null, transform: null };
    records.push({
      item: {
        designation: [code, material, total.dn === null ? null : `DN ${total.dn}`].filter(Boolean).join(" "),
        quantity: round(total.length_m, 2), unit: "ml", category: "réseau (lecture vectorielle)",
        confidence: total.dn !== null && total.material !== null ? VECTOR_ITEM_CONFIDENCE.labelled : VECTOR_ITEM_CONFIDENCE.review,
        evidence: `Lecture vectorielle : ${total.runs} tronçon${total.runs > 1 ? "s" : ""} d’axe, échelle ${scale}.`,
      },
      geometry: VectorItemGeometrySchema.parse({ schema_version: 1, kind: "network", ...base, length_m: round(total.length_m, 3) }),
    });
    if (total.insulated_m !== null && total.insulated_m >= 0.01 && total.dn !== null) {
      const insulated = runs.filter((run) => run.insulated).slice(0, VECTOR_GEOMETRY_LIMITS.segments).map((run) =>
        [metres(run.segment.x0), metres(run.segment.y0), metres(run.segment.x1), metres(run.segment.y1)] as [number, number, number, number]);
      records.push({
        item: {
          designation: `${code} calorifuge DN ${total.dn}`, quantity: round(total.insulated_m, 2), unit: "ml", category: "calorifuge (lecture vectorielle)",
          confidence: VECTOR_ITEM_CONFIDENCE.labelled, evidence: `Lecture vectorielle : tronçons dont le libellé indique un calorifuge, échelle ${scale}.`,
        },
        geometry: VectorItemGeometrySchema.parse({ schema_version: 1, kind: "insulation", ...base, material: "calorifuge", segments_m: insulated,
          length_m: round(total.insulated_m, 3) }),
      });
    }
  }
  return records;
}
