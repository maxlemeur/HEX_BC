import { scoredUnit } from "@/lib/takeoff/bench/item-keys";
import { MATERIALS, NETWORKS } from "@/lib/takeoff/bench/keys";
import { DIAMETER_FAMILIES } from "@/lib/takeoff/bench/diameters";
import { NETWORK_DIAMETER_TABLE_VERSION, WRAPPING_MATERIALS, checkNetworkDiameter } from "@/lib/takeoff/rules/network-diameters";
import { REGISTRATION_VERSION, composeTranslations, registerPages, translation, type PageAnchors, type Registration } from "@/lib/takeoff/rules/registration";
import {
  ROOM_RULES_VERSION,
  areaAgrees,
  isBoxLabel,
  isBoxShape,
  polygonPoints,
  roomsOverlap,
  sharedArea,
} from "@/lib/takeoff/rules/rooms";
import type {
  NonObservableCause,
  TakeoffFrameTransform,
  TakeoffRuleCode,
  TakeoffRuleId,
  TakeoffRuleInputs,
  TakeoffRuleResult,
  ZoneOverlapPartner,
} from "@/lib/takeoff/rules/types";
import { ZONE_OVERLAP, ZONE_OVERLAP_VERSION, commonLength, settlePairs, type Centreline, type DuplicatePair } from "@/lib/takeoff/rules/zone-overlap";

// Runs the fixed rules on the lines of one estimate version (TI-664): every
// job of the version, applied or not, so that a duplicate between two zones
// is seen from both jobs. Pure: the caller loads the lines and pages, then
// writes the results of the lines it may still change (jobs not applied).
// - Lines are compared only when included; an excluded line still gets its
//   results (for the review), never blocks and is no partner.
// - Versions: each result carries the version of its rule, which moves with
//   its thresholds or reference table.

export const TAKEOFF_RULE_VERSIONS: Record<TakeoffRuleId, number> = {
  dn_network: NETWORK_DIAMETER_TABLE_VERSION,
  zone_overlap: ZONE_OVERLAP_VERSION * 100 + REGISTRATION_VERSION,
  scale_dimension: 1,
  area_printed: ROOM_RULES_VERSION,
  room_overlap: ROOM_RULES_VERSION,
  closed_box: ROOM_RULES_VERSION,
  non_observable: 1,
};

export type RulePage = {
  key: string;
  job_id: string;
  /** Order of the page in the version (job creation, then page): the first page of a level is its common frame. */
  order: number;
  level: string | null;
  zone: string | null;
  /** The page's vector scale (TI-662), or null when no vector reading of the page exists. */
  scale: { status: "verified" | "format" | "calibrated" | "unverified"; reason: string | null } | null;
  anchors: PageAnchors | null;
};

export type RuleLine = {
  id: string;
  job_id: string;
  page_key: string | null;
  designation: string;
  unit: string;
  quantity: number;
  is_excluded: boolean;
  /** A line of an applied job: compared, never written. */
  frozen: boolean;
  inputs: TakeoffRuleInputs | null;
  /** Vector geometry in page metres (TI-662). */
  geometry: { segments_m: readonly Centreline[]; polygon_m: readonly number[] | null; length_m: number | null; area_m2: number | null } | null;
};

export type LevelRegistration = {
  level: string;
  reference: string;
  page: string;
  registration: Registration | { status: "reference" };
};

export type RuleEvaluation = {
  results: Map<string, TakeoffRuleResult[]>;
  /** Transform of each page compared for duplicates (identity for the first page of its level), null when not registered. */
  transforms: Map<string, TakeoffFrameTransform | null>;
  registrations: LevelRegistration[];
};

function result(rule: TakeoffRuleId, status: "pass" | "fail", code: TakeoffRuleCode, reason: string, details?: TakeoffRuleResult["details"],
  acceptable = true): TakeoffRuleResult {
  return { rule, status, code, version: TAKEOFF_RULE_VERSIONS[rule], acceptable, reason, ...(details ? { details } : {}) };
}

function metres(value: number) {
  return `${value.toFixed(2).replace(".", ",")} m`;
}

function squareMetres(value: number) {
  return `${value.toFixed(2).replace(".", ",")} m²`;
}

function percent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1).replace(".", ",")} %`;
}

function networkLabel(network: string) {
  return network === "EUV" ? "EU/EV" : network;
}

function materialLabel(material: string) {
  return MATERIALS[material as keyof typeof MATERIALS]?.label ?? material;
}

// ---------------------------------------------------------------------------
// Line rules

function dnNetwork(inputs: TakeoffRuleInputs): TakeoffRuleResult | null {
  if (inputs.kind !== "network") return null;
  if (inputs.material !== null && WRAPPING_MATERIALS.includes(inputs.material)) return null;
  if (inputs.network === null) {
    return result("dn_network", "fail", "DN_NETWORK_NETWORK_MISSING",
      "Réseau non lu (aucun ou deux) : la ligne ne se rattache à aucun triplet réseau, matériau et DN.",
      { network: null, material: inputs.material, dn: inputs.dn });
  }
  const network = inputs.network;
  const details = { network, material: inputs.material, dn: inputs.dn };
  const check = checkNetworkDiameter(network, inputs.material, inputs.dn);
  const name = `${networkLabel(network)} (${NETWORKS[network].label.toLowerCase()})`;
  switch (check.status) {
    case "compatible":
      return result("dn_network", "pass", "DN_NETWORK_COMPATIBLE",
        `${inputs.dn} en ${materialLabel(inputs.material as string).toLowerCase()} compatible avec le réseau ${name}.`, details);
    case "material_missing":
      return result("dn_network", "fail", "DN_NETWORK_MATERIAL_MISSING",
        `Matériau non lu : le DN ne peut pas être contrôlé pour le réseau ${name}.`, details);
    case "dn_missing":
      return result("dn_network", "fail", "DN_NETWORK_DN_MISSING", `DN non lu (aucun ou deux) pour le réseau ${name}.`, details);
    case "material_not_allowed":
      return result("dn_network", "fail", "DN_NETWORK_MATERIAL_NOT_ALLOWED",
        `${materialLabel(inputs.material as string)} n’est pas admis pour le réseau ${name}.`,
        { ...details, allowed_materials: [...check.allowed] });
    case "dn_not_in_series": {
      const standards = check.families.map((family) => DIAMETER_FAMILIES[family].standard).join(", ");
      return result("dn_network", "fail", "DN_NETWORK_DN_NOT_IN_SERIES",
        `${inputs.dn} n’existe pas en ${materialLabel(inputs.material as string).toLowerCase()}${standards ? ` (${standards})` : ""}.`, details);
    }
  }
}

const CAUSE_LABELS: Record<NonObservableCause, string> = {
  vertical: "tronçon vertical", weld: "soudures", tap: "piquages", support: "supports", install_only: "pose seule",
  transport: "transport", service: "prestation",
};

function nonObservable(line: RuleLine, inputs: TakeoffRuleInputs): TakeoffRuleResult | null {
  if (inputs.non_observable === null) return null;
  const cause = inputs.non_observable;
  const details = { cause, model_quantity: inputs.model_quantity };
  // A quantity the user typed is no longer the model's: entered. Verifying never settles it (acceptable: false).
  if (Math.abs(line.quantity - inputs.model_quantity) > 1e-9) {
    return result("non_observable", "pass", "NON_OBSERVABLE_ENTERED", `Quantité saisie (${CAUSE_LABELS[cause]}).`, details, false);
  }
  return result("non_observable", "fail", "NON_OBSERVABLE_TO_ENTER",
    `Quantité non observable sur le plan (${CAUSE_LABELS[cause]}) : à saisir, jamais proposée par la lecture.`, details, false);
}

function scaleDimension(line: RuleLine, inputs: TakeoffRuleInputs, page: RulePage | undefined): TakeoffRuleResult | null {
  if (!page?.scale || inputs.kind === "count") return null;
  const unit = scoredUnit(line.unit);
  if (unit !== "ml" && unit !== "m2") return null;
  if (page.scale.status === "unverified" && page.scale.reason === "dimension_mismatch") {
    return result("scale_dimension", "fail", "SCALE_DIMENSION_MISMATCH",
      "Une cote de la page contredit l’échelle du cartouche : longueurs et surfaces de cette page ne sont pas fiables.",
      { scale_reason: page.scale.reason });
  }
  return result("scale_dimension", "pass", "SCALE_DIMENSION_CONSISTENT", "Aucune cote ne contredit l’échelle du cartouche.",
    { scale_reason: page.scale.reason });
}

function roomLabel(inputs: TakeoffRuleInputs) {
  return inputs.room ? `« ${inputs.room} »` : "la pièce";
}

function areaPrinted(line: RuleLine, inputs: TakeoffRuleInputs): TakeoffRuleResult | null {
  if (inputs.kind !== "surface" || inputs.printed_m2 === null || inputs.printed_m2 === undefined || inputs.printed_m2 <= 0) return null;
  const printed = inputs.printed_m2;
  const deviation = Math.round(((line.quantity - printed) / printed) * 10_000) / 10_000;
  const details = { printed_m2: printed, measured_m2: line.quantity, deviation };
  const text = `${squareMetres(line.quantity)} pour ${squareMetres(printed)} imprimés dans ${roomLabel(inputs)} (${percent(deviation)}).`;
  return areaAgrees(line.quantity, printed)
    ? result("area_printed", "pass", "AREA_PRINTED_CONSISTENT", `Aire cohérente : ${text}`, details)
    : result("area_printed", "fail", "AREA_PRINTED_MISMATCH", `Aire différente de la surface imprimée : ${text}`, details);
}

function closedBox(line: RuleLine, inputs: TakeoffRuleInputs): TakeoffRuleResult | null {
  if (inputs.kind !== "surface") return null;
  if (inputs.room && isBoxLabel(inputs.room)) {
    return result("closed_box", "fail", "CLOSED_BOX_LABEL", `${roomLabel(inputs)} est une baignoire, un placard ou une gaine : pas une pièce.`);
  }
  const polygon = line.geometry?.polygon_m ? polygonPoints(line.geometry.polygon_m) : null;
  const area = line.geometry?.area_m2 ?? null;
  const printed = inputs.printed_m2 ?? null;
  if (polygon && area !== null && printed !== null && isBoxShape(polygon, area, printed)) {
    return result("closed_box", "fail", "CLOSED_BOX_SHAPE",
      `Le contour lu est une boîte de 4 côtés (${squareMetres(area)} pour ${squareMetres(printed)} imprimés) : pas ${roomLabel(inputs)}.`,
      { printed_m2: printed, measured_m2: area });
  }
  return result("closed_box", "pass", "CLOSED_BOX_NONE", "Le contour n’est ni une baignoire, ni un placard, ni une gaine.");
}

// ---------------------------------------------------------------------------
// Rules across lines

function roomOverlaps(lines: readonly RuleLine[], results: Map<string, TakeoffRuleResult[]>) {
  const byPage = new Map<string, Array<{ line: RuleLine; points: Array<[number, number]>; area: number }>>();
  for (const line of lines) {
    if (line.inputs?.kind !== "surface" || line.page_key === null || !line.geometry?.polygon_m) continue;
    const points = polygonPoints(line.geometry.polygon_m);
    if (points.length < 3) continue;
    const entries = byPage.get(line.page_key) ?? [];
    entries.push({ line, points, area: line.geometry.area_m2 ?? line.quantity });
    byPage.set(line.page_key, entries);
  }
  for (const entries of byPage.values()) {
    for (const entry of entries) {
      const overlaps: Array<{ id: string; area: number }> = [];
      for (const other of entries) {
        if (other === entry || other.line.is_excluded) continue;
        const shared = sharedArea(entry.points, other.points);
        if (roomsOverlap(shared, entry.area, other.area)) overlaps.push({ id: other.line.id, area: shared });
      }
      const total = Math.round(overlaps.reduce((sum, overlap) => sum + overlap.area, 0) * 1000) / 1000;
      push(results, entry.line.id, overlaps.length === 0
        ? result("room_overlap", "pass", "ROOM_OVERLAP_NONE", "Aucune autre pièce de la page ne recouvre ce contour.")
        : result("room_overlap", "fail", "ROOM_OVERLAP",
          `Ce contour recouvre ${overlaps.length} autre${overlaps.length > 1 ? "s" : ""} pièce${overlaps.length > 1 ? "s" : ""} de la page sur ${squareMetres(total)}.`,
          { overlapping_item_ids: overlaps.map((overlap) => overlap.id), overlap_m2: total }));
    }
  }
}

type ZoneLine = RuleLine & { inputs: TakeoffRuleInputs; geometry: NonNullable<RuleLine["geometry"]>; page_key: string };

function zoneKey(line: ZoneLine) {
  return `${line.inputs.kind}|${line.inputs.network}|${line.inputs.dn ?? ""}`;
}

function byText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Registers the pages of one level into the frame of its first page, through any registered page. */
function registerLevel(level: string, pages: readonly RulePage[]) {
  const ordered = [...pages].sort((left, right) => left.order - right.order || byText(left.key, right.key));
  const [reference] = ordered;
  const transforms = new Map<string, TakeoffFrameTransform | null>([[reference.key, translation(0, 0)]]);
  const registrations: LevelRegistration[] = [{ level, reference: reference.key, page: reference.key, registration: { status: "reference" } }];
  const last = new Map<string, Registration>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const page of ordered) {
      if (transforms.has(page.key)) continue;
      for (const registered of ordered.filter((candidate) => transforms.get(candidate.key))) {
        const anchors = [registered.anchors, page.anchors];
        const outcome: Registration = anchors[0] && anchors[1] ? registerPages(anchors[0], anchors[1]) : { status: "unregistered", reason: "no_anchor" };
        last.set(page.key, outcome);
        if (outcome.status !== "registered") continue;
        transforms.set(page.key, composeTranslations(translation(outcome.dx, outcome.dy), transforms.get(registered.key) as TakeoffFrameTransform));
        registrations.push({ level, reference: registered.key, page: page.key, registration: outcome });
        progress = true;
        break;
      }
    }
  }
  for (const page of ordered) {
    if (transforms.has(page.key)) continue;
    transforms.set(page.key, null);
    registrations.push({ level, reference: reference.key, page: page.key, registration: last.get(page.key) ?? { status: "unregistered", reason: "no_anchor" } });
  }
  return { transforms, registrations };
}

function zoneOverlaps(lines: readonly RuleLine[], pages: ReadonlyMap<string, RulePage>, results: Map<string, TakeoffRuleResult[]>) {
  const transforms = new Map<string, TakeoffFrameTransform | null>();
  const registrations: LevelRegistration[] = [];
  const eligible = lines.filter((line): line is ZoneLine => (line.inputs?.kind === "network" || line.inputs?.kind === "insulation")
    && line.inputs.network !== null && line.page_key !== null && (line.geometry?.segments_m.length ?? 0) > 0
    && (pages.get(line.page_key)?.level ?? null) !== null);
  const levels = new Map<string, ZoneLine[]>();
  for (const line of eligible) {
    const level = pages.get(line.page_key)?.level as string;
    levels.set(level, [...(levels.get(level) ?? []), line]);
  }
  for (const [level, levelLines] of [...levels.entries()].sort(([left], [right]) => byText(left, right))) {
    const levelPages = [...new Set(levelLines.map((line) => line.page_key))].map((key) => pages.get(key) as RulePage);
    if (levelPages.length < 2) {
      for (const line of levelLines) {
        push(results, line.id, result("zone_overlap", "pass", "ZONE_OVERLAP_NONE",
          `Aucune autre page du niveau ${level} : aucun tronçon compté deux fois.`, { level }));
      }
      continue;
    }
    const registered = registerLevel(level, levelPages);
    registered.transforms.forEach((value, key) => transforms.set(key, value));
    registrations.push(...registered.registrations);

    // Pairs of lines of the same key on two pages, included partners only.
    const pairs: DuplicatePair[] = [];
    const unregistered = new Set<string>();
    for (const [index, left] of levelLines.entries()) {
      for (const right of levelLines.slice(index + 1)) {
        if (left.page_key === right.page_key || zoneKey(left) !== zoneKey(right)) continue;
        if (left.is_excluded && right.is_excluded) continue;
        const [leftTransform, rightTransform] = [registered.transforms.get(left.page_key), registered.transforms.get(right.page_key)];
        if (!leftTransform || !rightTransform) {
          // Two lines that could be one run, on pages with no common frame: « zones non recalées ».
          if (!right.is_excluded) unregistered.add(left.id);
          if (!left.is_excluded) unregistered.add(right.id);
          continue;
        }
        const overlap = commonLength({ id: left.id, segments: left.geometry.segments_m }, leftTransform,
          { id: right.id, segments: right.geometry.segments_m }, rightTransform);
        if (overlap >= ZONE_OVERLAP.minLength_m) pairs.push({ left: left.id, right: right.id, overlap_m: overlap });
      }
    }
    const byId = new Map(levelLines.map((line) => [line.id, line]));
    const duplicateLines = new Map(levelLines.map((line) => [line.id, {
      id: line.id, measured_m: line.geometry.length_m ?? line.inputs.model_quantity, quantity: line.quantity, frozen: line.frozen,
    }]));
    const included = pairs.filter((pair) => !byId.get(pair.left)?.is_excluded && !byId.get(pair.right)?.is_excluded);
    const settled = settlePairs(included, duplicateLines);
    // An excluded line's pairs are shown as they would stand if it came back: settled by either reduction alone.
    const reduction = (id: string) => {
      const line = duplicateLines.get(id);
      return line ? Math.max(0, line.measured_m - line.quantity) : 0;
    };
    const isSettled = (pair: DuplicatePair) => settled.has(pair)
      || (!included.includes(pair) && Math.max(reduction(pair.left), reduction(pair.right)) >= pair.overlap_m - ZONE_OVERLAP.settle_m);

    for (const line of levelLines) {
      const zone = pages.get(line.page_key)?.zone ?? null;
      if (unregistered.has(line.id)) {
        push(results, line.id, result("zone_overlap", "fail", "ZONE_OVERLAP_UNREGISTERED",
          `Zones non recalées : les plans du niveau ${level} ne se superposent pas de façon fiable, un tronçon peut y être compté deux fois.`,
          { level }));
        continue;
      }
      // An excluded partner counts nothing: only included lines are the other side of a pair.
      const own = pairs.filter((pair) => (pair.left === line.id && !byId.get(pair.right)?.is_excluded)
        || (pair.right === line.id && !byId.get(pair.left)?.is_excluded));
      const partners: ZoneOverlapPartner[] = own.map((pair) => {
        const other = byId.get(pair.left === line.id ? pair.right : pair.left) as ZoneLine;
        return { item_id: other.id, job_id: other.job_id, zone: pages.get(other.page_key)?.zone ?? null, designation: other.designation,
          overlap_m: pair.overlap_m, resolved: isSettled(pair) };
      }).sort((left, right) => right.overlap_m - left.overlap_m || byText(left.item_id, right.item_id));
      const open = partners.filter((partner) => !partner.resolved);
      const total = Math.round(open.reduce((sum, partner) => sum + partner.overlap_m, 0) * 1000) / 1000;
      if (partners.length === 0) {
        push(results, line.id, result("zone_overlap", "pass", "ZONE_OVERLAP_NONE",
          `Aucun tronçon commun avec une autre page du niveau ${level}.`, { level }));
      } else if (open.length === 0) {
        push(results, line.id, result("zone_overlap", "pass", "ZONE_OVERLAP_RESOLVED",
          `Longueur commune avec ${partners.map((partner) => partner.zone ?? "une autre page").join(", ")} déjà retirée d’une des deux lignes.`,
          { level, partners }));
      } else {
        const where = open.map((partner) => `${metres(partner.overlap_m)} avec « ${partner.designation} »${partner.zone ? ` (${partner.zone})` : ""}`).join(", ");
        push(results, line.id, result("zone_overlap", "fail", "ZONE_OVERLAP_DUPLICATE",
          `Tronçon compté aussi sur une autre page du niveau ${level}${zone ? ` que ${zone}` : ""} : ${where}. Retirez cette longueur d’une des deux lignes, ou excluez une ligne entièrement en double.`,
          { level, partners, overlap_m: total }));
      }
    }
  }
  return { transforms, registrations };
}

function push(results: Map<string, TakeoffRuleResult[]>, id: string, entry: TakeoffRuleResult) {
  const list = results.get(id);
  if (list) list.push(entry);
  else results.set(id, [entry]);
}

const RULE_ORDER = new Map<TakeoffRuleId, number>([
  ["non_observable", 0], ["dn_network", 1], ["zone_overlap", 2], ["scale_dimension", 3], ["area_printed", 4], ["room_overlap", 5], ["closed_box", 6],
]);

/** Every rule on every line of the version; a line without inputs gets no result. */
export function evaluateTakeoffRules(input: { lines: readonly RuleLine[]; pages: readonly RulePage[] }): RuleEvaluation {
  const pages = new Map(input.pages.map((page) => [page.key, page]));
  const results = new Map<string, TakeoffRuleResult[]>();
  for (const line of input.lines) {
    if (!line.inputs) continue;
    const page = line.page_key === null ? undefined : pages.get(line.page_key);
    for (const entry of [nonObservable(line, line.inputs), dnNetwork(line.inputs), scaleDimension(line, line.inputs, page),
      areaPrinted(line, line.inputs), closedBox(line, line.inputs)]) {
      if (entry) push(results, line.id, entry);
    }
  }
  roomOverlaps(input.lines, results);
  const zone = zoneOverlaps(input.lines, pages, results);
  for (const list of results.values()) list.sort((left, right) => (RULE_ORDER.get(left.rule) ?? 9) - (RULE_ORDER.get(right.rule) ?? 9));
  return { results, transforms: zone.transforms, registrations: zone.registrations };
}
