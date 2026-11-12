import "server-only";

import { AssistantToolError } from "@/lib/assistant/loop";
import { ESTIMATE_V3_STATUS_DOCUMENT_LABELS } from "@/lib/estimates/v3-document-presentation";
import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";

/**
 * An estimate as the assistant reads it. Every amount comes from the calculation
 * engines or from the frozen columns of an issued version: nothing here derives a
 * price. Amounts leave formatted in the estimate's own currency, so that the model
 * never converts cents nor assumes euros.
 */
export type EstimateReadingAmounts = {
  puHtCents: number | null;
  /** The line total the editor and the document show: before the discount and the commercial rounding are spread. */
  totalHtCents: number;
  /** After they are spread: what adds up to the sections and the footer. Same as the total without discount. */
  netHtCents: number;
  costHtCents: number | null;
  /** Supply and labour shares of the shown total. */
  foHtCents: number | null;
  moHtCents: number | null;
  hours: string | null;
};

export type EstimateReadingNode = {
  id: string;
  parentId: string | null;
  type: "section" | "line";
  title: string;
  position: number;
  line: null | {
    quantity: number | null;
    unit: string | null;
    /** `priced`, `not_priced`, `included`… Null on the engines that have no status: the line is priced. */
    pricingStatus: string | null;
    description: string | null;
    /** Where the line comes from (import, takeoff, file and page), when known. */
    source: string | null;
    inputs: {
      unitPriceHtCents: number | null; kFo: number | null; hMoPerUnit: number | null; hMo: number | null;
      kMo: number | null; taxRateBp: number | null;
    };
    /** Null when the line carries no amount: any status other than priced, or a draft the engine refuses. */
    amounts: EstimateReadingAmounts | null;
    /** Engine 3 only: the supply cost factor by factor, with the single visible K FO. */
    foCostText: string | null;
  };
};

export type EstimateReading = {
  version: {
    id: string; label: string; title: string | null; status: string; engine: number;
    currency: SupportedEstimateCurrency;
    amountsBasis: "draft_calculation" | "frozen";
  };
  params: Record<string, string | number | boolean | null>;
  totals: {
    grossHtCents: number | null; discountCents: number | null; roundingCents: number | null;
    totalHtCents: number | null; totalTaxCents: number | null; totalTtcCents: number | null; costHtCents: number | null;
  };
  warnings: string[];
  nodes: EstimateReadingNode[];
};

const LINES_PAGE = 80;
const SECTIONS_LISTED = 200;
const NOT_PRICED = "not_priced";

type Money = (cents: number | null | undefined) => string | null;

/** Amounts of one estimate, written in its currency (with plain spaces, as the model and the tests read them). */
function moneyOf(reading: EstimateReading): Money {
  const { currency } = reading.version;
  return (cents) => cents === null || cents === undefined ? null : formatCurrency(cents, currency).replace(/[\u00a0\u202f]/g, " ");
}

function signed(money: Money, cents: number) {
  return `${cents > 0 ? "+" : ""}${money(cents)}`;
}

function fold(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The status in the estimator's words (« Inclus », « Pour mémoire »…), as the grid and the document print it. */
function statusLabel(status: string | null) {
  if (status === null) return "Chiffrée";
  return (ESTIMATE_V3_STATUS_DOCUMENT_LABELS as Record<string, string>)[status] ?? status;
}

/** The nodes in the estimate's reading order (depth first, siblings by position), with each node's section path. */
function walk(reading: EstimateReading) {
  const children = new Map<string | null, EstimateReadingNode[]>();
  const known = new Set(reading.nodes.map((node) => node.id));
  for (const node of reading.nodes) {
    // A node whose parent is missing is read at the root rather than dropped.
    const parent = node.parentId !== null && known.has(node.parentId) ? node.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const ordered: Array<{ node: EstimateReadingNode; path: string[] }> = [];
  const visit = (parent: string | null, path: string[], depth: number) => {
    if (depth > 64) return;
    const siblings = (children.get(parent) ?? []).sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
    for (const node of siblings) {
      ordered.push({ node, path });
      if (node.type === "section") visit(node.id, [...path, node.title], depth + 1);
    }
  };
  visit(null, [], 0);
  return ordered;
}

function linesUnder(ordered: ReturnType<typeof walk>, sectionId: string | null) {
  if (sectionId === null) return ordered.filter((entry) => entry.node.type === "line");
  const start = ordered.findIndex((entry) => entry.node.id === sectionId && entry.node.type === "section");
  if (start === -1) throw new AssistantToolError("Section introuvable dans ce devis.");
  const depth = ordered[start]!.path.length;
  const lines: typeof ordered = [];
  for (const entry of ordered.slice(start + 1)) {
    if (entry.path.length <= depth) break;
    if (entry.node.type === "line") lines.push(entry);
  }
  return lines;
}

function versionSummary(reading: EstimateReading) {
  return {
    id: reading.version.id, version: reading.version.label, titre: reading.version.title, statut: reading.version.status,
    moteur_de_calcul: reading.version.engine, devise: reading.version.currency,
    montants: reading.version.amountsBasis === "frozen" ? "montants figés à l’émission" : "calcul du brouillon en cours",
  };
}

/** Each section with the sum of the engine's net line totals below it, sub-sections included. */
function sectionTotals(reading: EstimateReading, ordered = walk(reading)) {
  return ordered.filter((entry) => entry.node.type === "section").map((entry) => {
    const lines = linesUnder(ordered, entry.node.id);
    return {
      id: entry.node.id, path: [...entry.path, entry.node.title].join(" > "), lines: lines.length,
      unpriced: lines.filter((item) => item.node.line?.pricingStatus === NOT_PRICED).length,
      netHtCents: lines.reduce((sum, item) => sum + (item.node.line?.amounts?.netHtCents ?? 0), 0),
    };
  });
}

/** Whether the footer is known: a draft the engine refuses has no amount to show or compare. */
function isComputed(reading: EstimateReading) {
  return reading.totals.totalHtCents !== null;
}

/** The estimate at a glance: settings, footer totals, and each section with the lines below it. */
export function estimateOutline(reading: EstimateReading) {
  const money = moneyOf(reading);
  const ordered = walk(reading);
  const computed = isComputed(reading);
  const sections = sectionTotals(reading, ordered);
  const lines = ordered.filter((entry) => entry.node.type === "line");
  const spread = (reading.totals.discountCents ?? 0) !== 0 || (reading.totals.roundingCents ?? 0) !== 0;
  // Engine 3 shows a line before the discount is spread on it; the older engines show it already net.
  const linesBeforeDiscount = lines.some((entry) => {
    const amounts = entry.node.line?.amounts;
    return amounts != null && amounts.netHtCents !== amounts.totalHtCents;
  });
  return {
    devis: versionSummary(reading),
    parametres: reading.params,
    totaux: {
      total_brut_ht: money(reading.totals.grossHtCents), remise: money(reading.totals.discountCents),
      arrondi_commercial: money(reading.totals.roundingCents), total_ht: money(reading.totals.totalHtCents),
      tva: money(reading.totals.totalTaxCents), total_ttc: money(reading.totals.totalTtcCents),
      debourse_ht: money(reading.totals.costHtCents),
    },
    ...(spread ? {
      note: linesBeforeDiscount
        ? "Une remise ou un arrondi commercial s’applique : le total d’une ligne est affiché avant, les totaux de section et le total HT après."
        : "Une remise ou un arrondi commercial s’applique : les totaux de ligne, de section et le total HT sont déjà nets.",
    } : {}),
    avertissements: reading.warnings,
    sections: sections.slice(0, SECTIONS_LISTED).map((entry) => ({
      id: entry.id, chemin: entry.path, lignes: entry.lines, lignes_non_chiffrees: entry.unpriced,
      total_ht: computed ? money(entry.netHtCents) : null,
    })),
    sections_non_listees: Math.max(0, sections.length - SECTIONS_LISTED),
    lignes: lines.length,
    lignes_non_chiffrees: lines.filter((entry) => entry.node.line?.pricingStatus === NOT_PRICED).length,
    lignes_hors_section: lines.filter((entry) => entry.path.length === 0).length,
  };
}

/** Lines of the estimate or of one section, by pages, optionally filtered on their designation or kept to the unpriced ones. */
export function estimateLines(reading: EstimateReading, options: {
  sectionId?: string; search?: string; offset?: number; unpricedOnly?: boolean;
}) {
  const money = moneyOf(reading);
  const search = options.search ? fold(options.search.trim()) : "";
  const matching = linesUnder(walk(reading), options.sectionId ?? null)
    .filter((entry) => !search || fold(entry.node.title).includes(search))
    .filter((entry) => !options.unpricedOnly || entry.node.line?.pricingStatus === NOT_PRICED);
  const offset = Math.max(0, options.offset ?? 0);
  const page = matching.slice(offset, offset + LINES_PAGE);
  return {
    devis: versionSummary(reading),
    lignes: page.map(({ node, path }) => ({
      id: node.id, section: path.join(" > "), designation: node.title, quantite: node.line?.quantity ?? null,
      unite: node.line?.unit ?? null, statut: statusLabel(node.line?.pricingStatus ?? null),
      pu_ht: money(node.line?.amounts?.puHtCents), total_ht: money(node.line?.amounts?.totalHtCents),
    })),
    lignes_restantes: Math.max(0, matching.length - offset - page.length),
  };
}

/** One line: what the estimator entered, what the engine computed from it, and where it sits. */
export function estimateLineDetail(reading: EstimateReading, lineId: string) {
  const entry = walk(reading).find((item) => item.node.id === lineId && item.node.type === "line");
  if (!entry?.node.line) throw new AssistantToolError("Ligne introuvable dans ce devis.");
  const { node, path } = entry;
  const line = entry.node.line;
  const amounts = line.amounts;
  const money = moneyOf(reading);
  return {
    devis: versionSummary(reading),
    id: node.id, section: path.join(" > "), designation: node.title, description: line.description,
    quantite: line.quantity, unite: line.unit, statut: statusLabel(line.pricingStatus), source: line.source,
    saisie: {
      prix_base_fo_ht: money(line.inputs.unitPriceHtCents),
      // One K FO is shown to the estimator: on engine 3 it is in the supply cost sentence, provision included.
      ...(line.foCostText === null ? { k_fo: line.inputs.kFo } : {}),
      heures_mo_par_unite: line.inputs.hMoPerUnit, heures_mo: line.inputs.hMo, k_mo: line.inputs.kMo,
      taux_tva: line.inputs.taxRateBp === null ? null : `${String(line.inputs.taxRateBp / 100).replace(".", ",")} %`,
    },
    calcul: amounts === null ? null : {
      pu_ht: money(amounts.puHtCents), total_ht: money(amounts.totalHtCents),
      ...(amounts.netHtCents === amounts.totalHtCents ? {} : { total_net_ht_apres_remise: money(amounts.netHtCents) }),
      debourse_ht: money(amounts.costHtCents), part_fo_ht: money(amounts.foHtCents), part_mo_ht: money(amounts.moHtCents),
      heures_mo: amounts.hours, detail_cout_fo: line.foCostText,
    },
  };
}

/**
 * Two versions of the same affaire, side by side: the difference of their totals
 * and the sections whose total differs or that exist in one version only,
 * matched by their path. The subtraction is done here, never by the model.
 */
export function compareEstimates(a: EstimateReading, b: EstimateReading) {
  const moneyA = moneyOf(a);
  const moneyB = moneyOf(b);
  const totalA = a.totals.totalHtCents;
  const totalB = b.totals.totalHtCents;
  // Amounts of two currencies are never subtracted, and a draft the engine refuses has nothing to compare.
  const sameCurrency = a.version.currency === b.version.currency;
  const comparable = sameCurrency && isComputed(a) && isComputed(b);
  // Sections that share a path (two « Divers » under one parent) are compared as one.
  const totalsByPath = (reading: EstimateReading) => {
    const totals = new Map<string, number>();
    for (const entry of sectionTotals(reading)) totals.set(entry.path, (totals.get(entry.path) ?? 0) + entry.netHtCents);
    return totals;
  };
  const left = totalsByPath(a);
  const right = totalsByPath(b);
  const different = !comparable ? [] : [...left.keys(), ...[...right.keys()].filter((path) => !left.has(path))].flatMap((path) => {
    const sectionA = left.get(path);
    const sectionB = right.get(path);
    if (sectionA !== undefined && sectionA === sectionB) return [];
    return [{
      chemin: path, total_ht_a: moneyA(sectionA), total_ht_b: moneyB(sectionB),
      ecart: sectionA === undefined || sectionB === undefined ? null : signed(moneyA, sectionB - sectionA),
    }];
  });
  return {
    devis_a: versionSummary(a), devis_b: versionSummary(b),
    avertissements_a: a.warnings, avertissements_b: b.warnings,
    note: sameCurrency ? null : "Les deux devis ne sont pas dans la même devise : aucun écart n’est calculé.",
    total_ht_a: moneyA(totalA), total_ht_b: moneyB(totalB),
    ecart_total_ht: !comparable || totalA === null || totalB === null ? null : signed(moneyA, totalB - totalA),
    sections_differentes: different.slice(0, 60),
    sections_differentes_non_listees: Math.max(0, different.length - 60),
  };
}
