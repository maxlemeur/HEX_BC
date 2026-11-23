import { PDFDocument, degrees } from "pdf-lib";
import { expect, it, vi } from "vitest";

import { countMarkPageFrames } from "./count-mark-geometry-server";
import { prepareCountMarkReading, produceCountMarkGeneration } from "./count-mark-worker-server";
import { TakeoffError, TakeoffErrorCode } from "./errors";
import type { Poste } from "./poste-list";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pdf/page-render-server", () => ({
  renderPdfPages: async () => ({
    pages: [{ image: { data: "ZmljdGlvbg==", mimeType: "image/jpeg" }, droppedImages: 0 }],
  }),
}));
vi.mock("./vectors/extraction", async (original) => ({
  ...(await original<typeof import("./vectors/extraction")>()),
  extractVectorPage: async () => ({ paths: [], texts: [] }),
}));

const item = { id: "fixture", label: "Vanne DN 20", qualifiers: {}, referenceQuantity: 98241 } as Poste;

it("uses original rotated crop geometry and refuses a changed schedule before a call", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 900]);
  page.setCropBox(30, 50, 390, 750);
  page.setRotation(degrees(90));
  const bytes = await pdf.save();
  const frames = await countMarkPageFrames(bytes, [1]);
  expect(frames[0].geometry).toMatchObject({ width: 750, height: 390, rotation: 90, view_box: [30, 50, 420, 800] });
  const schedule = { pages: [{ page: 1, width_points: 750 }], other_calls: 2, tile_calls: 6, total_calls: 8 };
  const input = {
    jobId: "job",
    snapshot: { remeasure_count_marks: schedule, remeasure_item: item.id },
    bytes,
    items: [item],
    planFileId: "sheet",
    pages: [1],
    otherCalls: 2,
    remainingTokens: 1_000_000,
  };
  expect(await prepareCountMarkReading({ ...input, snapshot: {} })).toBeNull();
  await expect(prepareCountMarkReading({ ...input, otherCalls: 3 })).rejects.toThrow();
  const prepared = await prepareCountMarkReading(input);
  const call = vi.fn(async (request) => {
    expect(request.prompt).not.toContain("98241");
    if (request.takeoffTile.ordinal === 2)
      throw new TakeoffError({ code: TakeoffErrorCode.AI_SCHEMA, message: "invalide", details: { paidUsage: 17 } });
    if (request.takeoffTile.ordinal === 3)
      throw new TakeoffError({
        code: TakeoffErrorCode.TAKEOFF_USAGE_UNRECORDED,
        message: "inconnue",
        details: { tileAttempted: true },
      });
    return {
      data: { status: "complete", pins: [{ dn: 20, x0: 0.2, x1: 0.3, y0: 0.4, y1: 0.5 }] },
      tokenUsage: { totalTokens: 11, inputTokens: 7, outputTokens: 4, reasoningTokens: 0 },
      costCents: 0,
    };
  });
  const result = await produceCountMarkGeneration(prepared!, call as never, "fixture-model");
  expect(call.mock.calls.map(([r]) => r.takeoffTile)).toEqual([1, 2, 3].map((ordinal) => ({ page: 1, ordinal })));
  expect(result.coverage).toEqual([
    {
      page: 1,
      vector_state: "no_layer",
      tiles: ["read", "failed", "unknown", "not_read", "not_read", "not_read"],
      limited: false,
    },
  ]);
  expect(result.generation.marks).toHaveLength(1);
  expect(result.usage.totalTokens).toBe(28);
  const frozen = vi.fn(async () => {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_USAGE_UNRECORDED,
      message: "Une lecture antérieure a une consommation inconnue.",
    });
  });
  const partial = await produceCountMarkGeneration(prepared!, frozen, "fixture-model");
  expect(frozen).toHaveBeenCalledTimes(1);
  expect(partial.calls).toBe(0);
  expect(partial.coverage[0].tiles).toEqual(Array(6).fill("not_read"));
});
