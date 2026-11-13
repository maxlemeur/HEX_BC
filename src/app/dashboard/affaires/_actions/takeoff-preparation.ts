"use server";

import {
  loadTakeoffPreparation, saveTakeoffPreparation, confirmTakeoffPreparation, assistTakeoffPreparation, getTakeoffPreparationSourcePreview,
  getTakeoffPageTriageAvailability, proposeTakeoffPageTriage,
} from "@/lib/takeoff/preparation-server";
import type { TakeoffPreparation, TakeoffPreparationProfile } from "@/lib/takeoff/preparation";
import { loadTakeoffPreparationProfiles, saveTakeoffPreparationProfile } from "@/lib/takeoff/preparation-profiles-server";
import { runSafeTakeoffAction } from "@/lib/takeoff/action-errors-server";
import { loadChatGptConnection } from "@/app/dashboard/_actions/chatgpt";

/**
 * Everything the preparation panel reads, in one request when it opens: the preparation, the business profiles,
 * the page triage availability and the ChatGPT connection. Next.js sends a page's Server Actions one at a time, so a
 * read sent later by a step (they used to read when they appeared) went in front of the save, the assistance or the
 * page triage the person asked for, and kept « Enregistrement… » on screen for as long as it took (TI-720).
 * Each part fails on its own; an unknown ChatGPT connection reads as none.
 */
export async function loadTakeoffPreparationPanelAction(projectId: string) {
  const [preparation, profiles, pageTriage, chatGpt] = await Promise.all([
    runSafeTakeoffAction(() => loadTakeoffPreparation(projectId)),
    runSafeTakeoffAction(() => loadTakeoffPreparationProfiles()),
    runSafeTakeoffAction(() => getTakeoffPageTriageAvailability(projectId)),
    loadChatGptConnection().catch(() => null),
  ]);
  return { preparation, profiles, pageTriage, chatGpt };
}

export async function saveTakeoffPreparationAction(input: {
  projectId: string; draft: TakeoffPreparation; expectedRevision: number | null;
}) {
  return runSafeTakeoffAction(() => saveTakeoffPreparation(input));
}

export async function confirmTakeoffPreparationAction(input: { projectId: string; expectedRevision: number }) {
  return runSafeTakeoffAction(() => confirmTakeoffPreparation(input));
}

export async function assistTakeoffPreparationAction(input: { projectId: string; expectedRevision: number | null; instruction?: string }) {
  return runSafeTakeoffAction(() => assistTakeoffPreparation(input));
}

export async function saveTakeoffPreparationProfileAction(input: { profile: TakeoffPreparationProfile; expectedVersion: number | null }) {
  return runSafeTakeoffAction(() => saveTakeoffPreparationProfile(input));
}

export async function getTakeoffPreparationSourcePreviewAction(input: { projectId: string; documentId: string; page?: number }) {
  return runSafeTakeoffAction(() => getTakeoffPreparationSourcePreview(input));
}

export async function proposeTakeoffPageTriageAction(input: { projectId: string; expectedRevision: number; documentId: string }) {
  return runSafeTakeoffAction(() => proposeTakeoffPageTriage(input));
}
