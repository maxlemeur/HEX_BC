import { expect, it, vi } from "vitest";
import { loadImage } from "@napi-rs/canvas";

import type { StructuredCallOptions } from "@/lib/ai/structured-call";
import { fictionalSheets } from "./bench/count-pins/fiction";
import { tileLayout } from "./bench/count-pins/replay";
import { countMarkPageFrames } from "./count-mark-geometry-server";
import { countMarkSchedule } from "./count-mark-schedule";
import { prepareCountMarkReading, produceCountMarkGeneration } from "./count-mark-worker-server";
import type { Poste } from "./poste-list";
import { boxContains } from "./vectors/geometry";

vi.mock("server-only", () => ({}));

it("renders every agreed crop of the original turned fiction and retains both readings of the same installed object", async () => {
  const fiction = (await fictionalSheets()).find(
    (sheet) => sheet.support === "vector" && sheet.rotation === 90 && sheet.truth.length,
  )!;
  const item = { id: "fixture-item", label: "Clapet anti-retour DN 25", qualifiers: {} } as Poste;
  const schedule = countMarkSchedule([{ page: fiction.page, width_points: fiction.size.width }], 1);
  const prepared = await prepareCountMarkReading({
    jobId: "fixture-job",
    planFileId: fiction.id,
    bytes: fiction.bytes,
    items: [item],
    pages: [fiction.page],
    pdfCalls: 1, classifierCalls: 0,
    remainingTokens: 1_000_000,
    snapshot: { remeasure_item: item.id, remeasure_count_marks: schedule,
      remeasure_count_mark_execution: { pdf_calls: 1, classifier_calls: 0,
        chunking: { thresholdPages: 15, chunkSizePages: 10, overlapPages: 2, maxPdfPages: 200 } },
      remeasure_count_mark_frames: await countMarkPageFrames(fiction.bytes, [fiction.page]) },
  });
  const seen: number[] = [];
  const layout = tileLayout({ ...fiction.size, sheet: fiction.id, generation: "test", page: fiction.page });
  const fieldValve = fiction.truth.find((pin) => pin.organ === "clapet-anti-retour")!;
  const call = async <T>(request: StructuredCallOptions<T>) => {
    const { ordinal, page } = request.takeoffTile!;
    expect(page).toBe(fiction.page);
    seen.push(ordinal);
    const image = await loadImage(Buffer.from(request.files![0].data, "base64"));
    const { crop } = layout[ordinal - 1];
    expect(image.width / image.height).toBeCloseTo((crop.x1 - crop.x0) / (crop.y1 - crop.y0), 2);
    const pins = boxContains(crop, fieldValve, -2)
      ? [
          {
            dn: 25,
            x0: (fieldValve.x - 1 - crop.x0) / (crop.x1 - crop.x0),
            x1: (fieldValve.x + 1 - crop.x0) / (crop.x1 - crop.x0),
            y0: (fieldValve.y - 1 - crop.y0) / (crop.y1 - crop.y0),
            y1: (fieldValve.y + 1 - crop.y0) / (crop.y1 - crop.y0),
          },
        ]
      : [];
    return {
      data: request.schema.parse({ status: "complete", pins }),
      tokenUsage: { totalTokens: 6, inputTokens: 4, reasoningTokens: 0, outputTokens: 2 },
      tokenCount: 6,
      costCents: 0,
      durationMs: 1,
      model: "fixture-model",
      promptVersion: "count-marks-v1",
    };
  };
  const result = await produceCountMarkGeneration(prepared!, call, "fixture-model");
  expect(seen).toEqual(layout.map(({ id }) => id + 1));
  expect(result.coverage[0]).toMatchObject({ vector_state: "read", tiles: Array(schedule.tile_calls).fill("read") });
  const installed = result.generation.marks.filter(
    (mark) => Math.hypot(mark.x * fiction.size.width - fieldValve.x, mark.y * fiction.size.height - fieldValve.y) <= 4,
  );
  expect(installed).toHaveLength(1);
  expect(installed[0].proposals.map((proposal) => proposal.method)).toEqual(["vector", "tile"]);
  for (const mark of result.generation.marks) {
    const centre = { x: mark.x * fiction.size.width, y: mark.y * fiction.size.height };
    expect(Object.values(fiction.negativeZones).some((zone) => boxContains(zone, centre))).toBe(false);
    expect(mark.proposals.every((source) => source.item_id === item.id)).toBe(true);
  }
}, 30_000);
