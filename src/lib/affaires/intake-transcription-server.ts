import "server-only";

import { PDFDocument } from "pdf-lib";
import { z } from "zod";

import {
  INTAKE_TRANSCRIPTION_MAX_PAGES, INTAKE_TRANSCRIPTION_MODEL, INTAKE_TRANSCRIPTION_PAGE_TIMEOUT_MS,
  INTAKE_TRANSCRIPTION_PROMPT_VERSION, INTAKE_TRANSCRIPTION_REASONING_EFFORT, buildIntakeTranscriptionPrompt,
  intakeTranscriptionAnswerSchema, summarizeIntakeTranscription,
} from "@/lib/affaires/intake-transcription";
import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";
import {
  assertLocalChatGptOverride, callLocalChatGptStructured, LocalChatGptOverrideUnavailableError,
} from "@/lib/ai/chatgpt-local-inference";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
import type { GeminiStructuredFile } from "@/lib/takeoff/gemini-client";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
/** A page shorter than this once trimmed has no text layer worth the name: a scan. */
const SCANNED_PAGE_TEXT_CHARS = 30;
/** Pages whose text layer is checked; scans after them are not read (a dossier's scans come first or alone). */
const CHECKED_PAGES = 200;
/** What one page may weigh when sent (before base64). */
const MAX_PAGE_BYTES = 15 * 1024 * 1024;

const normalizedType = (mimeType: string) => mimeType.split(";")[0].trim().toLowerCase();

/** The formats a transcription may read: an image, or a PDF (whose scanned pages alone are read). */
export function canTranscribeIntakeDocument(mimeType: string) {
  const type = normalizedType(mimeType);
  return IMAGE_TYPES.has(type) || type === "application/pdf";
}

export type IntakeTranscriptionPlan = {
  /** Pages that need a reading: an image's one, the scanned pages among a PDF's checked pages. */
  pagesNeeded: number;
  /** Of these, left out by the bound per piece. */
  pagesSkipped: number;
  pageCount: number | null;
  /** The pages to read, in order; each is built when it is sent (`file`), so that one page at a time is held. */
  pages: { page: number; file: () => Promise<GeminiStructuredFile | null> }[];
};

const base64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64");

/** One page of the PDF as a PDF of its own, as the page is: nothing is drawn on it. Null when it weighs too much. */
async function onePagePdf(source: PDFDocument, page: number): Promise<GeminiStructuredFile | null> {
  const target = await PDFDocument.create();
  const [copied] = await target.copyPages(source, [page - 1]);
  target.addPage(copied);
  const bytes = await target.save();
  return bytes.byteLength > MAX_PAGE_BYTES ? null : { mimeType: "application/pdf", data: base64(bytes) };
}

/**
 * What a piece needs read: an image whole; in a PDF, the pages without text
 * (scans) among its first CHECKED_PAGES, the first
 * INTAKE_TRANSCRIPTION_MAX_PAGES of them. A PDF whose checked pages all have
 * their text, another format, or a PDF that cannot be read: nothing.
 */
export async function planIntakeTranscription(input: { mimeType: string; bytes: ArrayBuffer }): Promise<IntakeTranscriptionPlan | null> {
  const mimeType = normalizedType(input.mimeType);
  if (IMAGE_TYPES.has(mimeType)) {
    const fits = input.bytes.byteLength <= MAX_PAGE_BYTES;
    return { pagesNeeded: 1, pagesSkipped: 0, pageCount: 1,
      pages: [{ page: 1, file: async () => fits ? { mimeType, data: base64(input.bytes), detail: "high" } : null }] };
  }
  if (mimeType !== "application/pdf") return null;
  const read = await renderPdfPages(input.bytes, {
    pages: Array.from({ length: CHECKED_PAGES }, (_, index) => index + 1),
    maxTextCharsPerPage: 200, textItemOverflow: "truncate", image: null, limits: { timeoutMs: 30_000 },
  });
  if (!read.pages.length || read.pageCount === null) return null;
  const scanned = read.pages.filter((page) => !page.failed && page.text.trim().length < SCANNED_PAGE_TEXT_CHARS).map((page) => page.page);
  if (!scanned.length) return null;
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(input.bytes, { updateMetadata: false });
  } catch {
    return null;
  }
  const pages = scanned.slice(0, INTAKE_TRANSCRIPTION_MAX_PAGES).map((page) => ({
    page, file: () => onePagePdf(source, page).catch(() => null),
  }));
  return { pagesNeeded: scanned.length, pagesSkipped: scanned.length - pages.length, pageCount: read.pageCount, pages };
}

function failureCode(error: unknown) {
  if (error instanceof LocalChatGptOverrideUnavailableError) return "MODEL_UNAVAILABLE";
  if (error instanceof StructuredAiError) return error.code;
  if (error instanceof SyntaxError || error instanceof z.ZodError) return "INVALID_ANSWER";
  return "PROVIDER_ERROR";
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Reads the piece at arrival, on the plan of the member who added it, with
 * Terra at a high effort, and records what was read. A reading already done
 * for the same content is not redone. A failure is recorded on the piece and
 * never fails its analysis; only the lease's own error goes up (renewLease).
 */
export async function transcribeIntakeDocument(input: {
  supabase: ServiceClient;
  owner: ChatGptOwner;
  document: { id: string; tenantId: string; fileName: string };
  mimeType: string;
  bytes: ArrayBuffer;
  sourceSha256: string;
  renewLease: () => Promise<void>;
}) {
  const table = () => input.supabase.from("affaire_intake_document_transcriptions");
  const { data: existing, error: existingError } = await table().select("source_sha256,status,error_code")
    .eq("document_id", input.document.id).eq("tenant_id", input.document.tenantId).maybeSingle();
  if (existingError) throw existingError;
  // A reading of the same content is kept, unless a failure stopped it (quota, access): that one is read again.
  if (existing && existing.source_sha256 === input.sourceSha256 && existing.error_code === null) return { transcribed: false as const, reason: "already_read" };
  const plan = await planIntakeTranscription({ mimeType: input.mimeType, bytes: input.bytes });
  if (!plan) {
    // A new content that needs no reading takes the previous reading away.
    if (existing) {
      const { error } = await table().delete().eq("document_id", input.document.id).eq("tenant_id", input.document.tenantId);
      if (error) throw error;
    }
    return { transcribed: false as const, reason: "nothing_to_read" };
  }

  const read: { page: number; text: string }[] = [];
  let errorCode: string | null = null;
  let override: Awaited<ReturnType<typeof assertLocalChatGptOverride>> | null = null;
  try {
    const credential = await getLocalChatGptCredential(input.owner);
    // The plan's calls require a model chosen in the profile, even when this reading names its own.
    if (!credential?.model) throw new StructuredAiError("AI_NOT_CONFIGURED", "Connectez votre forfait ChatGPT et choisissez un modèle.");
    override = await assertLocalChatGptOverride(input.owner, credential,
      { model: INTAKE_TRANSCRIPTION_MODEL, reasoningEffort: INTAKE_TRANSCRIPTION_REASONING_EFFORT });
  } catch (error) {
    errorCode = error instanceof LocalChatGptOverrideUnavailableError || error instanceof StructuredAiError ? failureCode(error) : "AI_AUTH_REQUIRED";
  }
  for (const page of override ? plan.pages : []) {
    await input.renewLease();
    const file = await page.file();
    // A page too heavy to send is left unread; the next ones are still read.
    if (!file) {
      errorCode ??= "PAGE_TOO_LARGE";
      continue;
    }
    try {
      const answer = await callLocalChatGptStructured(input.owner, {
        prompt: buildIntakeTranscriptionPrompt({ fileName: input.document.fileName, page: page.page, pageCount: plan.pageCount }),
        schema: intakeTranscriptionAnswerSchema, files: [file], timeoutMs: INTAKE_TRANSCRIPTION_PAGE_TIMEOUT_MS,
        context: { promptVersion: INTAKE_TRANSCRIPTION_PROMPT_VERSION },
      }, undefined, override!);
      read.push({ page: page.page, text: answer.data.texte.trim() });
    } catch (error) {
      // The next pages would meet the same refusal (quota, access, model): the reading stops here.
      errorCode = failureCode(error);
      console.error("Affaire intake transcription failed", { documentId: input.document.id, page: page.page, error_code: errorCode });
      break;
    }
  }

  await input.renewLease();
  const outcome = summarizeIntakeTranscription({ pagesNeeded: plan.pagesNeeded, pagesSkipped: plan.pagesSkipped, read, errorCode });
  const { error } = await table().upsert({
    tenant_id: input.document.tenantId, document_id: input.document.id, source_sha256: input.sourceSha256, ...outcome,
    model: INTAKE_TRANSCRIPTION_MODEL, reasoning_effort: INTAKE_TRANSCRIPTION_REASONING_EFFORT,
    prompt_version: INTAKE_TRANSCRIPTION_PROMPT_VERSION,
  }, { onConflict: "document_id" });
  if (error) throw error;
  return { transcribed: true as const, status: outcome.status };
}
