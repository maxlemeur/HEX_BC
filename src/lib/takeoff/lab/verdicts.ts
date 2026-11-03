import "server-only";

import { z } from "zod";

import { notFound } from "@/lib/estimates/errors";
import type { LabCampaign, LabCampaignElement, LabRun, LabStats, LabStatsGroup, LabStoredVerdict, LabVerdict } from "@/lib/takeoff/lab/contracts";
import { configLabel } from "@/lib/takeoff/lab/contracts";
import { listLabRuns, type LabAccess } from "@/lib/takeoff/lab/runs";
import {
  campaignVerdictsDirectory, listDirectories, listJsonFiles, outputSubdirectory, readLabJson, removeLabFile, verdictFile, writeLabJson,
  type LabPaths,
} from "@/lib/takeoff/lab/storage";

// Verdicts of the takeoff lab (TI-661): one file per element,
// <output>/verdicts/<campaign>/<elementId>.json. Judging again replaces it;
// « Annuler » deletes the author's latest verdict in the campaign. An element
// is one result row of one configuration (an extracted item, an answer to a
// question; an output that failed its schema is one element). « Passer » is not
// stored: it only leaves « à parcourir » for the session.

const StoredVerdictSchema = z.looseObject({
  schema_version: z.literal(1),
  element_id: z.string().regex(/^[0-9a-f]{64}$/),
  verdict: z.enum(["good", "bad"]),
  author: z.looseObject({ user_id: z.string(), email: z.string().nullable() }),
  at: z.string(),
  campaign: z.string(),
});

async function readCampaignVerdicts(paths: LabPaths, campaign: string): Promise<LabStoredVerdict[]> {
  const files = await listJsonFiles(campaignVerdictsDirectory(paths, campaign));
  return Promise.all(files.map((file) => readLabJson(file, (value) => StoredVerdictSchema.parse(value) as unknown as LabStoredVerdict, paths.outputDir)));
}

function campaignElements(runs: readonly LabRun[], campaign: string): Omit<LabCampaignElement, "verdict" | "verdict_at" | "verdict_author">[] {
  // Oldest essai first, then A to D, then the order of the rows.
  return [...runs].filter((run) => run.campaign === campaign).reverse().flatMap((run) => run.configs.flatMap((config) =>
    config.elements.map((element) => ({
      ...element, run_id: run.id, run_created_at: run.created_at, config_id: config.id, provider: config.provider, model: config.model,
      reasoning_effort: config.reasoning_effort, config_status: config.status, config_message: config.message, task: run.task,
      document: run.document, crop: run.crop, prompt_version: run.prompt.version,
    }))));
}

export async function readLabCampaign(paths: LabPaths, campaign: string): Promise<LabCampaign> {
  campaignVerdictsDirectory(paths, campaign);
  const [runs, verdicts] = await Promise.all([listLabRuns(paths), readCampaignVerdicts(paths, campaign)]);
  const byElement = new Map(verdicts.map((verdict) => [verdict.element_id, verdict]));
  return {
    campaign,
    elements: campaignElements(runs, campaign).map((element) => {
      const verdict = byElement.get(element.id);
      return { ...element, verdict: verdict?.verdict ?? null, verdict_at: verdict?.at ?? null, verdict_author: verdict?.author.email ?? null };
    }),
  };
}

export async function listLabCampaigns(paths: LabPaths) {
  const [runs, judged] = await Promise.all([listLabRuns(paths), listDirectories(outputSubdirectory(paths, "verdicts"))]);
  return [...new Set([...runs.map((run) => run.campaign), ...judged])].sort();
}

// Verdict writes and « Annuler » of one campaign run one at a time in this
// process: otherwise an undo that picked its target could delete a verdict
// another tab or admin wrote on that element between the pick and the delete.
const campaignQueues = new Map<string, Promise<void>>();

function inCampaignOrder<T>(paths: LabPaths, campaign: string, work: () => Promise<T>): Promise<T> {
  const key = `${paths.outputDir}\u0000${campaign}`;
  const result = (campaignQueues.get(key) ?? Promise.resolve()).then(work);
  const settled = result.then(() => undefined, () => undefined);
  campaignQueues.set(key, settled);
  void settled.then(() => {
    if (campaignQueues.get(key) === settled) campaignQueues.delete(key);
  });
  return result;
}

export function saveLabVerdict(paths: LabPaths, access: LabAccess, campaign: string, elementId: string, verdict: LabVerdict) {
  return inCampaignOrder(paths, campaign, () => writeVerdict(paths, access, campaign, elementId, verdict));
}

async function writeVerdict(paths: LabPaths, access: LabAccess, campaign: string, elementId: string, verdict: LabVerdict) {
  const file = verdictFile(paths, campaign, elementId);
  const element = campaignElements(await listLabRuns(paths), campaign).find((entry) => entry.id === elementId);
  if (!element) throw notFound("Élément introuvable dans cette campagne.");
  const stored: LabStoredVerdict = {
    schema_version: 1, element_id: elementId, verdict, author: { user_id: access.owner.userId, email: access.email },
    at: new Date().toISOString(), campaign, task: element.task.id, run_id: element.run_id, config_id: element.config_id,
    provider: element.provider, model: element.model, reasoning_effort: element.reasoning_effort, prompt_version: element.prompt_version,
    document_id: element.document.id, document_sha256: element.document.sha256,
  };
  await writeLabJson(file, stored);
  return stored;
}

/** Deletes the author's latest verdict in the campaign; 404 when there is none. */
export function undoLabVerdict(paths: LabPaths, access: LabAccess, campaign: string) {
  return inCampaignOrder(paths, campaign, () => removeLatestVerdict(paths, access, campaign));
}

async function removeLatestVerdict(paths: LabPaths, access: LabAccess, campaign: string) {
  const mine = (await readCampaignVerdicts(paths, campaign)).filter((verdict) => verdict.author.user_id === access.owner.userId)
    .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
  const latest = mine[0];
  if (!latest) throw notFound("Aucun verdict à annuler dans cette campagne.");
  await removeLabFile(verdictFile(paths, campaign, latest.element_id));
  return { element_id: latest.element_id, verdict: latest.verdict };
}

function mean(values: readonly number[]) {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

/**
 * Per configuration and prompt version: % judged good = good / (good + bad), with n.
 * Tokens and latency are averaged over the configuration's answers (calls that ran).
 */
export async function computeLabStats(paths: LabPaths, filter: { campaign: string | null; task: string | null }): Promise<LabStats> {
  const runs = (await listLabRuns(paths)).filter((run) => (!filter.campaign || run.campaign === filter.campaign) && (!filter.task || run.task.id === filter.task));
  const campaigns = [...new Set(runs.map((run) => run.campaign))];
  const verdicts = new Map((await Promise.all(campaigns.map((campaign) => readCampaignVerdicts(paths, campaign)))).flat()
    .map((verdict) => [`${verdict.campaign}\u0000${verdict.element_id}`, verdict.verdict]));
  const groups = new Map<string, LabStatsGroup & { tokens: number[]; latencies: number[] }>();
  for (const run of runs) {
    for (const config of run.configs) {
      if (config.status === "not_run") continue;
      const id = JSON.stringify([run.task.id, config.provider, config.model, config.reasoning_effort, run.prompt.version]);
      const group = groups.get(id) ?? {
        id, task: run.task, provider: config.provider, model: config.model, reasoning_effort: config.reasoning_effort,
        prompt_version: run.prompt.version, label: configLabel(config), good: 0, bad: 0, judged: 0, rate: null, responses: 0,
        mean_tokens: null, mean_latency_ms: null, tokens: [], latencies: [],
      };
      group.responses += 1;
      if (config.usage) group.tokens.push(config.usage.total);
      if (config.latency_ms !== null) group.latencies.push(config.latency_ms);
      for (const element of config.elements) {
        const verdict = verdicts.get(`${run.campaign}\u0000${element.id}`);
        if (verdict === "good") group.good += 1;
        if (verdict === "bad") group.bad += 1;
      }
      groups.set(id, group);
    }
  }
  return {
    runs: runs.length,
    verdicts: [...groups.values()].reduce((total, group) => total + group.good + group.bad, 0),
    groups: [...groups.values()].map(({ tokens, latencies, ...group }) => ({
      ...group, judged: group.good + group.bad, rate: group.good + group.bad > 0 ? group.good / (group.good + group.bad) : null,
      mean_tokens: mean(tokens), mean_latency_ms: mean(latencies),
    })).sort((left, right) => (right.rate ?? -1) - (left.rate ?? -1) || left.label.localeCompare(right.label)),
  };
}
