import { NETWORKS } from "@/lib/takeoff/bench/keys";
import type { VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import type { RoomSurface } from "@/lib/takeoff/vectors/surfaces";
import type { TakeoffItem } from "@/lib/takeoff/types";
import { surfaceBasis } from "@/lib/takeoff/quantity-policy";

// Takeoff items of a vector reading (TI-662): one item per network, material
// and DN measured on a page whose scale is measurable (« ml »), one per room
// whose closed polygon was found or whose floor was filled between walls
// (« m2 », protective quantity only for an explicitly comparable net-floor label;
// geometry and rule inputs retain the independent measured area). The designation prints the network's code as plans and devis do
// (EU/EV for EUV), the material and « DN n », so that the bench reads the same
// key as from a level C answer. A run whose label says it is insulated adds
// an insulation item of the same length (« HW calorifuge DN 35 »). Confidence: 0.9 when the DN came from a label
// on that run or a run joined to it, 0.5 without DN or material (« à revoir »).

export const VECTOR_ITEMS_VERSION = 2;
export const VECTOR_ITEM_CONFIDENCE = { labelled: 0.9, review: 0.5 } as const;

/** Geometry remains the measured net floor; only an explicitly comparable label can raise the priced quantity. */
export function pricedSurfaceQuantity(surface: Pick<RoomSurface, "room" | "polygon_m2" | "printed_m2">) {
  if (surface.polygon_m2 === null) return null;
  return surfaceBasis(surface.room) === "net_floor" ? Math.max(surface.polygon_m2, surface.printed_m2) : surface.polygon_m2;
}

const MATERIAL_LABELS: Record<string, string> = {
  "inox-316l": "Inox 316L", "inox-304l": "Inox 304L", inox: "Inox", pvc: "PVC", "pvc-pression": "PVC pression",
  multicouche: "multicouche", per: "PER", pehd: "PEHD", pp: "PP", cuivre: "cuivre", fonte: "fonte SMU",
  "acier-galvanise": "acier galvanisé", "acier-noir": "acier noir", acier: "acier",
};

/**
 * The designation of a network line as vectorItems prints it (« EF cuivre DN 22 »): the network's code, its material
 * and « DN n ». Shared with the bench's vision pass (TI-664), which rewrites a line it corrected.
 */
export function vectorNetworkDesignation(network: keyof typeof NETWORKS, material: string | null, dn: string | number | null) {
  const label = material ? MATERIAL_LABELS[material] ?? material : null;
  return [NETWORKS[network].aliases[0], label, dn === null ? null : `DN ${dn}`].filter(Boolean).join(" ");
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function vectorItems(reading: VectorPageReading, sourceFile: string): TakeoffItem[] {
  const items: TakeoffItem[] = [];
  const scale = reading.scale.denominator === null ? null : `1/${round(reading.scale.denominator, 2)} (${reading.scale.status})`;
  for (const total of reading.networks?.totals ?? []) {
    if (total.length_m === null || total.length_m < 0.01) continue;
    const code = NETWORKS[total.network].aliases[0];
    const designation = vectorNetworkDesignation(total.network, total.material, total.dn);
    items.push({
      designation, quantity: round(total.length_m, 2), unit: "ml", category: "réseau (lecture vectorielle)", source_page: reading.page,
      source_file: sourceFile,
      confidence: total.dn !== null && total.material !== null ? VECTOR_ITEM_CONFIDENCE.labelled : VECTOR_ITEM_CONFIDENCE.review,
      evidence: `Lecture vectorielle : ${total.runs} tronçon${total.runs > 1 ? "s" : ""} d’axe, échelle ${scale}.`,
    });
    if (total.insulated_m !== null && total.insulated_m >= 0.01 && total.dn !== null) {
      items.push({
        designation: `${code} calorifuge DN ${total.dn}`, quantity: round(total.insulated_m, 2), unit: "ml", category: "calorifuge (lecture vectorielle)",
        source_page: reading.page, source_file: sourceFile, confidence: VECTOR_ITEM_CONFIDENCE.labelled,
        evidence: `Lecture vectorielle : tronçons dont le libellé indique un calorifuge, échelle ${scale}.`,
      });
    }
  }
  for (const surface of reading.surfaces) {
    if (surface.polygon_m2 === null || surface.polygon_m2 <= 0) continue;
    items.push({
      designation: `Surface « ${surface.room} »`, quantity: pricedSurfaceQuantity(surface)!, unit: "m2", ...surfaceWording(surface, scale),
      source_page: reading.page, source_file: sourceFile, confidence: VECTOR_ITEM_CONFIDENCE.labelled,
    });
  }
  return items;
}

/** Category and evidence of a room surface item: a closed polygon, or a floor filled between walls (TI-662 L3c). */
export function surfaceWording(surface: Pick<RoomSurface, "method" | "polygon_points"> & Partial<Pick<RoomSurface, "polygon_m2" | "printed_m2" | "room">>, scale: string | null) {
  const evidence = typeof surface.polygon_m2 === "number" && typeof surface.printed_m2 === "number"
    ? ` Mesure conservée : ${surface.polygon_m2.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} m² ; annotation : ${surface.printed_m2.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} m².` : "";
  return surface.method === "fill" ? {
    category: "surface (remplissage entre murs)",
    evidence: `Aire du remplissage entre murs (contour de ${surface.polygon_points} points), échelle ${scale} ; surface imprimée en contrôle.${evidence}`,
  } : {
    category: "surface (polygone fermé)",
    evidence: `Aire du polygone fermé (${surface.polygon_points} points), échelle ${scale} ; surface imprimée en contrôle.${evidence}`,
  };
}
