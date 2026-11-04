import { describe, expect, it } from "vitest";

import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { visionReviewHook } from "@/lib/takeoff/bench/vision-review-server";
import { VISION_REVIEW_LIMITS, type VisionLine } from "@/lib/takeoff/bench/vision-review";
import type { VectorBenchDocument } from "@/lib/takeoff/bench/vector-run";
import type { PdfRenderOptions } from "@/lib/pdf/page-render-server";

// The ChatGPT side of the bench's vision pass (TI-664 L5c). Ways it fails, written before the code (fictional data):
// - a call is sent with images of other lines, or more than linesPerCall lines, or under another profile than the
//   one the run checked (the selection is not passed: a changed profile would be used silently);
// - a crop that could not be rendered is sent as nothing, or ends the page; its line is simply not asked;
// - an answer that does not parse (schema failure) ends the run, or loses its line's count;
// - V6: « Limite du forfait ChatGPT » (AI_QUOTA) is counted as a failed call and the next call is sent.
// Review of the pass (written before the fix):
// - a crop not drawn is only logged: the report counts its line as asked, and says nothing of the render;
// - an answer for a line not sent in that call (not drawn, or another call's) is applied to it;
// - a schema failure's tokens (attached to the error) are lost, and reasoning tokens are reported nowhere.

const owner = { userId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222" };
const selection = { profileId: "profile-1", model: "fixture-model", reasoningEffort: null };
const document: VectorBenchDocument = { id: "a-plan-01", lot: "a", role: "truth", bytes: new Uint8Array([37, 80, 68, 70]), sha256: "1".repeat(64), pages: 1 };

function lines(count: number): VisionLine[] {
  return Array.from({ length: count }, (_, index) => ({
    alias: `L${index + 1}`, index, designation: `EF DN ${20 + index}`, quantity: 5, unit: "ml",
    failures: [{ code: "DN_NETWORK_MATERIAL_MISSING", reason: "Matériau non lu." }], read: { network: "EF", material: null, dn: `DN ${20 + index}` },
    box_pt: { x0: index, y0: 0, x1: index + 10, y1: 10 },
  }));
}

function fakeRender(failing: number[] = []) {
  const crops: number[] = [];
  const render = async (_bytes: Uint8Array | ArrayBuffer, options: PdfRenderOptions) => {
    const x0 = options.image?.mode === "each" ? options.image.crop?.x0 ?? -1 : -1;
    crops.push(x0);
    const image = failing.includes(x0) ? null : { mimeType: "image/jpeg" as const, data: `img-${x0}`, width: 100, height: 100, bytes: 10 };
    return { pages: [{ page: 1, image, imageIssue: image ? null : "render_failed" }], durationMs: 50, timedOut: false } as never;
  };
  return { crops, render };
}

describe("visionReviewHook", () => {
  it("asks for each line with its own crop, in calls of at most linesPerCall lines, under the checked profile", async () => {
    const calls: Array<{ images: string[]; selection: unknown; prompt: string }> = [];
    const { crops, render } = fakeRender([2]);
    const hook = visionReviewHook({ owner, selection, render, call: async (_owner, options, sent) => {
      calls.push({ images: (options.files ?? []).map((file) => file.data), selection: sent, prompt: options.prompt });
      return { data: { lines: [] }, tokenUsage: { inputTokens: 1000, outputTokens: 50, reasoningTokens: 0, totalTokens: 1050 }, durationMs: 1800 } as never;
    } });
    const outcome = await hook.review(document, 1, lines(VISION_REVIEW_LIMITS.linesPerCall + 2));
    expect(crops).toEqual(Array.from({ length: VISION_REVIEW_LIMITS.linesPerCall + 2 }, (_, index) => index));
    // Line 3 (crop 2) could not be drawn: it is not asked, the others are, in order.
    expect(calls.map((call) => call.images)).toEqual([["img-0", "img-1", "img-3", "img-4", "img-5"], ["img-6", "img-7"]]);
    expect(calls.every((call) => call.selection === selection)).toBe(true);
    expect(calls[0].prompt).toContain("L1 (image 1)");
    expect(calls[0].prompt).not.toContain("L3 (image");
    expect(outcome.not_drawn).toEqual([{ alias: "L3", issue: "render_failed" }]);
    expect(outcome).toMatchObject({ stop: null, render_ms: Array(8).fill(50),
      calls: [{ lines: 5, status: "ok", latency_ms: 1800, usage: { input_tokens: 1000, output_tokens: 50, reasoning_tokens: 0, total_tokens: 1050 } },
        { lines: 2, status: "ok" }] });
  });

  it("keeps only the answers for the lines sent in that call", async () => {
    const { render } = fakeRender([1]);
    const hook = visionReviewHook({ owner, selection, render, call: async () => ({ data: { lines: [
      { alias: "L1", verdict: "corrige", network: "EF", material: "cuivre", dn: "22", label: "EF cu 22" },
      { alias: "L2", verdict: "corrige", network: "EF", material: "cuivre", dn: "22", label: "EF cu 22" },
      { alias: "L9", verdict: "corrige", network: "EF", material: "cuivre", dn: "22", label: "EF cu 22" },
    ] }, tokenUsage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 }, durationMs: 10 }) as never });
    const outcome = await hook.review(document, 1, lines(2));
    expect(outcome.answers.map((answer) => answer.alias)).toEqual(["L1"]);
  });

  it("keeps the tokens a schema failure consumed, reasoning tokens apart", async () => {
    const { render } = fakeRender();
    const hook = visionReviewHook({ owner, selection, render, call: async () => {
      throw Object.assign(new SyntaxError("Unexpected token"), { usage: { inputTokens: 900, outputTokens: 40, reasoningTokens: 300, totalTokens: 1240 } });
    } });
    const outcome = await hook.review(document, 1, lines(1));
    expect(outcome.calls).toMatchObject([{ status: "schema_failure", usage: { input_tokens: 900, output_tokens: 40, reasoning_tokens: 300, total_tokens: 1240 } }]);
  });

  it("counts an answer that does not parse and goes on", async () => {
    const { render } = fakeRender();
    let call = 0;
    const hook = visionReviewHook({ owner, selection, render, call: async () => {
      call += 1;
      if (call === 1) throw new SyntaxError("Unexpected token");
      return { data: { lines: [{ alias: "L7", verdict: "illisible", network: null, material: null, dn: null, label: null }] },
        tokenUsage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 }, durationMs: 10 } as never;
    } });
    const outcome = await hook.review(document, 1, lines(VISION_REVIEW_LIMITS.linesPerCall + 1));
    expect(outcome.calls.map((entry) => [entry.lines, entry.status])).toEqual([[VISION_REVIEW_LIMITS.linesPerCall, "provider_failed"], [1, "ok"]]);
    expect(outcome.answers).toEqual([{ alias: "L7", verdict: "illisible", network: null, material: null, dn: null, label: null }]);
    expect(outcome.stop).toBeNull();
  });

  it("stops at the first « Limite du forfait ChatGPT », with no later call (V6)", async () => {
    const { render } = fakeRender();
    let sent = 0;
    const hook = visionReviewHook({ owner, selection, render, call: async () => {
      sent += 1;
      throw new StructuredAiError("AI_QUOTA", "Limite du forfait ChatGPT atteinte.", 429);
    } });
    const outcome = await hook.review(document, 1, lines(VISION_REVIEW_LIMITS.linesPerCall + 1));
    expect(sent).toBe(1);
    expect(outcome.stop).toEqual({ reason: "quota", message: "Limite du forfait ChatGPT atteinte." });
    expect(outcome.calls).toMatchObject([{ status: "stopped", usage: null }]);
  });
});
