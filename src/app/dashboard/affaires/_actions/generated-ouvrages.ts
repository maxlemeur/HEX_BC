"use server";

import { revalidatePath } from "next/cache";

import {
  fetchGeneratedOuvrageDraft as fetchGeneratedOuvrageDraftServer,
  fetchGeneratedOuvrageSubdetailDraft as fetchGeneratedOuvrageSubdetailDraftServer,
  generateOuvragesFromText as generateGeneratedOuvragesFromText,
  insertGeneratedOuvrages as insertGeneratedOuvragesServer,
  rejectGeneratedOuvrageDraft as rejectGeneratedOuvrageDraftServer,
  type GeneratedOuvrageDraftResult,
  type GeneratedOuvrageSubdetailResult,
  type InsertGeneratedOuvragesResult,
  type RejectGeneratedOuvrageDraftResult,
  updateGeneratedOuvrageSubdetailDraft as updateGeneratedOuvrageSubdetailDraftServer,
} from "@/lib/estimates/generated-ouvrages";

type GenerateOuvragesFromTextInput = Parameters<
  typeof generateGeneratedOuvragesFromText
>[0];
type FetchGeneratedOuvrageDraftInput = Parameters<typeof fetchGeneratedOuvrageDraftServer>[0];
type FetchGeneratedOuvrageSubdetailInput = Parameters<
  typeof fetchGeneratedOuvrageSubdetailDraftServer
>[0];
type InsertGeneratedOuvragesInput = Parameters<typeof insertGeneratedOuvragesServer>[0];
type RejectGeneratedOuvrageDraftInput = Parameters<
  typeof rejectGeneratedOuvrageDraftServer
>[0];
type UpdateGeneratedOuvrageSubdetailInput = Parameters<
  typeof updateGeneratedOuvrageSubdetailDraftServer
>[0];

function revalidateGeneratedOuvragePaths(projectId: string, versionId: string) {
  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${projectId}`);
  revalidatePath(`/dashboard/estimates/${versionId}`);
}

export async function generateOuvragesFromText(
  input: GenerateOuvragesFromTextInput
): Promise<GeneratedOuvrageDraftResult> {
  const result = await generateGeneratedOuvragesFromText(input);
  revalidateGeneratedOuvragePaths(result.projectId, result.versionId);
  return result;
}

export async function fetchGeneratedOuvrageDraftAction(
  input: FetchGeneratedOuvrageDraftInput
): Promise<GeneratedOuvrageDraftResult> {
  return fetchGeneratedOuvrageDraftServer(input);
}

export async function fetchGeneratedOuvrageDraft(
  input: FetchGeneratedOuvrageDraftInput
): Promise<GeneratedOuvrageDraftResult> {
  return fetchGeneratedOuvrageDraftAction(input);
}

export async function fetchGeneratedOuvrageSubdetailDraft(
  input: FetchGeneratedOuvrageSubdetailInput
): Promise<GeneratedOuvrageSubdetailResult> {
  return fetchGeneratedOuvrageSubdetailDraftServer(input);
}

export async function updateGeneratedOuvrageSubdetailDraft(
  input: UpdateGeneratedOuvrageSubdetailInput
): Promise<GeneratedOuvrageSubdetailResult> {
  const result = await updateGeneratedOuvrageSubdetailDraftServer(input);
  revalidateGeneratedOuvragePaths(result.projectId, result.versionId);
  return result;
}

export async function insertGeneratedOuvrages(
  input: InsertGeneratedOuvragesInput
): Promise<InsertGeneratedOuvragesResult> {
  const result = await insertGeneratedOuvragesServer(input);
  revalidateGeneratedOuvragePaths(result.projectId, result.versionId);
  return result;
}

export async function rejectGeneratedOuvrageDraft(
  input: RejectGeneratedOuvrageDraftInput
): Promise<RejectGeneratedOuvrageDraftResult> {
  const result = await rejectGeneratedOuvrageDraftServer(input);
  revalidateGeneratedOuvragePaths(result.projectId, result.versionId);
  return result;
}
