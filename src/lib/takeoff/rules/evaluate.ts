import { scoredUnit } from "@/lib/takeoff/bench/item-keys";
import { MATERIALS, NETWORKS } from "@/lib/takeoff/bench/keys";
import { DIAMETER_FAMILIES, findDiameterEntries, hasDiameterSeries, sameSizeWithoutSeries } from "@/lib/takeoff/bench/diameters";
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
import {
  ZONE_OVERLAP_VERSION,
  CoverageCache,
  commonLength,
  coveredBy,
  minCommonLength,
  settlePair,
  type Centreline,
  type DuplicatePair,
} from "@/lib/takeoff/rules/zone-overlap";

// Runs the fixed rules on the lines of one estimate version (TI-664): every
// job of the version, applied or not, so that a duplicate between two zones
// is seen from both jobs. Pure: the caller loads the lines and pages, then
// writes the results of the lines it may still change (jobs not applied).
// - An excluded line is no partner and never blocks: it is compared with
//   included lines only to show its own results (for the review), as they
//   would stand if it came back; two excluded lines are never compared.
// - Duplicates: a correction settles an isolated pair only; three lines or
//   more joined by pairs stay failed until each is excluded or accepted.
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
  /** Its scale denominator, when measurable: the band of its drawing sets the smallest duplicate (minCommonLength). */
  denominator?: number | null;
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
  /** A user typed the line's current quantity (attested entry): a quantity to enter is entered. */
  quantity_entered?: boolean;
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
  let check = checkNetworkDiameter(network, inputs.material, inputs.dn);
  // A vector label keeps the size, not its notation (« DN 100 » or « Ø 110 » both give a number): read it either way.
  if (check.status === "dn_not_in_series" && inputs.source === "vector" && inputs.dn?.startsWith("DN ")) {
    const outer = checkNetworkDiameter(network, inputs.material, `Ø ${inputs.dn.slice(3)}`);
    if (outer.status === "compatible") check = outer;
  }
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
  // A quantity a user typed (attested, even equal to the model's) or changed is entered. Verifying never settles it.
  // Quantities are stored to the thousandth (numeric(12,3), a half rounded up): the model's, stored, is still the model's.
  const thousandths = (value: number) => Math.round(value * 1000 + 1e-6);
  if (line.quantity_entered === true || thousandths(line.quantity) !== thousandths(inputs.model_quantity)) {
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
  // Nothing to read: no printed label and no contour (a surface the model proposed).
  if (!inputs.room && !line.geometry?.polygon_m) return null;
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

/**
 * Sizes a line's DN names, as entries of the diameter table (family and outer diameter), through its material's
 * series; a vector size reads either way (« DN 100 » or « Ø 110 » of one cast-iron pipe).
 */
function sizesOf(inputs: TakeoffRuleInputs): Set<string> {
  if (inputs.dn === null) return new Set();
  const entries = findDiameterEntries(inputs.dn, inputs.material);
  if (inputs.source === "vector" && inputs.dn.startsWith("DN ")) entries.push(...findDiameterEntries(`Ø ${inputs.dn.slice(3)}`, inputs.material));
  return new Set(entries.map((entry) => `${entry.family}:${entry.od_mm}`));
}

/**
 * Two lines that may be one run: same kind and network, and one size: an entry in common, or the same printed DN.
 * A line whose material has no series (an insulation, no material) is compared by the size it prints, never through
 * the series of every material, where « DN 15 » and « DN 20 » meet.
 */
function sameRun(left: ZoneLine, right: ZoneLine, sizes: ReadonlyMap<string, Set<string>>) {
  if (left.inputs.kind !== right.inputs.kind || left.inputs.network !== right.inputs.network) return false;
  if (!hasDiameterSeries(left.inputs.material) || !hasDiameterSeries(right.inputs.material)) {
    const [l, r] = [left.inputs, right.inputs];
    if (l.dn === null || r.dn === null) return l.dn === r.dn;
    return l.dn === r.dn || sameSizeWithoutSeries({ printed: l.dn, entries: findDiameterEntries(l.dn, l.material) },
      { printed: r.dn, entries: findDiameterEntries(r.dn, r.material) });
  }
  const [a, b] = [sizes.get(left.id) ?? new Set<string>(), sizes.get(right.id) ?? new Set<string>()];
  if (a.size === 0 || b.size === 0) return a.size === 0 && b.size === 0 && left.inputs.dn === right.inputs.dn;
  return [...a].some((entry) => b.has(entry));
}

function byText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Registers the pages of one level: every two pages are registered when they can be, and pages joined by
 * registrations form a component, in the frame of its first page (job order). Two pages of two components have no
 * common frame. A component of one page is its own frame. `direct`: for two pages registered with each other, what
 * brings the second's metres into the first's frame; two such pages are compared through it, never through a path
 * of registrations by a third page, which may not close.
 */
function registerLevel(level: string, pages: readonly RulePage[]) {
  const ordered = [...pages].sort((left, right) => left.order - right.order || byText(left.key, right.key));
  const links = new Map<string, Array<{ page: string; dx: number; dy: number }>>(ordered.map((page) => [page.key, []]));
  const outcomes = new Map<string, Registration>();
  for (const [index, reference] of ordered.entries()) {
    for (const page of ordered.slice(index + 1)) {
      const outcome: Registration = reference.anchors && page.anchors
        ? registerPages(reference.anchors, page.anchors) : { status: "unregistered", reason: "no_anchor" };
      outcomes.set(`${reference.key}|${page.key}`, outcome);
      if (outcome.status !== "registered") continue;
      // A link from A to B carries what brings B's metres into A's frame: page + (dx, dy) is in the reference's
      // frame, the reference minus (dx, dy) in the page's.
      links.get(reference.key)?.push({ page: page.key, dx: outcome.dx, dy: outcome.dy });
      links.get(page.key)?.push({ page: reference.key, dx: -outcome.dx, dy: -outcome.dy });
    }
  }
  const transforms = new Map<string, TakeoffFrameTransform | null>();
  const component = new Map<string, string>();
  const registrations: LevelRegistration[] = [];
  for (const root of ordered) {
    if (component.has(root.key)) continue;
    component.set(root.key, root.key);
    transforms.set(root.key, translation(0, 0));
    if ((links.get(root.key) ?? []).length === 0) {
      // A page registered with no other page of its level: why, with the first page it was tried against.
      const reason = ordered.filter((page) => page.key !== root.key).map((page) =>
        outcomes.get(`${root.key}|${page.key}`) ?? outcomes.get(`${page.key}|${root.key}`)).find((entry) => entry !== undefined);
      registrations.push({ level, reference: root.key, page: root.key, registration: reason ?? { status: "unregistered", reason: "no_anchor" } });
      continue;
    }
    registrations.push({ level, reference: root.key, page: root.key, registration: { status: "reference" } });
    // Breadth first from the component's first page: each page in the frame of the page it was reached from.
    const queue = [root.key];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const from = queue[cursor];
      for (const link of links.get(from) ?? []) {
        if (component.has(link.page)) continue;
        component.set(link.page, root.key);
        transforms.set(link.page, composeTranslations(translation(link.dx, link.dy), transforms.get(from) as TakeoffFrameTransform));
        const [first, second] = [from, link.page].sort((left, right) => ordered.findIndex((page) => page.key === left)
          - ordered.findIndex((page) => page.key === right));
        registrations.push({ level, reference: from, page: link.page, registration: outcomes.get(`${first}|${second}`) as Registration });
        queue.push(link.page);
      }
    }
  }
  const direct = new Map([...links].flatMap(([from, list]) => list.map(({ page, dx, dy }): [string, TakeoffFrameTransform] =>
    [JSON.stringify([from, page]), translation(dx, dy)])));
  return { transforms, component, registrations, direct };
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
    registrations.push(...registered.registrations);
    // A page sharing no common frame with another page of its level has none to write.
    for (const page of levelPages) {
      const alone = !levelPages.some((other) => other.key !== page.key && registered.component.get(other.key) === registered.component.get(page.key));
      transforms.set(page.key, alone ? null : registered.transforms.get(page.key) ?? null);
    }

    // Pairs of lines that may be one run, on two pages: their common length.
    const pairs: DuplicatePair[] = [];
    // One coverage per line, partner and minimum, read by the pairs and by the length a line of a group shares.
    const coverage = new CoverageCache();
    // Two pages in one frame: through their own registration when they have one (the first page then is the frame),
    // otherwise in the frame of their component.
    const framesOf = (left: string, right: string): [TakeoffFrameTransform, TakeoffFrameTransform] => {
      const own = registered.direct.get(JSON.stringify([left, right]));
      return own ? [translation(0, 0), own]
        : [registered.transforms.get(left) as TakeoffFrameTransform, registered.transforms.get(right) as TakeoffFrameTransform];
    };
    const unregistered = new Set<string>();
    const sizes = new Map(levelLines.map((line) => [line.id, sizesOf(line.inputs)]));
    for (const [index, left] of levelLines.entries()) {
      for (const right of levelLines.slice(index + 1)) {
        if (left.page_key === right.page_key || !sameRun(left, right, sizes)) continue;
        if (left.is_excluded && right.is_excluded) continue;
        const [leftTransform, rightTransform] = [registered.transforms.get(left.page_key), registered.transforms.get(right.page_key)];
        const together = registered.component.get(left.page_key) === registered.component.get(right.page_key);
        if (!leftTransform || !rightTransform || !together) {
          // Two lines that could be one run, on pages with no common frame: « zones non recalées ».
          if (!right.is_excluded) unregistered.add(left.id);
          if (!left.is_excluded) unregistered.add(right.id);
          continue;
        }
        const minimum = minCommonLength([pages.get(left.page_key)?.denominator, pages.get(right.page_key)?.denominator]);
        const [leftFrame, rightFrame] = framesOf(left.page_key, right.page_key);
        const overlap = commonLength({ id: left.id, segments: left.geometry.segments_m }, leftFrame,
          { id: right.id, segments: right.geometry.segments_m }, rightFrame, minimum, coverage);
        // Every stretch it keeps reaches the minimum: its length, rounded to the millimetre, may read just under it.
        if (overlap > 0) pairs.push({ left: left.id, right: right.id, overlap_m: overlap });
      }
    }
    const byId = new Map(levelLines.map((line) => [line.id, line]));
    const overlapLine = (line: ZoneLine) => ({ id: line.id, segments: line.geometry.segments_m });
    const reduction = (line: ZoneLine) => Math.max(0, (line.geometry.length_m ?? line.inputs.model_quantity) - line.quantity);
    const pairsOf = new Map<string, Array<{ other: ZoneLine; overlap_m: number }>>();
    for (const pair of pairs) {
      for (const [id, other] of [[pair.left, pair.right], [pair.right, pair.left]]) {
        pairsOf.set(id, [...(pairsOf.get(id) ?? []), { other: byId.get(other) as ZoneLine, overlap_m: pair.overlap_m }]);
      }
    }
    // An excluded line counts nothing: only included lines are the other side of a pair.
    const partnersOf = (id: string) => (pairsOf.get(id) ?? []).filter(({ other }) => !other.is_excluded);
    // What partners cover of a line: with each partner, its continuous stretches of at least that pair's minimum.
    const coveredOf = (line: ZoneLine, partners: readonly ZoneLine[]) => coveredBy(overlapLine(line),
      partners.map((other) => ({ line: overlapLine(other), frames: framesOf(line.page_key, other.page_key),
        minimum: minCommonLength([pages.get(line.page_key)?.denominator, pages.get(other.page_key)?.denominator]) })), coverage);
    // Groups of duplicates: included lines joined by pairs.
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      let root = id;
      while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) as string;
      if (root !== id) parent.set(id, root);
      return root;
    };
    for (const pair of pairs) {
      if (byId.get(pair.left)?.is_excluded || byId.get(pair.right)?.is_excluded) continue;
      const [left, right] = [find(pair.left), find(pair.right)];
      if (left !== right) parent.set(left, right);
    }
    const groupSize = new Map<string, number>();
    for (const line of levelLines) {
      if (!line.is_excluded && partnersOf(line.id).length > 0) groupSize.set(find(line.id), (groupSize.get(find(line.id)) ?? 0) + 1);
    }
    /**
     * A line's group and whether it is counted once. A reduction says how much a line removed, never where: it settles
     * an isolated pair (settlePair), never a group of three lines or more, whose lines stay failed until each is
     * excluded or accepted; `overlap_m` is then what other lines draw of the line. An excluded line is shown as it
     * would stand if it came back, with its partners and their groups.
     */
    const outcomeOf = (line: ZoneLine, partners: ReturnType<typeof partnersOf>) => {
      const roots = new Set(partners.map(({ other }) => find(other.id)));
      const size = line.is_excluded ? 1 + [...roots].reduce((sum, root) => sum + (groupSize.get(root) ?? 1), 0) : groupSize.get(find(line.id)) ?? 1;
      if (size === 2) {
        const [{ other, overlap_m }] = partners;
        return { size, ...settlePair(overlap_m, [reduction(line), reduction(other)]) };
      }
      return { size, settled: false, deficit_m: coveredOf(line, partners.map(({ other }) => other)) };
    };

    for (const line of levelLines) {
      const zone = pages.get(line.page_key)?.zone ?? null;
      if (unregistered.has(line.id)) {
        push(results, line.id, result("zone_overlap", "fail", "ZONE_OVERLAP_UNREGISTERED",
          `Zones non recalées : les plans du niveau ${level} ne se superposent pas de façon fiable, un tronçon peut y être compté deux fois.`,
          { level }));
        continue;
      }
      const included = partnersOf(line.id);
      if (included.length === 0) {
        push(results, line.id, result("zone_overlap", "pass", "ZONE_OVERLAP_NONE",
          `Aucun tronçon commun avec une autre page du niveau ${level}.`, { level }));
        continue;
      }
      const outcome = outcomeOf(line, included);
      const partners: ZoneOverlapPartner[] = included.map(({ other, overlap_m }) => ({ item_id: other.id, job_id: other.job_id,
        zone: pages.get(other.page_key)?.zone ?? null, designation: other.designation, overlap_m, resolved: outcome.settled }))
        .sort((left, right) => right.overlap_m - left.overlap_m || byText(left.item_id, right.item_id));
      const where = partners.map((partner) => `${metres(partner.overlap_m)} avec « ${partner.designation} »${partner.zone ? ` (${partner.zone})` : ""}`).join(", ");
      if (outcome.settled) {
        push(results, line.id, result("zone_overlap", "pass", "ZONE_OVERLAP_RESOLVED",
          `Longueur commune avec ${partners.map((partner) => partner.zone ?? "une autre page").join(", ")} déjà retirée par les réductions des deux lignes.`,
          { level, partners }));
      } else if (outcome.size === 2) {
        push(results, line.id, result("zone_overlap", "fail", "ZONE_OVERLAP_DUPLICATE",
          `Tronçon compté aussi sur une autre page du niveau ${level}${zone ? ` que ${zone}` : ""} : ${where}. La version compte encore ${metres(outcome.deficit_m)} deux fois : ${included[0].other.frozen && !line.frozen
            ? `retirez cette longueur de cette ligne (« ${included[0].other.designation} » est dans un job appliqué), ou excluez-la si elle est entièrement en double.`
            : "retirez cette longueur d’une des lignes, ou excluez une ligne entièrement en double."}`,
          { level, partners, overlap_m: outcome.deficit_m }));
      } else {
        push(results, line.id, result("zone_overlap", "fail", "ZONE_OVERLAP_DUPLICATE",
          `Tronçon compté aussi sur d’autres pages du niveau ${level}${zone ? ` que ${zone}` : ""} : ${where}, soit ${metres(outcome.deficit_m)} de cette ligne. ${outcome.size} lignes se recouvrent : une correction de quantité ne règle pas un groupe de plus de deux lignes. Excluez chaque ligne entièrement en double, ou acceptez (V) chaque ligne une fois vérifiée.`,
          { level, partners, overlap_m: outcome.deficit_m, group_size: outcome.size }));
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
