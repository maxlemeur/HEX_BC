import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { checkGroupTruthFiles, formatBenchIssue } from "@/lib/takeoff/bench/check";
import { BenchDatasetError, filesSha256 } from "@/lib/takeoff/bench/dataset";
import { NETWORK_CODES, type NetworkCode } from "@/lib/takeoff/bench/keys";
import { GroupTruthFileSchema, type GroupTruthFile, type TakeoffBenchManifest } from "@/lib/takeoff/bench/schemas";
import { nearestRank, table } from "@/lib/takeoff/bench/vector-report";
import { CANDIDATE_FILTER_REASONS, type CandidateFilterReason } from "@/lib/takeoff/vectors/candidate-filter";
import { CLASSIFIED_DECISIONS_CONFIDENCE } from "@/lib/takeoff/vectors/classify";
import { PARENT_NETWORK } from "@/lib/takeoff/vectors/legend";

// The per-group score of a vector run (TI-704): how the run classed the groups
// of a private truth given apart (`takeoff:bench --group-truth <dir>`), never
// applied as correspondences (truth/groups of the dataset are the user's). The
// devis score cannot judge the classification: on the development plans, even
// a perfect class of every candidate gains no devis key.
// - The truth directory holds `<document id>.json` files of the truth/groups
//   schema, checked as truth/groups is (check.ts checkGroupTruthFiles), outside
//   the dataset: inside it, they would enter the dataset SHA and be read as the
//   user's correspondences. The report records the hash of its JSON files (the
//   dataset SHA's rule), never their content.
// - A truth group is judged on the run's final reading of its page: a network
//   class taken by the measure (any source; Decisions at 0.8 or more) is
//   « found », a Decisions network under 0.8 « proposed » (never measured);
//   exact, or at parent level (HW for HW-S, and HW-R for HW-S: both are HW). It
//   is « à revoir » when it has no class (a legend colour shared by networks
//   included, which the review leaves to the labels), or a Decisions class
//   under 0.8; a Decisions « autre » at 0.8 or more is decided. A group of a
//   page that failed, of a document a pass did not reach (another pass read
//   it), or that the reading no longer has, is « not read ».
// - The candidates the run recorded for each page (vector-run.ts): selected
//   for Decisions (a stopped run may not ask them all) or filtered with its
//   reason (candidate-filter.ts); a network filtered is lost to Decisions.
// - The Decisions answers on truth groups, by confidence band: network
//   proposals, exact and parent-level, on non-networks, the true networks of
//   the band and those answered a non-network class (« autre » apart). The
//   precision of a band is over its network proposals.
// - The cost is the run's, over every page it read: calls, tokens (of the calls
//   reporting usage), latency (sum per page, and per call p50 / p95).
// report.md prints counts and shares, never a group id, colour or class.

export const GROUP_SCORE_VERSION = 1;
const BANDS = [
  { band: "[0 ; 0,5[", from: 0 }, { band: "[0,5 ; 0,6[", from: 0.5 }, { band: "[0,6 ; 0,7[", from: 0.6 },
  { band: "[0,7 ; 0,8[", from: 0.7 }, { band: "[0,8 ; 1]", from: CLASSIFIED_DECISIONS_CONFIDENCE },
] as const;

/** The private truth of a run: by document, with the hash of its files. */
export type GroupTruthSet = { sha256: string; files: number; groups: number; documents: ReadonlyMap<string, GroupTruthFile> };

type ScoredGroup = { id: string; class: string | null; source: string | null; confidence: number | null };
type ScoredPage = {
  page: number;
  status: "ok" | "failed";
  reading: { groups: readonly ScoredGroup[] } | null;
  decisions?: {
    calls: ReadonlyArray<{ usage: { total_tokens: number } | null; latency_ms: number }>;
    answers: ReadonlyArray<{ group: string; class: string | null; confidence: number | null; status: string }>;
  } | null;
  candidates?: { selected: readonly string[]; eligible: number; left_out: number; filtered: ReadonlyArray<{ group: string; reason: CandidateFilterReason }> } | null;
};
/** What the score reads of a vector pass (VectorBenchPass). */
export type GroupScorePassInput = { pass: number; documents: ReadonlyArray<{ id: string; pages: readonly ScoredPage[] }> };

export type GroupScoreCounts = {
  groups: number;
  networks: number;
  non_networks: number;
  /** Truth groups of a page that failed or was not read, or that the reading no longer has. */
  not_read: number;
  candidates: {
    selected: number; networks_selected: number; networks_filtered: number; non_networks_selected: number; non_networks_filtered: number;
    filtered_by_reason: Partial<Record<CandidateFilterReason, number>>;
    /** Truth groups read on a page without a candidate record. */
    unrecorded: number;
  };
  /** Truth networks the measure takes: exact class, and at parent level (exact included). */
  networks_found: { exact: number; parent: number };
  /** Truth networks given a Decisions network under the threshold. */
  networks_proposed: { exact: number; parent: number };
  /** The Decisions answers (with a class) on truth networks, at any confidence. */
  decisions_on_networks: { answers: number; exact: number; parent: number; wrong_network: number; autre: number; other_non_network: number };
  non_networks_as_network: { classified: number; proposed: number };
  to_review: { networks: number; non_networks: number };
  /** Among the truth groups the run classed as a network: how many, and the share exact and at parent level. */
  precision: { classified: number; exact: number | null; parent: number | null };
};
export type GroupScoreBand = {
  band: string;
  answers: number;
  network_proposals: number;
  exact: number;
  parent: number;
  on_non_networks: number;
  true_networks: number;
  true_networks_answered_non_network: number;
  true_networks_answered_autre: number;
  precision_exact: number | null;
};
export type GroupScorePageCost = { document: string; page: number; candidates: number | null; calls: number; tokens: number; latency_ms: number };
export type GroupScorePass = {
  pass: number;
  documents: Array<GroupScoreCounts & { document: string }>;
  total: GroupScoreCounts;
  bands: GroupScoreBand[];
  pages: GroupScorePageCost[];
  cost: {
    pages: number; calls: number; tokens: number; latency_ms: number;
    calls_per_page: number | null; tokens_per_page: number | null; latency_ms_per_page: number | null;
    call_latency_ms: { p50: number | null; p95: number | null };
  };
};
export type GroupScore = {
  version: number;
  threshold: number;
  truth: { sha256: string; files: number; groups: number; documents_not_run: string[] };
  passes: GroupScorePass[];
};

const NETWORKS = new Set<string>(NETWORK_CODES);
const asNetwork = (value: string | null): NetworkCode | null => (value !== null && NETWORKS.has(value) ? value as NetworkCode : null);
const parentOf = (code: NetworkCode) => PARENT_NETWORK[code] ?? code;
const sameParent = (left: NetworkCode, right: NetworkCode) => parentOf(left) === parentOf(right);

type Status = "not_read" | "network" | "proposal" | "other" | "to_review";
type Judgment = {
  document: string;
  truth: NetworkCode | null;
  status: Status;
  predicted: NetworkCode | null;
  answer: { class: string; confidence: number } | null;
  candidate: { selected: boolean; reason: CandidateFilterReason | null } | "unrecorded" | null;
};

function statusOf(entry: ScoredGroup | undefined): Status {
  if (!entry) return "not_read";
  if (entry.class === null) return "to_review";
  const decided = entry.source !== "decisions" || (entry.confidence ?? 0) >= CLASSIFIED_DECISIONS_CONFIDENCE;
  if (asNetwork(entry.class)) return decided ? "network" : "proposal";
  return decided ? "other" : "to_review";
}

/** `run`: the documents some pass of the run read; one of them that this pass did not reach has its groups not read. */
function judge(pass: GroupScorePassInput, truth: GroupTruthSet, run: ReadonlySet<string>): Judgment[] {
  const judgments: Judgment[] = [];
  for (const [document, file] of truth.documents) {
    if (!run.has(document)) continue;
    const read = pass.documents.find((entry) => entry.id === document);
    if (!read) {
      for (const entry of file.groups) judgments.push({ document, truth: asNetwork(entry.class), status: "not_read", predicted: null, answer: null, candidate: null });
      continue;
    }
    const pages = read.pages;
    for (const entry of file.groups) {
      const page = pages.find((candidate) => candidate.page === entry.page);
      const group = page?.status === "ok" ? page.reading?.groups.find((value) => value.id === entry.group) : undefined;
      const status = statusOf(group);
      const found = page?.decisions?.answers.find((answer) => answer.group === entry.group);
      const answer = found && found.status === "answered" && found.class !== null && found.confidence !== null
        ? { class: found.class, confidence: found.confidence } : null;
      const record = page?.candidates;
      const reason = record?.filtered.find((filtered) => filtered.group === entry.group)?.reason ?? null;
      judgments.push({
        document, truth: asNetwork(entry.class), status, predicted: group ? asNetwork(group.class) : null, answer: status === "not_read" ? null : answer,
        candidate: status === "not_read" ? null : !record ? "unrecorded" : { selected: record.selected.includes(entry.group), reason },
      });
    }
  }
  return judgments;
}

function share(part: number, whole: number) {
  return whole === 0 ? null : part / whole;
}

function countsOf(judgments: readonly Judgment[]): GroupScoreCounts {
  const networks = judgments.filter((entry) => entry.truth !== null);
  const others = judgments.filter((entry) => entry.truth === null);
  const read = judgments.filter((entry) => entry.status !== "not_read");
  const recorded = read.flatMap((entry) => (entry.candidate !== null && entry.candidate !== "unrecorded" ? [{ ...entry, candidate: entry.candidate }] : []));
  const filtered_by_reason: Partial<Record<CandidateFilterReason, number>> = {};
  for (const entry of recorded) {
    if (entry.candidate.reason) filtered_by_reason[entry.candidate.reason] = (filtered_by_reason[entry.candidate.reason] ?? 0) + 1;
  }
  const exact = (entry: Judgment) => entry.truth !== null && entry.predicted === entry.truth;
  const parent = (entry: Judgment) => entry.truth !== null && entry.predicted !== null && sameParent(entry.predicted, entry.truth);
  const found = networks.filter((entry) => entry.status === "network");
  const proposed = networks.filter((entry) => entry.status === "proposal");
  const answered = networks.flatMap((entry) => (entry.answer && entry.status !== "not_read" ? [{ truth: entry.truth as NetworkCode, answer: entry.answer }] : []));
  const answeredNetwork = (entry: (typeof answered)[number]) => asNetwork(entry.answer.class);
  const classed = judgments.filter((entry) => entry.status === "network");
  return {
    groups: judgments.length, networks: networks.length, non_networks: others.length,
    not_read: judgments.length - read.length,
    candidates: {
      selected: recorded.filter((entry) => entry.candidate.selected).length,
      networks_selected: recorded.filter((entry) => entry.truth !== null && entry.candidate.selected).length,
      networks_filtered: recorded.filter((entry) => entry.truth !== null && entry.candidate.reason !== null).length,
      non_networks_selected: recorded.filter((entry) => entry.truth === null && entry.candidate.selected).length,
      non_networks_filtered: recorded.filter((entry) => entry.truth === null && entry.candidate.reason !== null).length,
      filtered_by_reason,
      unrecorded: read.filter((entry) => entry.candidate === "unrecorded").length,
    },
    networks_found: { exact: found.filter(exact).length, parent: found.filter(parent).length },
    networks_proposed: { exact: proposed.filter(exact).length, parent: proposed.filter(parent).length },
    decisions_on_networks: {
      answers: answered.length,
      exact: answered.filter((entry) => answeredNetwork(entry) === entry.truth).length,
      parent: answered.filter((entry) => { const value = answeredNetwork(entry); return value !== null && sameParent(value, entry.truth); }).length,
      wrong_network: answered.filter((entry) => { const value = answeredNetwork(entry); return value !== null && !sameParent(value, entry.truth); }).length,
      autre: answered.filter((entry) => entry.answer.class === "autre").length,
      other_non_network: answered.filter((entry) => answeredNetwork(entry) === null && entry.answer.class !== "autre").length,
    },
    non_networks_as_network: { classified: others.filter((entry) => entry.status === "network").length,
      proposed: others.filter((entry) => entry.status === "proposal").length },
    to_review: { networks: networks.filter((entry) => entry.status === "to_review" || entry.status === "proposal").length,
      non_networks: others.filter((entry) => entry.status === "to_review" || entry.status === "proposal").length },
    precision: { classified: classed.length, exact: share(classed.filter(exact).length, classed.length), parent: share(classed.filter(parent).length, classed.length) },
  };
}

function bandsOf(judgments: readonly Judgment[]): GroupScoreBand[] {
  return BANDS.map((band, index) => {
    const next = BANDS[index + 1]?.from ?? Infinity;
    const inBand = judgments.flatMap((entry) => (entry.answer && entry.answer.confidence >= band.from && entry.answer.confidence < next
      ? [{ truth: entry.truth, answer: entry.answer, network: asNetwork(entry.answer.class) }] : []));
    const proposals = inBand.filter((entry) => entry.network !== null);
    const exact = proposals.filter((entry) => entry.truth !== null && entry.network === entry.truth).length;
    const trueNetworks = inBand.filter((entry) => entry.truth !== null);
    return {
      band: band.band, answers: inBand.length, network_proposals: proposals.length, exact,
      parent: proposals.filter((entry) => entry.truth !== null && sameParent(entry.network as NetworkCode, entry.truth)).length,
      on_non_networks: proposals.filter((entry) => entry.truth === null).length,
      true_networks: trueNetworks.length,
      true_networks_answered_non_network: trueNetworks.filter((entry) => entry.network === null).length,
      true_networks_answered_autre: trueNetworks.filter((entry) => entry.answer.class === "autre").length,
      precision_exact: share(exact, proposals.length),
    };
  });
}

function costOf(pass: GroupScorePassInput) {
  const pages: GroupScorePageCost[] = pass.documents.flatMap((document) => document.pages.map((page) => {
    const calls = page.decisions?.calls ?? [];
    return { document: document.id, page: page.page, candidates: page.candidates ? page.candidates.selected.length : null, calls: calls.length,
      tokens: calls.reduce((total, call) => total + (call.usage?.total_tokens ?? 0), 0), latency_ms: calls.reduce((total, call) => total + call.latency_ms, 0) };
  }));
  const latencies = pass.documents.flatMap((document) => document.pages.flatMap((page) => (page.decisions?.calls ?? []).map((call) => call.latency_ms)));
  const sum = (pick: (page: GroupScorePageCost) => number) => pages.reduce((total, page) => total + pick(page), 0);
  const calls = sum((page) => page.calls), tokens = sum((page) => page.tokens), latency = sum((page) => page.latency_ms);
  return {
    pages,
    cost: { pages: pages.length, calls, tokens, latency_ms: latency, calls_per_page: share(calls, pages.length), tokens_per_page: share(tokens, pages.length),
      latency_ms_per_page: share(latency, pages.length), call_latency_ms: { p50: nearestRank(latencies, 50), p95: nearestRank(latencies, 95) } },
  };
}

export function scoreGroupTruth(input: { passes: readonly GroupScorePassInput[]; truth: GroupTruthSet }): GroupScore {
  const run = new Set(input.passes.flatMap((pass) => pass.documents.map((document) => document.id)));
  return {
    version: GROUP_SCORE_VERSION, threshold: CLASSIFIED_DECISIONS_CONFIDENCE,
    truth: { sha256: input.truth.sha256, files: input.truth.files, groups: input.truth.groups,
      documents_not_run: [...input.truth.documents.keys()].filter((id) => !run.has(id)).sort() },
    passes: input.passes.map((pass) => {
      const judgments = judge(pass, input.truth, run);
      const documents = [...new Set(judgments.map((entry) => entry.document))]
        .map((document) => ({ document, ...countsOf(judgments.filter((entry) => entry.document === document)) }));
      return { pass: pass.pass, documents, total: countsOf(judgments), bands: bandsOf(judgments), ...costOf(pass) };
    }),
  };
}

function percent(value: number | null) {
  return value === null ? "–" : `${(value * 100).toFixed(0)} %`;
}

function decimal(value: number | null, digits = 1) {
  return value === null ? "–" : value.toFixed(digits).replace(".", ",");
}

/** report.md section of the per-group score: counts and shares only, never a group id, colour or class. */
export function renderGroupScoreSection(score: GroupScore): string[] {
  const lines = [`## Score par groupe (vérité à part, TI-704)`, "",
    `Vérité des groupes hors du jeu, jamais appliquée comme correspondances : empreinte \`${score.truth.sha256}\` (${score.truth.files} fichiers, `
    + `${score.truth.groups} groupes). Seuil de classement ${decimal(score.threshold)}. « Parent » : même réseau au niveau parent (un aller ou un retour pour son réseau), exact compris. `
    + "Trouvé : réseau pris par la mesure ; proposé : réseau Decisions sous le seuil ; à revoir : sans classe ou réponse Decisions sous le seuil. "
    + "Retenus : choisis pour Decisions (un run arrêté ne les interroge pas tous) ; écartés : jamais envoyés (filtre des candidats).", ""];
  if (score.truth.documents_not_run.length > 0) lines.push(`Documents de la vérité non lus par ce run : ${score.truth.documents_not_run.join(", ")}.`, "");
  for (const pass of score.passes) {
    lines.push(`### Passe ${pass.pass}`, "");
    const row = (name: string, counts: GroupScoreCounts) => [name, `${counts.groups} (${counts.networks} / ${counts.non_networks})`, counts.not_read,
      `${counts.candidates.selected} (${counts.candidates.networks_selected} / ${counts.candidates.non_networks_selected})`,
      `${counts.candidates.networks_filtered} / ${counts.candidates.non_networks_filtered}`,
      `${counts.networks_found.exact} / ${counts.networks_found.parent}`, `${counts.networks_proposed.exact} / ${counts.networks_proposed.parent}`,
      `${counts.decisions_on_networks.autre} / ${counts.decisions_on_networks.answers}`,
      `${counts.non_networks_as_network.classified} / ${counts.non_networks_as_network.proposed}`,
      `${counts.to_review.networks} / ${counts.to_review.non_networks}`,
      `${counts.precision.classified} (${percent(counts.precision.exact)} / ${percent(counts.precision.parent)})`];
    lines.push(...table(["Document", "Groupes (réseaux / autres)", "Non lus", "Retenus pour Decisions (réseaux / autres)", "Écartés (réseaux / autres)",
      "Réseaux trouvés (exacts / parent)", "Réseaux proposés (exacts / parent)", "Réseaux répondus « autre » / réponses", "Non-réseaux pris pour réseau (classés / proposés)",
      "À revoir (réseaux / autres)", "Réseaux classés (précision exacte / parent)"],
    [...pass.documents.map((entry) => row(entry.document, entry)), row("**Total**", pass.total)]), "");
    const reasons = CANDIDATE_FILTER_REASONS.flatMap((reason) => (pass.total.candidates.filtered_by_reason[reason] ? [`${reason} ${pass.total.candidates.filtered_by_reason[reason]}`] : []));
    if (reasons.length > 0) lines.push(`Écartés par raison : ${reasons.join(", ")}.`, "");
    if (pass.total.candidates.unrecorded > 0) lines.push(`Groupes lus sans liste de candidats : ${pass.total.candidates.unrecorded}.`, "");
    lines.push(...table(["Confiance Decisions", "Réponses", "Propositions réseau", "Exactes", "Parent", "Sur des non-réseaux", "Vrais réseaux",
      "Vrais réseaux répondus non-réseau (dont « autre »)", "Précision exacte"], pass.bands.map((band) => [band.band, band.answers, band.network_proposals,
      band.exact, band.parent, band.on_non_networks, band.true_networks, `${band.true_networks_answered_non_network} (${band.true_networks_answered_autre})`,
      percent(band.precision_exact)])), "");
    const { cost } = pass;
    lines.push(`Coût du run (${cost.pages} pages, échecs compris) : ${cost.calls} appels Decisions (${decimal(cost.calls_per_page)} par page), ${cost.tokens} jetons `
      + `(${decimal(cost.tokens_per_page, 0)} par page), latence ${decimal(cost.latency_ms / 1000, 2)} s (${decimal(cost.latency_ms_per_page === null ? null : cost.latency_ms_per_page / 1000, 2)} s `
      + `par page), appel p50 / p95 ${decimal(cost.call_latency_ms.p50 === null ? null : cost.call_latency_ms.p50 / 1000, 2)} / `
      + `${decimal(cost.call_latency_ms.p95 === null ? null : cost.call_latency_ms.p95 / 1000, 2)} s.`, "");
    lines.push(...table(["Document", "Page", "Candidats envoyés", "Appels", "Jetons", "Latence (s)"], pass.pages.map((page) => [page.document, page.page,
      page.candidates, page.calls, page.tokens, decimal(page.latency_ms / 1000, 2)])), "");
  }
  return lines;
}

/**
 * The truth directory of `--group-truth`: refused inside the dataset (it would be read as the user's correspondences
 * and enter the dataset SHA), or unless every `<document id>.json` passes the truth/groups checks against the
 * manifest. Its hash is the dataset SHA's rule over those files, paths relative to the directory.
 */
export async function loadGroupTruthDirectory(directory: string, dataset: { datasetRoot: string; manifest: Pick<TakeoffBenchManifest, "documents"> }):
  Promise<GroupTruthSet> {
  const real = async (value: string) => realpath(value).catch(() => path.resolve(value));
  const dir = await real(directory);
  const root = await real(dataset.datasetRoot);
  const relative = path.relative(root, dir);
  if (relative === "" || !(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
    throw new BenchDatasetError(`--group-truth ${dir} is inside the dataset ${root}: keep the labels out of it, or they are read as the user's correspondences.`);
  }
  const check = await checkGroupTruthFiles(dir, dataset.manifest.documents);
  if (!check.ok) {
    throw new BenchDatasetError(`--group-truth refused (${check.errors.length} errors):\n${check.errors.slice(0, 10).map(formatBenchIssue).join("\n")}`);
  }
  const documents = new Map<string, GroupTruthFile>();
  for (const file of check.files) {
    const parsed = GroupTruthFileSchema.parse(JSON.parse(await readFile(path.join(dir, file), "utf8")));
    documents.set(parsed.document, parsed);
  }
  return { sha256: await filesSha256(dir, check.files), files: check.files.length,
    groups: [...documents.values()].reduce((total, file) => total + file.groups.length, 0), documents };
}
