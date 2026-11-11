import { scoredUnit } from "@/lib/takeoff/bench/item-keys";
import { MATERIALS, NETWORKS } from "@/lib/takeoff/bench/keys";
import { surfaceBasis, type SurfaceBasis } from "@/lib/takeoff/quantity-policy";
import { areaQuantityContexts, expectedSurfaceBasis, type AreaQuantityContext } from "@/lib/takeoff/rules/area-context";
import { DIAMETER_FAMILIES, findDiameterEntries, hasDiameterSeries, sameSizeWithoutSeries } from "@/lib/takeoff/bench/diameters";
import { ZONE_OVERLAP_DIFFERENCE_LABELS } from "@/lib/takeoff/rules/labels";
import {
  NETWORK_DIAMETER_TABLE_VERSION,
  WRAPPING_MATERIALS,
  checkNetworkDiameter,
  findNetworkDiameterEntries,
} from "@/lib/takeoff/rules/network-diameters";
import {
  REGISTRATION_VERSION,
  composeTranslations,
  confirmTranslation,
  registerPages,
  translation,
  type PageAnchors,
  type Registration,
} from "@/lib/takeoff/rules/registration";
import {
  ROOM_RULES_VERSION,
  AREA_PRINTED_RULE_VERSION,
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
  ZoneOverlapDifference,
  ZoneOverlapPartner,
} from "@/lib/takeoff/rules/types";
import {
  ZONE_OVERLAP_VERSION,
  CoverageCache,
  commonLength,
  coveredBy,
  minCommonLength,
  restCoverage,
  restOf,
  settlePair,
  stretchLength,
  type Centreline,
  type DuplicatePair,
  type RestLine,
  type Stretch,
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
// - Copies read differently (TI-684): two lines of one kind drawn at one place
//   on two pages are a pair whatever their network, material and DN, unless
//   each has its copy of the same reading there; the partner says what differs.
// - Versions: each result carries the version of its rule, which moves with
//   its thresholds or reference table.

export const TAKEOFF_RULE_VERSIONS: Record<TakeoffRuleId, number> = {
  dn_network: NETWORK_DIAMETER_TABLE_VERSION,
  zone_overlap: ZONE_OVERLAP_VERSION * 100 + REGISTRATION_VERSION,
  // 2 (TI-686 D9): V needs a coded reason and what was checked; a new version reopens every earlier V without them.
  scale_dimension: 2,
  area_printed: AREA_PRINTED_RULE_VERSION,
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
  /** A user attested the line's current quantity with its category (TI-686 D12): a quantity to enter is entered. */
  quantity_entered?: boolean;
  /** Actual estimate line, assigned server-side from the DPGF links or a unique exact match. */
  quantity_line_key?: string;
  quantity_line_reference?: number;
  expected_surface_basis?: SurfaceBasis | null;
  inputs: TakeoffRuleInputs | null;
  /** Vector geometry in page metres (TI-662); a filled room's holes (TI-677): what its floor leaves out inside its polygon. */
  geometry: { segments_m: readonly Centreline[]; polygon_m: readonly number[] | null; holes_m?: ReadonlyArray<readonly number[]> | null;
    length_m: number | null; area_m2: number | null } | null;
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
    if (outer.status === "compatible" || outer.status === "requires_justification") check = outer;
  }
  const name = `${networkLabel(network)} (${NETWORKS[network].label.toLowerCase()})`;
  // PE gas keeps its qualified installation requirement even when the diameter is missing or outside the series.
  // A stable code survives result bounding and is read identically by the UI, API and database trigger.
  if (network === "GAZ" && inputs.material === "pehd") {
    const diameter = check.status === "dn_missing" ? " Diamètre non lu : système à préciser."
      : check.status === "dn_not_in_series" ? " Diamètre hors série : système à justifier." : "";
    return result("dn_network", "fail", "DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION",
      `PE gaz : justifier une pose enterrée à l’extérieur hors emprise du bâtiment, ou une remontée en façade jusqu’au raccord métal/plastique.${diameter}`, details);
  }
  switch (check.status) {
    case "blocked":
      return result("dn_network", "fail", "DN_NETWORK_MATERIAL_BLOCKED", check.reason, details, false);
    case "requires_justification":
      return result("dn_network", "fail", "DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION", check.reason, details);
    case "compatible":
      return result("dn_network", "pass", "DN_NETWORK_COMPATIBLE",
        `${inputs.dn} en ${materialLabel(inputs.material as string).toLowerCase()} compatible avec le réseau ${name}.`, details);
    case "material_missing":
      return result("dn_network", "fail", "DN_NETWORK_MATERIAL_MISSING",
        `Matériau non lu : le DN ne peut pas être contrôlé pour le réseau ${name}.`, details);
    // D18b: the couple's condition stands beside the DN to fix. The code stays the same and a reason is no part of the
    // failure key; the keys change with the table version (v3, network-diameters.ts), not with this reason.
    case "dn_missing":
      return result("dn_network", "fail", "DN_NETWORK_DN_MISSING",
        `DN non lu (aucun ou deux) pour le réseau ${name}.${check.condition ? ` ${check.condition}` : ""}`, details);
    case "material_not_allowed":
      return result("dn_network", "fail", "DN_NETWORK_MATERIAL_NOT_ALLOWED",
        `${materialLabel(inputs.material as string)} n’est pas admis pour le réseau ${name}.`,
        { ...details, allowed_materials: [...check.allowed] });
    case "dn_not_in_series": {
      const standards = check.families.map((family) => DIAMETER_FAMILIES[family].standard).join(", ");
      return result("dn_network", "fail", "DN_NETWORK_DN_NOT_IN_SERIES",
        `${inputs.dn} n’existe pas en ${materialLabel(inputs.material as string).toLowerCase()}${standards ? ` (${standards})` : ""}.`
          + (check.condition ? ` ${check.condition}` : ""), details);
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
  // A quantity a user attested with what it rests on (TI-686 D12), even equal to the model's, is entered; a bare edit
  // is not. Verifying never settles it. The version stays 1: a line edited without a category fails again with a key
  // of its own, and V never accepted it.
  if (line.quantity_entered === true) {
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

function areaPrinted(line: RuleLine, inputs: TakeoffRuleInputs, context: AreaQuantityContext | undefined,
  page: RulePage | undefined): TakeoffRuleResult | null {
  if (inputs.kind !== "surface" || inputs.printed_m2 === null || inputs.printed_m2 === undefined || inputs.printed_m2 <= 0) return null;
  const printed = inputs.printed_m2;
  const measured = line.geometry?.area_m2 ?? inputs.model_quantity;
  const deviation = Math.round(((measured - printed) / printed) * 10_000) / 10_000;
  const printedBasis = surfaceBasis(inputs.room ?? "");
  const expectedBasis = expectedSurfaceBasis(line);
  // The basis the price line expects: the acceptance compares it with the basis the user recognizes to the printed
  // surface (TI-686 D9). It is already part of the compared context (quantity_context_key, area-context.ts), so copying
  // it here changes no key; the declared basis (retained_basis) enters neither.
  const details = { printed_m2: printed, measured_m2: measured, deviation,
    ...(expectedBasis ? { expected_basis: expectedBasis } : {}),
    ...(context ? { quantity_context_key: context.key } : {}) };
  if (!printedBasis || !expectedBasis) return result("area_printed", "fail", "AREA_PRINTED_MISMATCH",
    "Base de la surface imprimée ou de la prestation inconnue : confirmez la base avant de comparer les quantités.",
    { ...details, cause: "basis_unknown" });
  if (printedBasis !== expectedBasis || expectedBasis !== "net_floor") return result("area_printed", "fail", "AREA_PRINTED_MISMATCH",
    "La surface imprimée et le contour mesuré ne portent pas sur la même base : SHAB et sol net ne sont pas interchangeables.",
    { ...details, cause: "basis_mismatch" });
  if (!page?.scale || page.scale.status === "unverified") return result("area_printed", "fail", "AREA_PRINTED_MISMATCH",
    "Échelle non vérifiée : confirmez la mesure avant de comparer les surfaces.", { ...details, cause: "scale_unverified" });
  const policy = context?.policy;
  const text = `${squareMetres(measured)} mesurés pour ${squareMetres(printed)} imprimés dans ${roomLabel(inputs)} (${percent(deviation)}).`;
  return policy && !policy.requiresReview
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
  type Floor = { line: RuleLine; points: Array<[number, number]>; holes: Array<Array<[number, number]>>; area: number };
  const byPage = new Map<string, Floor[]>();
  for (const line of lines) {
    if (line.inputs?.kind !== "surface" || line.page_key === null || !line.geometry?.polygon_m) continue;
    const points = polygonPoints(line.geometry.polygon_m);
    if (points.length < 3) continue;
    // A filled floor's holes are not its floor: a room around another room does not overlap it (TI-677).
    const holes = (line.geometry.holes_m ?? []).map(polygonPoints).filter((hole) => hole.length >= 3);
    const entries = byPage.get(line.page_key) ?? [];
    entries.push({ line, points, holes, area: line.geometry.area_m2 ?? line.quantity });
    byPage.set(line.page_key, entries);
  }
  for (const entries of byPage.values()) {
    for (const entry of entries) {
      const overlaps: Array<{ id: string; area: number }> = [];
      for (const other of entries) {
        if (other === entry || other.line.is_excluded) continue;
        const shared = sharedArea(entry.points, other.points, entry.holes, other.holes);
        if (roomsOverlap(shared, entry.area, other.area)) overlaps.push({ id: other.line.id, area: shared });
      }
      const total = Math.round(overlaps.reduce((sum, overlap) => sum + overlap.area, 0) * 1000) / 1000;
      push(results, entry.line.id, overlaps.length === 0
        ? result("room_overlap", "pass", "ROOM_OVERLAP_NONE", "Aucune autre pièce de la page ne recouvre ce contour.")
        : result("room_overlap", "fail", "ROOM_OVERLAP",
          `Ce contour recouvre ${overlaps.length} autre${overlaps.length > 1 ? "s" : ""} pièce${overlaps.length > 1 ? "s" : ""} de la page sur ${squareMetres(total)}.`,
          { overlapping_item_ids: overlaps.map((overlap) => overlap.id), overlap_count: overlaps.length, overlap_m2: total }));
    }
  }
}

type ZoneLine = RuleLine & { inputs: TakeoffRuleInputs; geometry: NonNullable<RuleLine["geometry"]>; page_key: string };

/**
 * Sizes a line's DN names, as entries of the diameter table (family and outer diameter), through the series its
 * material is read in on its network, as the DN rule reads them (TI-684: stainless drainage in NF EN 1124); a vector
 * size reads either way (« DN 100 » or « Ø 110 » of one cast-iron or stainless drainage pipe).
 */
function sizesOf(inputs: TakeoffRuleInputs): Set<string> {
  if (inputs.dn === null) return new Set();
  const { network, material } = inputs;
  const entries = findNetworkDiameterEntries(inputs.dn, network, material);
  if (inputs.source === "vector" && inputs.dn.startsWith("DN ")) entries.push(...findNetworkDiameterEntries(`Ø ${inputs.dn.slice(3)}`, network, material));
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

/** A material and its unspecified grade (« inox » beside « inox 316L ») do not contradict each other. */
const UNSPECIFIED_GRADES: Partial<Record<string, readonly string[]>> = {
  inox: ["inox-304l", "inox-316l"],
  acier: ["acier-noir", "acier-galvanise"],
};

/**
 * What two lines that are not one run (sameRun) read differently (TI-684): the network, the material (both read, and
 * neither the unspecified grade of the other), the size as printed. Never empty: two lines that are not one run differ.
 */
function readingDifferences(left: TakeoffRuleInputs, right: TakeoffRuleInputs): ZoneOverlapDifference[] {
  const differs: ZoneOverlapDifference[] = [];
  if (left.network !== right.network) differs.push("network");
  const [l, r] = [left.material, right.material];
  if (l !== null && r !== null && l !== r && !UNSPECIFIED_GRADES[l]?.includes(r) && !UNSPECIFIED_GRADES[r]?.includes(l)) differs.push("material");
  if (left.dn !== right.dn) differs.push("dn");
  return differs.length > 0 ? differs : [left.material !== right.material ? "material" : "dn"];
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

/** Pages without lines of a level tried as overviews, in page order (each pair of them costs a registration). */
const OVERVIEWS_MAX = 8;

/**
 * Pairs of pages with lines that registration left in separate components, joined through the level's pages without
 * lines (TI-677: an overview printing both zones' texts). The overviews only propose: the translation composed
 * through them is confirmed on the two pages' own building lines (confirmTranslation), which refines it, so an
 * overview drawn slightly off scale never carries its error over. Pages already in one component keep their own
 * frames. `direct` holds each confirmed pair both ways, as registerLevel's `direct` does.
 */
function joinThroughOverviews(level: string, linePages: readonly RulePage[], registered: ReturnType<typeof registerLevel>,
  pages: ReadonlyMap<string, RulePage>) {
  const direct = new Map<string, TakeoffFrameTransform>();
  const registrations: LevelRegistration[] = [];
  const anchored = linePages.filter((page) => page.anchors !== null);
  const split = anchored.flatMap((left, index) => anchored.slice(index + 1)
    .filter((right) => registered.component.get(left.key) !== registered.component.get(right.key)).map((right) => [left, right] as const));
  if (split.length === 0) return { direct, registrations };
  const overviews = [...pages.values()].filter((page) => page.level === level && page.anchors !== null
    && !linePages.some((other) => other.key === page.key))
    .sort((left, right) => left.order - right.order || byText(left.key, right.key)).slice(0, OVERVIEWS_MAX);
  if (overviews.length === 0) return { direct, registrations };
  const through = registerLevel(level, [...anchored, ...overviews]);
  for (const [left, right] of split) {
    const [leftFrame, rightFrame] = [through.transforms.get(left.key), through.transforms.get(right.key)];
    if (through.component.get(left.key) !== through.component.get(right.key) || !leftFrame || !rightFrame) continue;
    // Right's metres into left's frame, through the overviews: x_left = x_right + (T_right − T_left).
    const outcome = confirmTranslation(left.anchors as PageAnchors, right.anchors as PageAnchors, rightFrame[4] - leftFrame[4],
      rightFrame[5] - leftFrame[5]);
    registrations.push({ level, reference: left.key, page: right.key, registration: outcome });
    if (outcome.status !== "registered") continue;
    direct.set(JSON.stringify([left.key, right.key]), translation(outcome.dx, outcome.dy));
    direct.set(JSON.stringify([right.key, left.key]), translation(-outcome.dx, -outcome.dy));
  }
  return { direct, registrations };
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
    // Two pages with lines left in separate components may be joined through pages without lines (an overview: TI-677).
    const joined = joinThroughOverviews(level, levelPages, registered, pages);
    registrations.push(...joined.registrations);
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
      const own = registered.direct.get(JSON.stringify([left, right])) ?? joined.direct.get(JSON.stringify([left, right]));
      return own ? [translation(0, 0), own]
        : [registered.transforms.get(left) as TakeoffFrameTransform, registered.transforms.get(right) as TakeoffFrameTransform];
    };
    const unregistered = new Set<string>();
    const sizes = new Map(levelLines.map((line) => [line.id, sizesOf(line.inputs)]));
    const overlapLine = (line: ZoneLine) => ({ id: line.id, segments: line.geometry.segments_m });
    const minimumOf = (left: string, right: string) => minCommonLength([pages.get(left)?.denominator, pages.get(right)?.denominator]);
    const together = (left: string, right: string) => Boolean(registered.transforms.get(left) && registered.transforms.get(right))
      && (registered.component.get(left) === registered.component.get(right) || joined.direct.has(JSON.stringify([left, right])));
    for (const [index, left] of levelLines.entries()) {
      for (const right of levelLines.slice(index + 1)) {
        if (left.page_key === right.page_key || !sameRun(left, right, sizes)) continue;
        if (left.is_excluded && right.is_excluded) continue;
        if (!together(left.page_key, right.page_key)) {
          // Two lines that could be one run, on pages with no common frame: « zones non recalées ».
          if (!right.is_excluded) unregistered.add(left.id);
          if (!left.is_excluded) unregistered.add(right.id);
          continue;
        }
        const [leftFrame, rightFrame] = framesOf(left.page_key, right.page_key);
        const overlap = commonLength(overlapLine(left), leftFrame, overlapLine(right), rightFrame, minimumOf(left.page_key, right.page_key), coverage);
        // Every stretch it keeps reaches the minimum: its length, rounded to the millimetre, may read just under it.
        if (overlap > 0) pairs.push({ left: left.id, right: right.id, overlap_m: overlap });
      }
    }
    // Copies read differently (TI-684): two lines of one kind that are not one run, drawn at one place on two pages.
    // Compared only where the plans share a frame: without one, nothing says they are drawn at one place (« zones non
    // recalées » stays for lines that could be one run). `differences`: what each such pair reads differently;
    // `contradicted`: of each line, the stretches the other draws, which the length a line of a group shares reads too.
    const differences = new Map<string, ZoneOverlapDifference[]>();
    const contradicted = new Map<string, Map<string, Stretch[]>>();
    const pairKey = (left: string, right: string) => JSON.stringify([left, right]);
    const linesOf = new Map<string, ZoneLine[]>();
    for (const line of levelLines) linesOf.set(line.page_key, [...(linesOf.get(line.page_key) ?? []), line]);
    for (const [index, leftPage] of levelPages.entries()) {
      for (const rightPage of levelPages.slice(index + 1)) {
        if (!together(leftPage.key, rightPage.key)) continue;
        const [lefts, rights] = [linesOf.get(leftPage.key) ?? [], linesOf.get(rightPage.key) ?? []];
        const compared = (left: ZoneLine, right: ZoneLine) => left.inputs.kind === right.inputs.kind
          && !(left.is_excluded && right.is_excluded) && !sameRun(left, right, sizes);
        const frames = framesOf(leftPage.key, rightPage.key);
        const minimum = minimumOf(leftPage.key, rightPage.key);
        // A line less what the lines of its own reading draw of it on the other page, excluded or not (an exclusion
        // settles a quantity, the run is still drawn there): what is left has no copy of its reading on that page.
        const restsOf = (lines: readonly ZoneLine[], others: readonly ZoneLine[], own: TakeoffFrameTransform, other: TakeoffFrameTransform) =>
          lines.map((line): RestLine => (others.some((candidate) => compared(line, candidate))
            ? restOf(overlapLine(line), others.filter((twin) => sameRun(line, twin, sizes))
              .flatMap((twin) => coverage.of(overlapLine(line), own, overlapLine(twin), other, minimum)))
            : { id: line.id, segments: [], origin: [] }));
        const [leftRests, rightRests] = [restsOf(lefts, rights, frames[0], frames[1]), restsOf(rights, lefts, frames[1], frames[0])];
        const forward = restCoverage(leftRests, frames[0], rightRests, frames[1], minimum, (left, right) => compared(lefts[left], rights[right]));
        if (forward.size === 0) continue;
        const backward = restCoverage(rightRests, frames[1], leftRests, frames[0], minimum, (right, left) => compared(lefts[left], rights[right]));
        for (const [left, byRight] of forward) {
          for (const [right, stretches] of byRight) {
            const back = backward.get(right)?.get(left) ?? [];
            const overlap = Math.min(stretchLength(stretches), stretchLength(back));
            if (!(overlap > 0)) continue;
            const [leftLine, rightLine] = [lefts[left], rights[right]];
            pairs.push({ left: leftLine.id, right: rightLine.id, overlap_m: overlap });
            differences.set(pairKey(leftLine.id, rightLine.id), readingDifferences(leftLine.inputs, rightLine.inputs));
            contradicted.set(leftLine.id, new Map(contradicted.get(leftLine.id) ?? []).set(rightLine.id, stretches));
            contradicted.set(rightLine.id, new Map(contradicted.get(rightLine.id) ?? []).set(leftLine.id, back));
          }
        }
      }
    }
    const byId = new Map(levelLines.map((line) => [line.id, line]));
    const differsOf = (line: string, other: string) => differences.get(pairKey(line, other)) ?? differences.get(pairKey(other, line));
    const reduction = (line: ZoneLine) => Math.max(0, (line.geometry.length_m ?? line.inputs.model_quantity) - line.quantity);
    const pairsOf = new Map<string, Array<{ other: ZoneLine; overlap_m: number }>>();
    for (const pair of pairs) {
      for (const [id, other] of [[pair.left, pair.right], [pair.right, pair.left]]) {
        pairsOf.set(id, [...(pairsOf.get(id) ?? []), { other: byId.get(other) as ZoneLine, overlap_m: pair.overlap_m }]);
      }
    }
    // An excluded line counts nothing: only included lines are the other side of a pair.
    const partnersOf = (id: string) => (pairsOf.get(id) ?? []).filter(({ other }) => !other.is_excluded);
    // What partners cover of a line: with each partner, its continuous stretches of at least that pair's minimum; with
    // a copy read differently, the stretches no line of the same reading explains.
    const coveredOf = (line: ZoneLine, partners: readonly ZoneLine[]) => coveredBy(overlapLine(line),
      partners.filter((other) => !contradicted.get(line.id)?.has(other.id)).map((other) => ({ line: overlapLine(other),
        frames: framesOf(line.page_key, other.page_key), minimum: minimumOf(line.page_key, other.page_key) })), coverage,
      partners.flatMap((other) => contradicted.get(line.id)?.get(other.id) ?? []));
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
      const partners: ZoneOverlapPartner[] = included.map(({ other, overlap_m }) => {
        const differs = differsOf(line.id, other.id);
        return { item_id: other.id, job_id: other.job_id, zone: pages.get(other.page_key)?.zone ?? null, designation: other.designation,
          overlap_m, resolved: outcome.settled, ...(differs ? { differs } : {}) };
      }).sort((left, right) => right.overlap_m - left.overlap_m || byText(left.item_id, right.item_id));
      const where = partners.map((partner) => `${metres(partner.overlap_m)} avec « ${partner.designation} »${partner.zone ? ` (${partner.zone})` : ""}${
        partner.differs ? `, lu autrement (${partner.differs.map((difference) => ZONE_OVERLAP_DIFFERENCE_LABELS[difference]).join(", ")})` : ""}`).join(", ");
      const readDifferently = partners.some((partner) => partner.differs);
      if (outcome.settled) {
        push(results, line.id, result("zone_overlap", "pass", "ZONE_OVERLAP_RESOLVED",
          `Longueur commune avec ${partners.map((partner) => partner.zone ?? "une autre page").join(", ")} déjà retirée par les réductions des deux lignes.`,
          { level, partners }));
      } else if (outcome.size === 2 && readDifferently) {
        // One run counted twice with a wrong reading, or two pipes drawn over each other: the rule cannot tell.
        push(results, line.id, result("zone_overlap", "fail", "ZONE_OVERLAP_DUPLICATE",
          `Tronçon dessiné au même endroit sur une autre page du niveau ${level}${zone ? ` que ${zone}` : ""} : ${where}. Si c’est le même tronçon, la version compte encore ${metres(outcome.deficit_m)} deux fois et l’une des deux lectures est fausse : ${included[0].other.frozen && !line.frozen
            ? `retirez cette longueur de cette ligne (« ${included[0].other.designation} » est dans un job appliqué), ou excluez-la si elle est mal lue.`
            : "retirez cette longueur d’une des lignes, ou excluez la ligne mal lue."} Si ce sont deux tuyaux distincts, acceptez (V) chaque ligne une fois vérifiée.`,
          { level, partners, partner_count: partners.length, overlap_m: outcome.deficit_m }));
      } else if (outcome.size === 2) {
        push(results, line.id, result("zone_overlap", "fail", "ZONE_OVERLAP_DUPLICATE",
          `Tronçon compté aussi sur une autre page du niveau ${level}${zone ? ` que ${zone}` : ""} : ${where}. La version compte encore ${metres(outcome.deficit_m)} deux fois : ${included[0].other.frozen && !line.frozen
            ? `retirez cette longueur de cette ligne (« ${included[0].other.designation} » est dans un job appliqué), ou excluez-la si elle est entièrement en double.`
            : "retirez cette longueur d’une des lignes, ou excluez une ligne entièrement en double."}`,
          { level, partners, partner_count: partners.length, overlap_m: outcome.deficit_m }));
      } else {
        push(results, line.id, result("zone_overlap", "fail", "ZONE_OVERLAP_DUPLICATE",
          `Tronçon compté aussi sur d’autres pages du niveau ${level}${zone ? ` que ${zone}` : ""} : ${where}, soit ${metres(outcome.deficit_m)} de cette ligne. ${outcome.size} lignes se recouvrent : une correction de quantité ne règle pas un groupe de plus de deux lignes. Excluez chaque ligne entièrement en double, ou acceptez (V) chaque ligne une fois vérifiée.${
            readDifferently ? " Une copie lue autrement est soit le même tronçon mal lu, soit un autre tuyau dessiné au même endroit." : ""}`,
          { level, partners, partner_count: partners.length, overlap_m: outcome.deficit_m, group_size: outcome.size }));
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
  const areaContexts = areaQuantityContexts(input.lines, pages);
  const results = new Map<string, TakeoffRuleResult[]>();
  for (const line of input.lines) {
    if (!line.inputs) continue;
    const page = line.page_key === null ? undefined : pages.get(line.page_key);
    for (const entry of [nonObservable(line, line.inputs), dnNetwork(line.inputs), scaleDimension(line, line.inputs, page),
      areaPrinted(line, line.inputs, areaContexts.get(line.id), page), closedBox(line, line.inputs)]) {
      if (entry) push(results, line.id, entry);
    }
  }
  roomOverlaps(input.lines, results);
  const zone = zoneOverlaps(input.lines, pages, results);
  for (const list of results.values()) list.sort((left, right) => (RULE_ORDER.get(left.rule) ?? 9) - (RULE_ORDER.get(right.rule) ?? 9));
  return { results, transforms: zone.transforms, registrations: zone.registrations };
}
