"use client";

import type {
  LabBenchReportSummary, LabCampaign, LabRun, LabRunRequest, LabRunSummary, LabState, LabStats, LabStoredVerdict, LabVerdict,
} from "@/lib/takeoff/lab/contracts";
import type { ChatGptAvailableModel, ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";

const ROOT = "/api/admin/takeoff/lab";

export class LabApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "LabApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ROOT}${path}`, { cache: "no-store", ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers });
  const body = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: { message?: string } } | null;
  if (!response.ok || !body?.ok) {
    throw new LabApiError(body?.error?.message ?? `Le labo a répondu ${response.status}.`, response.status);
  }
  return body.data as T;
}

export const labApi = {
  state: () => request<LabState>(""),
  models: () => request<{ models: ChatGptAvailableModel[]; profile: { model: string; reasoning_effort: ChatGptReasoningEffort | null } }>("/models"),
  runs: (campaign?: string) => request<LabRunSummary[]>(`/runs${campaign ? `?campaign=${encodeURIComponent(campaign)}` : ""}`),
  run: (id: string) => request<LabRun>(`/runs/${encodeURIComponent(id)}`),
  launch: (body: LabRunRequest) => request<LabRun>("/runs", { method: "POST", body: JSON.stringify(body) }),
  campaign: (campaign: string) => request<LabCampaign>(`/campaigns/${encodeURIComponent(campaign)}`),
  judge: (campaign: string, elementId: string, verdict: LabVerdict) => request<LabStoredVerdict>(
    `/campaigns/${encodeURIComponent(campaign)}/verdicts/${encodeURIComponent(elementId)}`, { method: "PUT", body: JSON.stringify({ verdict }) }),
  undo: (campaign: string) => request<{ element_id: string; verdict: LabVerdict }>(`/campaigns/${encodeURIComponent(campaign)}/undo`, { method: "POST" }),
  stats: (filter: { campaign: string | null; task: string | null }) => {
    const search = new URLSearchParams();
    if (filter.campaign) search.set("campaign", filter.campaign);
    if (filter.task) search.set("task", filter.task);
    const query = search.toString();
    return request<LabStats>(`/stats${query ? `?${query}` : ""}`);
  },
  benchReports: () => request<LabBenchReportSummary[]>("/bench-reports"),
  benchReport: async (name: string) => {
    const response = await fetch(`${ROOT}/bench-reports/${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!response.ok) throw new LabApiError("Rapport introuvable.", response.status);
    return response.text();
  },
  documentUrl: (id: string) => `${ROOT}/documents/${encodeURIComponent(id)}`,
};

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erreur inattendue du labo.";
}

const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });

export const formatInteger = (value: number) => integer.format(value);
export const formatRatio = (value: number) => decimal.format(value);
export const formatPercent = (value: number) => percent.format(value);
export function formatLatency(ms: number | null) {
  if (ms === null) return "—";
  return ms < 10_000 ? `${integer.format(ms)} ms` : `${decimal.format(ms / 1000)} s`;
}
