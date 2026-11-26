import { API_KEY_ERROR_CODES, apiKeyErrorMessage } from "@/lib/ai/access/api-key-errors";
import { z } from "zod";

/**
 * Automatic transcription of a dossier piece at arrival: the text a vision
 * model reads in an image or in the scanned pages of a PDF, on the ChatGPT plan
 * of the member who added the piece. It is never verified: the piece stays the
 * source, and the text says « [illisible] » where the model could not read.
 */

/** The model and effort chosen for this reading (owner decision, 2026-11-15): Terra, at a high effort. */
export const INTAKE_TRANSCRIPTION_MODEL = "gpt-6.1-terra";
export const INTAKE_TRANSCRIPTION_REASONING_EFFORT = "high";
export const INTAKE_TRANSCRIPTION_PROMPT_VERSION = "intake-transcription-v1";
/** Scanned pages read per piece; the others are counted as left out. */
export const INTAKE_TRANSCRIPTION_MAX_PAGES = 20;
/** One reading answers within this time, or the page is not read. */
export const INTAKE_TRANSCRIPTION_PAGE_TIMEOUT_MS = 180_000;
/** Text of one page: a dense A4 page holds about 6 000 characters; 20 pages stay within the row's bound. */
export const INTAKE_TRANSCRIPTION_MAX_TEXT_CHARS = 20_000;

export const intakeTranscriptionAnswerSchema = z.object({
  texte: z.string().max(INTAKE_TRANSCRIPTION_MAX_TEXT_CHARS),
}).strict();

export type IntakeTranscriptionStatus = "completed" | "partial" | "failed";
export type IntakeTranscriptionPage = { page: number; text: string; illegible: number };

export type IntakeTranscription = {
  status: IntakeTranscriptionStatus;
  pages: IntakeTranscriptionPage[];
  pagesNeeded: number;
  pagesSkipped: number;
  model: string | null;
  reasoningEffort: string | null;
  errorCode: string | null;
  /** When the piece was read (the last reading). */
  readAt: string;
};

export function buildIntakeTranscriptionPrompt(input: { fileName: string; page: number; pageCount: number | null }) {
  const where = input.pageCount && input.pageCount > 1 ? `la page ${input.page} de la pièce` : "la pièce";
  return [
    `Transcris tout le texte visible dans ${where} « ${input.fileName} » d’un dossier de chiffrage du bâtiment.`,
    "Écris le texte tel qu’il est écrit, dans l’ordre de lecture, avec ses retours à la ligne : nombres, unités, références et ponctuation exactement comme sur le document.",
    "Un tableau s’écrit une ligne par rangée, ses cellules séparées par « | ».",
    "N’invente rien : un mot, un nombre ou une unité que tu ne lis pas avec certitude s’écrit [illisible], même si tu peux le deviner.",
    "Ne traduis pas, ne résume pas, ne corrige pas et n’ajoute aucun commentaire. Une page sans texte donne une chaîne vide.",
    "Réponds avec {\"texte\": \"…\"}.",
  ].join("\n");
}

/** Stops that the same content meets again, whatever the plan or the moment. */
const LASTING_TRANSCRIPTION_ERRORS = new Set(["PAGE_TOO_LARGE"]);

/**
 * Whether a piece needs a reading for this content: none was recorded, the
 * recorded one read another content, or a failure stopped it (quota, access,
 * model, an incomplete inspection). A reading that ended without an error, the
 * per-piece bound included, or on a page too heavy for these same bytes, is kept.
 */
export function needsIntakeTranscription(existing: { source_sha256: string; error_code: string | null } | null, sourceSha256: string) {
  if (!existing || existing.source_sha256 !== sourceSha256) return true;
  // The same bytes keep a page too heavy to send: reading them again would only spend the plan on the other pages.
  return existing.error_code !== null && !LASTING_TRANSCRIPTION_ERRORS.has(existing.error_code);
}

export function countIllegiblePassages(text: string) {
  return text.match(/\[illisible\]/gi)?.length ?? 0;
}

/** The row a reading leaves: completed, partial (bound or failure) or failed (nothing read, and why). */
export function summarizeIntakeTranscription(input: {
  pagesNeeded: number;
  pagesSkipped: number;
  read: { page: number; text: string }[];
  errorCode: string | null;
}) {
  const pages = input.read.map(({ page, text }) => ({ page, text, illegible: countIllegiblePassages(text) }));
  if (!pages.length) {
    return { status: "failed" as const, pages, pages_needed: input.pagesNeeded, pages_skipped: input.pagesSkipped,
      error_code: input.errorCode ?? "TRANSCRIPTION_FAILED" };
  }
  const status = pages.length === input.pagesNeeded ? "completed" as const : "partial" as const;
  return { status, pages, pages_needed: input.pagesNeeded, pages_skipped: input.pagesSkipped,
    error_code: status === "completed" ? null : input.errorCode };
}

const transcriptionPageSchema = z.object({ page: z.number().int().positive(), text: z.string(), illegible: z.number().int().nonnegative() });

/** A stored row as the dossier shows it; null for a row that does not read as one. */
export function normalizeIntakeTranscription(row: {
  status: string; pages: unknown; pages_needed: number; pages_skipped: number; model: string | null;
  reasoning_effort: string | null; error_code: string | null; updated_at: string;
}): IntakeTranscription | null {
  const pages = z.array(transcriptionPageSchema).safeParse(row.pages);
  const status = z.enum(["completed", "partial", "failed"]).safeParse(row.status);
  if (!pages.success || !status.success) return null;
  return { status: status.data, pages: pages.data, pagesNeeded: row.pages_needed, pagesSkipped: row.pages_skipped,
    model: row.model, reasoningEffort: row.reasoning_effort, errorCode: row.error_code, readAt: row.updated_at };
}

/** Why a reading stopped, in the words of the dossier. */
export function intakeTranscriptionFailureMessage(code: string | null) {
  switch (code) {
    case "AI_KEY_CEILING": return "La transcription a atteint le plafond du lot de 2,00 $ US.";
    case "AI_KEY_MODEL_NOT_OFFERED":
    case "MODEL_UNAVAILABLE": return "La source utilisée pour la lecture ne propose pas GPT‑6.1 Terra avec un effort élevé.";
    case "AI_QUOTA": return "La limite du forfait ChatGPT a été atteinte pendant la lecture.";
    case "AI_RATE_LIMIT": return "ChatGPT a limité les demandes pendant la lecture.";
    case "AI_AUTH_REQUIRED": case "AI_NOT_CONFIGURED": return "La connexion ChatGPT utilisée pour la lecture doit être reconnectée.";
    case "PAGE_TOO_LARGE": return "Une page est trop lourde pour être lue.";
    case "PDF_INSPECTION_INCOMPLETE": return "Toutes les pages du PDF n’ont pas pu être examinées : des pages scannées peuvent manquer.";
    case "INVALID_ANSWER": return "La réponse de l’IA n’a pas pu être lue.";
    case null: return null;
    default: {
      const keyError = API_KEY_ERROR_CODES.find(candidate => candidate === code);
      return keyError ? apiKeyErrorMessage(keyError) : "L’IA n’a pas terminé la lecture.";
    }
  }
}
