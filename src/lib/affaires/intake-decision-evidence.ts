import "server-only";

import type { OpenAiDecisionImage } from "@/lib/ai/decisions";
import {
  PDF_RENDER_DEFAULT_LIMITS,
  PDF_TEXT_DEFAULTS,
  PDF_THUMBNAIL_DEFAULTS,
  renderPdfPages,
} from "@/lib/pdf/page-render-server";

export type IntakeDecisionEvidence = {
  text: string;
  images: OpenAiDecisionImage[];
  sampledPages: number[];
  pageCount?: number;
  issues: string[];
};

const SAMPLE_PAGES = [1, 2];
const SAMPLE_TEXT_CHARS = 12000;

/**
 * First-pages sample on the shared page reader, with the historical intake
 * bounds: text of pages 1-2 up to 12 000 characters in total (more than
 * 20 000 text items fails the document), and a first-page JPEG only when the
 * text is too short to classify (scanned PDF). A raster above the decoded
 * bound, or undecodable, is missing from that JPEG (TI-715): it is said in
 * the issues, and a JPEG left white by it is not sent.
 */
async function samplePdf(bytes: ArrayBuffer): Promise<IntakeDecisionEvidence> {
  const fallback: IntakeDecisionEvidence = {
    text: "",
    images: [],
    sampledPages: [],
    issues: [
      "Lecture locale du PDF incomplète. La catégorie reste à confirmer.",
    ],
  };
  const timeoutIssue = "Lecture PDF limitée dans le temps : vérifiez la proposition.";
  const rendered = await renderPdfPages(bytes, {
    pages: SAMPLE_PAGES,
    maxTextCharsPerPage: SAMPLE_TEXT_CHARS,
    maxTotalTextChars: SAMPLE_TEXT_CHARS,
    textItemOverflow: "fail",
    maxTextItemsPerPage: PDF_TEXT_DEFAULTS.maxTextItemsPerPage,
    image: { mode: "if_text_below", minTextChars: 80, page: 1, ...PDF_THUMBNAIL_DEFAULTS, jpegQualities: [...PDF_THUMBNAIL_DEFAULTS.jpegQualities] },
    limits: PDF_RENDER_DEFAULT_LIMITS,
  });
  if (!rendered.pages.length) {
    return rendered.timedOut ? { ...fallback, issues: [...fallback.issues, timeoutIssue] } : fallback;
  }
  const result: IntakeDecisionEvidence = {
    text: rendered.pages.map((page) => page.text).join(""),
    // A white picture of a scan whose raster is too large to read carries nothing.
    images: rendered.status === "complete"
      ? rendered.pages.flatMap((page) => page.image && !(page.image.blank && page.droppedImages > 0)
        ? [{ mimeType: page.image.mimeType, data: page.image.data }] : [])
      : [],
    sampledPages: rendered.pages.map((page) => page.page),
    ...(rendered.pageCount === null ? {} : { pageCount: rendered.pageCount }),
    issues: [],
  };
  if (rendered.status !== "complete") {
    return rendered.timedOut ? { ...result, issues: [timeoutIssue] } : result;
  }
  // A thumbnail render that threw used to abort the sample: keep that partial result.
  if (rendered.pages.some((page) => page.imageIssue === "render_failed")) return result;
  if ((rendered.pageCount ?? 0) > result.sampledPages.length)
    result.issues.push("Decisions consulte un échantillon des premières pages : catégorie à confirmer.");
  if (rendered.pages.some((page) => page.image !== null && page.droppedImages > 0))
    result.issues.push("L’aperçu du PDF omet une image trop lourde ou illisible : la catégorie reste à confirmer.");
  if (!result.text.trim() && !result.images.length)
    result.issues.push("Le PDF n’a pas fourni de contenu lisible : le classement reste à vérifier.");
  return result;
}

/** Receives spreadsheet/text snippets already bounded by the intake parser. */
export async function buildIntakeDecisionEvidence(input: {
  mimeType: string;
  bytes: ArrayBuffer;
  text?: string;
}): Promise<IntakeDecisionEvidence> {
  if (input.mimeType === "application/pdf") return samplePdf(input.bytes);
  const empty = {
    text: (input.text ?? "").slice(0, 12000),
    images: [] as OpenAiDecisionImage[],
    sampledPages: [] as number[],
    issues: [] as string[],
  };
  if (["image/png", "image/jpeg", "image/webp"].includes(input.mimeType)) {
    if (input.bytes.byteLength <= 1500000)
      empty.images.push({
        mimeType: input.mimeType as OpenAiDecisionImage["mimeType"],
        data: Buffer.from(input.bytes).toString("base64"),
      });
    else
      empty.issues.push(
        "Image trop volumineuse pour l’aperçu de classement. Vérifiez la catégorie proposée.",
      );
  }
  if (!empty.text.trim() && !empty.images.length)
    empty.issues.push(
      "Contenu non extrait localement : le nom seul reste un indice à vérifier.",
    );
  return empty;
}
