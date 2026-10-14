"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { ApiError } from "@/lib/estimates/errors";

import {
  fetchResumableGeneratedOuvrageDraft as fetchResumableGeneratedOuvrageDraftServer,
  listResumableGeneratedOuvrageDrafts as listResumableGeneratedOuvrageDraftsServer,
  type GeneratedOuvrageDraftPage,
  fetchGeneratedOuvrageDraft as fetchGeneratedOuvrageDraftServer,
  fetchGeneratedOuvrageSubdetailDraft as fetchGeneratedOuvrageSubdetailDraftServer,
  generateOuvragesFromText as generateGeneratedOuvragesFromText,
  getGeneratedOuvrageApplicationReceipt as getGeneratedOuvrageApplicationReceiptServer,
  abandonGeneratedOuvrageApplication as abandonGeneratedOuvrageApplicationServer,
  insertGeneratedOuvrages as insertGeneratedOuvragesServer,
  rejectGeneratedOuvrageDraft as rejectGeneratedOuvrageDraftServer,
  type GeneratedOuvrageDraftResult,
  type GeneratedOuvrageSubdetailResult,
  type GeneratedOuvrageApplicationOutcome,
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
): Promise<GeneratedOuvrageDraftResult | ReturnType<typeof generatedOuvrageFailure>> {
  try {
    const result = await generateGeneratedOuvragesFromText(input);
    revalidateGeneratedOuvragePaths(result.projectId, result.versionId);
    return result;
  } catch (error) {
    return generatedOuvrageFailure(error, "generate");
  }
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

type GeneratedOuvrageResumeActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { status: number; code: string; message: string } };

function generatedOuvrageFailure(error: unknown, operation: "resume" | "insert" | "review" | "generate" = "resume") {
  if (error instanceof ApiError && error.status < 500) {
    return { ok: false as const, error: { status: error.status, code: error.code, message: error.message } };
  }
  if (error instanceof ZodError) {
    return {
      ok: false as const,
      error: {
        status: 400,
        code: "VALIDATION_ERROR",
        message: operation === "generate"
          ? "La demande de génération est invalide."
          : operation !== "resume"
            ? "La demande d'insertion est invalide."
            : "La demande de reprise est invalide.",
      },
    };
  }
  if (operation === "generate") {
    return {
      ok: false as const,
      error: {
        status: 503,
        code: "GENERATED_OUVRAGE_GENERATION_UNKNOWN",
        message: "Impossible de confirmer la génération. Consultez les travaux sauvegardés avant de réessayer.",
      },
    };
  }
  return {
    ok: false as const,
    error: {
      status: 503,
      code: operation !== "resume" ? "GENERATED_OUVRAGE_OUTCOME_UNKNOWN" : "GENERATED_OUVRAGE_READ_UNAVAILABLE",
      message: operation === "insert"
        ? "Impossible de confirmer le résultat de l'insertion. Vérifiez le devis avant de réessayer."
        : operation === "review"
          ? "Le résultat de l'enregistrement doit être vérifié. Rechargez la revue enregistrée avant de réessayer."
          : "Impossible de charger ce travail sauvegardé. Réessayez.",
    },
  };
}

export async function getGeneratedOuvrageApplicationReceipt(
  input: Parameters<typeof getGeneratedOuvrageApplicationReceiptServer>[0]
): Promise<GeneratedOuvrageResumeActionResult<GeneratedOuvrageApplicationOutcome | null>> {
  try {
    return { ok: true, data: await getGeneratedOuvrageApplicationReceiptServer(input) };
  } catch (error) {
    return generatedOuvrageFailure(error);
  }
}

export async function abandonGeneratedOuvrageApplication(
  input: Parameters<typeof abandonGeneratedOuvrageApplicationServer>[0]
): Promise<GeneratedOuvrageResumeActionResult<GeneratedOuvrageApplicationOutcome>> {
  try {
    return { ok: true, data: await abandonGeneratedOuvrageApplicationServer(input) };
  } catch (error) {
    return generatedOuvrageFailure(error, "insert");
  }
}

export async function listResumableGeneratedOuvrageDrafts(
  input: Parameters<typeof listResumableGeneratedOuvrageDraftsServer>[0]
): Promise<GeneratedOuvrageResumeActionResult<GeneratedOuvrageDraftPage>> {
  try {
    return { ok: true, data: await listResumableGeneratedOuvrageDraftsServer(input) };
  } catch (error) {
    return generatedOuvrageFailure(error);
  }
}

export async function fetchResumableGeneratedOuvrageDraft(
  input: FetchGeneratedOuvrageDraftInput
): Promise<GeneratedOuvrageResumeActionResult<GeneratedOuvrageDraftResult>> {
  try {
    return { ok: true, data: await fetchResumableGeneratedOuvrageDraftServer(input) };
  } catch (error) {
    return generatedOuvrageFailure(error);
  }
}

export async function fetchGeneratedOuvrageSubdetailDraft(
  input: FetchGeneratedOuvrageSubdetailInput
): Promise<GeneratedOuvrageSubdetailResult | ReturnType<typeof generatedOuvrageFailure>> {
  try {
    return await fetchGeneratedOuvrageSubdetailDraftServer(input);
  } catch (error) {
    return generatedOuvrageFailure(error, "review");
  }
}

export async function updateGeneratedOuvrageSubdetailDraft(
  input: UpdateGeneratedOuvrageSubdetailInput
): Promise<GeneratedOuvrageSubdetailResult | ReturnType<typeof generatedOuvrageFailure>> {
  try {
    const result = await updateGeneratedOuvrageSubdetailDraftServer(input);
    revalidateGeneratedOuvragePaths(result.projectId, result.versionId);
    return result;
  } catch (error) {
    return generatedOuvrageFailure(error, "review");
  }
}

export async function insertGeneratedOuvrages(
  input: InsertGeneratedOuvragesInput
): Promise<GeneratedOuvrageApplicationOutcome | ReturnType<typeof generatedOuvrageFailure>> {
  try {
    const result = await insertGeneratedOuvragesServer(input);
    if (!("outcome" in result)) revalidateGeneratedOuvragePaths(result.projectId, result.versionId);
    return result;
  } catch (error) {
    return generatedOuvrageFailure(error, "insert");
  }
}

export async function rejectGeneratedOuvrageDraft(
  input: RejectGeneratedOuvrageDraftInput
): Promise<RejectGeneratedOuvrageDraftResult | ReturnType<typeof generatedOuvrageFailure>> {
  try {
    const result = await rejectGeneratedOuvrageDraftServer(input);
    revalidateGeneratedOuvragePaths(result.projectId, result.versionId);
    return result;
  } catch (error) {
    return generatedOuvrageFailure(error, "review");
  }
}
