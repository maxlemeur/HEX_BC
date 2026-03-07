"use server";

import { revalidatePath } from "next/cache";

import {
  fetchGeneratedOuvrageDraft as fetchGeneratedOuvrageDraftServer,
  generateOuvragesFromText as generateGeneratedOuvragesFromText,
  insertGeneratedOuvrages as insertGeneratedOuvragesServer,
  rejectGeneratedOuvrageDraft as rejectGeneratedOuvrageDraftServer,
  type GeneratedOuvrageDraftResult,
  type InsertGeneratedOuvragesResult,
  type RejectGeneratedOuvrageDraftResult,
} from "@/lib/estimates/generated-ouvrages";

type GenerateOuvragesFromTextInput = Parameters<
  typeof generateGeneratedOuvragesFromText
>[0];
type FetchGeneratedOuvrageDraftInput = Parameters<typeof fetchGeneratedOuvrageDraftServer>[0];
type InsertGeneratedOuvragesInput = Parameters<typeof insertGeneratedOuvragesServer>[0];
type RejectGeneratedOuvrageDraftInput = Parameters<
  typeof rejectGeneratedOuvrageDraftServer
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
