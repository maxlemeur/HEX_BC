"use server";

import {
  loadTakeoffPreparation, saveTakeoffPreparation, confirmTakeoffPreparation, assistTakeoffPreparation, getTakeoffPreparationSourcePreview,
} from "@/lib/takeoff/preparation-server";
import type { TakeoffPreparation, TakeoffPreparationProfile } from "@/lib/takeoff/preparation";
import { loadTakeoffPreparationProfiles, saveTakeoffPreparationProfile } from "@/lib/takeoff/preparation-profiles-server";
import { runSafeTakeoffAction } from "@/lib/takeoff/action-errors-server";

export async function loadTakeoffPreparationAction(projectId: string) {
  return runSafeTakeoffAction(() => loadTakeoffPreparation(projectId));
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

export async function loadTakeoffPreparationProfilesAction() {
  return runSafeTakeoffAction(() => loadTakeoffPreparationProfiles());
}

export async function saveTakeoffPreparationProfileAction(input: { profile: TakeoffPreparationProfile; expectedVersion: number | null }) {
  return runSafeTakeoffAction(() => saveTakeoffPreparationProfile(input));
}

export async function getTakeoffPreparationSourcePreviewAction(input: { projectId: string; documentId: string; page?: number }) {
  return runSafeTakeoffAction(() => getTakeoffPreparationSourcePreview(input));
}
