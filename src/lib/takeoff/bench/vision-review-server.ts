import { callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
import { classifyCallError, describeError } from "@/lib/takeoff/bench/run";
import type { VectorVisionHook } from "@/lib/takeoff/bench/vector-run";
import {
  VISION_REVIEW_LIMITS,
  VISION_REVIEW_PROMPT_VERSION,
  visionAnswerSchema,
  visionPrompt,
  type VisionAnswer,
  type VisionCall,
  type VisionLine,
  type VisionPageOutcome,
} from "@/lib/takeoff/bench/vision-review";

// The ChatGPT side of the bench's vision pass (TI-664 L5c): each line's crop drawn by pdfjs (page-render-server.ts,
// a child process), then one call per linesPerCall lines through the local ChatGPT profile, under the selection the
// run checked before its first call (a changed profile stops the run, never used). A crop that cannot be drawn is
// not asked; an answer that does not parse is a counted failure; a provider stop (quota « Limite du forfait
// ChatGPT », rate limit, authorisation, changed profile) ends the page and the run.

type Selection = { profileId: string; model: string; reasoningEffort: string | null };

const RENDER_LIMITS = { maxInputBytes: 64 * 1024 * 1024, maxPages: 1, maxHeapMb: 768, maxEmbeddedImagePixels: 8_000_000 } as const;

export function visionReviewHook(input: {
  owner: ChatGptOwner;
  selection: Selection;
  log?: (line: string) => void;
  call?: typeof callLocalChatGptStructured;
  render?: typeof renderPdfPages;
}): VectorVisionHook {
  const call = input.call ?? callLocalChatGptStructured;
  const render = input.render ?? renderPdfPages;
  return {
    promptVersion: VISION_REVIEW_PROMPT_VERSION,
    review: async (document, page, lines): Promise<VisionPageOutcome> => {
      const calls: VisionCall[] = [];
      const renderMs: number[] = [];
      const answers: VisionAnswer[] = [];
      for (let start = 0; start < lines.length; start += VISION_REVIEW_LIMITS.linesPerCall) {
        const drawn: Array<{ line: VisionLine; image: { mimeType: string; data: string } }> = [];
        for (const line of lines.slice(start, start + VISION_REVIEW_LIMITS.linesPerCall)) {
          const rendered = await render(document.bytes, {
            pages: [page], maxTextCharsPerPage: 1, maxTextItemsPerPage: 1, textItemOverflow: "truncate",
            image: { mode: "each", maxEdgePx: VISION_REVIEW_LIMITS.maxEdgePx, jpegQualities: [...VISION_REVIEW_LIMITS.jpegQualities],
              maxBytes: VISION_REVIEW_LIMITS.maxBytes, crop: line.box_pt, maxScale: VISION_REVIEW_LIMITS.maxScale },
            limits: { ...RENDER_LIMITS, timeoutMs: VISION_REVIEW_LIMITS.renderTimeoutMs },
          });
          renderMs.push(rendered.durationMs);
          const image = rendered.pages.find((entry) => entry.page === page)?.image ?? null;
          if (image) drawn.push({ line, image: { mimeType: image.mimeType, data: image.data } });
          else input.log?.(`[vision] ${document.id} p${page} ${line.alias}: crop not drawn, line not asked`);
        }
        if (drawn.length === 0) continue;
        const started = Date.now();
        try {
          const result = await call(input.owner, {
            prompt: visionPrompt(drawn.map(({ line }) => line)), schema: visionAnswerSchema, files: drawn.map(({ image }) => image),
            timeoutMs: VISION_REVIEW_LIMITS.callTimeoutMs, maxRetries: 0,
          }, input.selection as never);
          calls.push({ lines: drawn.length, status: "ok", latency_ms: result.durationMs,
            usage: { input_tokens: result.tokenUsage.inputTokens, output_tokens: result.tokenUsage.outputTokens, total_tokens: result.tokenUsage.totalTokens } });
          answers.push(...result.data.lines);
        } catch (error) {
          const classified = classifyCallError(error);
          const latency = Date.now() - started;
          if (classified.outcome === "stop") {
            calls.push({ lines: drawn.length, status: "stopped", latency_ms: latency, usage: null });
            return { calls, render_ms: renderMs, answers, stop: { reason: classified.reason, message: describeError(error).message } };
          }
          calls.push({ lines: drawn.length, status: classified.status as VisionCall["status"], latency_ms: latency, usage: null });
          input.log?.(`[vision] ${document.id} p${page}: ${classified.status} (${describeError(error).message})`);
        }
      }
      return { calls, render_ms: renderMs, answers, stop: null };
    },
  };
}
