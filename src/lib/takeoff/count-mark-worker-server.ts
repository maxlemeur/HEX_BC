import "server-only";
import { isDeepStrictEqual } from "node:util";

import type { StructuredCall, TokenUsage } from "@/lib/ai/structured-call";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
import { asRecord } from "@/lib/value-guards";
import { readItemKey } from "./bench/item-keys";
import { readDeterministic } from "./bench/count-pins/propose";
import type { JudgedPin, PageFrame } from "./bench/count-pins/types";
import { countMarkPageFrames } from "./count-mark-geometry-server";
import { locationResponse, pageProposals, readCountMarkTiles } from "./count-mark-reading";
import { countMarkSchedule, countMarkScheduleSchema, type MarkCoverage } from "./count-mark-schedule";
import { TakeoffError, TakeoffErrorCode } from "./errors";
import { TAKEOFF_PAID_CALL_ESTIMATE_TOKENS } from "./launch-call-ledger";
import type { Poste } from "./poste-list";
import { jsonbTextBytes } from "./rules/jsonb-size";
import { extractVectorPage } from "./vectors/extraction";

/** Check the sealed option against the original PDF and the remaining allowance before the first paid read. */
export async function prepareCountMarkReading(input: {
  jobId: string;
  snapshot: unknown;
  items: Poste[];
  bytes?: Uint8Array;
  planFileId: string;
  pages: number[];
  otherCalls: number;
  remainingTokens: number;
}) {
  const snapshot = asRecord(input.snapshot);
  if (!snapshot || !("remeasure_count_marks" in snapshot)) return null;
  const schedule = countMarkScheduleSchema.safeParse(snapshot.remeasure_count_marks);
  const changed = () =>
    new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_PREPARATION_SOURCE_CHANGED,
      retryable: false,
      jobId: input.jobId,
      message: "La portée ou les appels du repérage ont changé. Rouvrez le récapitulatif.",
    });
  const [item] = input.items;
  if (
    !schedule.success ||
    !input.bytes ||
    input.items.length !== 1 ||
    snapshot.remeasure_item !== item.id ||
    input.pages.length !== schedule.data.pages.length
  )
    throw changed();
  const frames = await countMarkPageFrames(
    input.bytes,
    [...input.pages].sort((a, b) => a - b),
  ).catch(() => {
    throw changed();
  });
  const sealed = schedule.data;
  if (
    !isDeepStrictEqual(frames, snapshot.remeasure_count_mark_frames) ||
    frames.some(
      ({ page, geometry }, index) =>
        page !== sealed.pages[index].page || geometry.width !== sealed.pages[index].width_points,
    )
  )
    throw changed();
  const current = countMarkSchedule(sealed.pages, input.otherCalls);
  if (
    current.other_calls > sealed.other_calls ||
    current.tile_calls !== sealed.tile_calls ||
    sealed.total_calls !== sealed.tile_calls + sealed.other_calls
  )
    throw changed();
  if (current.total_calls * TAKEOFF_PAID_CALL_ESTIMATE_TOKENS > input.remainingTokens) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED,
      retryable: false,
      jobId: input.jobId,
      message: "Le budget restant ne permet plus les lectures et les propositions. Rouvrez le récapitulatif.",
    });
  }
  return { bytes: input.bytes, frames, item, jobId: input.jobId, sheet: input.planFileId };
}

type Prepared = NonNullable<Awaited<ReturnType<typeof prepareCountMarkReading>>>;

export async function produceCountMarkGeneration(input: Prepared, call: StructuredCall, model: string) {
  const { item } = input;
  const designation = [item.label, item.qualifiers.diameter].filter(Boolean).join(" ");
  const key = readItemKey({ designation, unit: "u" }, { rooms: [] });
  const family = key.status === "out_of_score" ? null : key.key.organ;
  const diameter = (key.status !== "out_of_score" && key.key.dn?.printed) || item.qualifiers.diameter || null;
  const target = { id: item.id, organ: family, requiresDn: true };
  const coverage: MarkCoverage = [];
  const usage: TokenUsage = { totalTokens: 0, reasoningTokens: 0, inputTokens: 0, outputTokens: 0 };
  let costCents = 0;
  let calls = 0;
  let stopped = false;
  const generation = { pages: input.frames, marks: [] as ReturnType<typeof pageProposals>["marks"] };
  let bytes = jsonbTextBytes(generation);
  for (const { page, geometry } of input.frames) {
    const frame: PageFrame = {
      sheet: input.sheet,
      generation: input.jobId,
      page,
      width: geometry.width,
      height: geometry.height,
    };
    let vectorState: MarkCoverage[number]["vector_state"] = "failed";
    let vector: JudgedPin[] = [];
    let onInstallation: ((pin: JudgedPin) => boolean) | undefined;
    try {
      const extraction = await extractVectorPage(input.bytes, page);
      if (!extraction.paths.length && !extraction.texts.length) vectorState = "no_layer";
      else if (extraction.width === frame.width && extraction.height === frame.height) {
        const pins = readDeterministic({ id: input.sheet, generation: input.jobId, examples: [], extraction });
        onInstallation = pins.onInstallation;
        vector = pins["all-deterministic"]
          .filter((pin) => family && pin.organ === family)
          .map((pin) => ({ ...pin, poste: item.id }));
        vectorState = "read";
      }
    } catch {
      // Independent readers: a failed vector extraction still permits the agreed tiles to be read.
    }
    const result = await readCountMarkTiles(frame, target, async ({ id, crop }) => {
      if (stopped) return { status: "not_read", stop: true };
      const rendered = await renderPdfPages(input.bytes, {
        pages: [page],
        maxTextCharsPerPage: 1,
        maxTextItemsPerPage: 1,
        textItemOverflow: "truncate",
        image: { mode: "each", maxEdgePx: 1800, maxScale: 4, jpegQualities: [85, 65], maxBytes: 1_500_000, crop },
        limits: {
          maxPages: 1,
          maxInputBytes: 64_000_000,
          maxEmbeddedImagePixels: 8_000_000,
          maxHeapMb: 768,
          timeoutMs: 60_000,
        },
      }).catch(() => null);
      const sheet = rendered?.pages[0];
      if (!sheet?.image || sheet.failed || sheet.droppedImages) return { status: "not_read" };
      try {
        const response = await call({
          context: { jobId: input.jobId, model, promptVersion: "count-marks-v1" },
          takeoffTile: { page, ordinal: id + 1 },
          schema: locationResponse,
          files: [{ data: sheet.image.data, mimeType: sheet.image.mimeType, detail: "high" }],
          prompt:
            "Localise les occurrences installées du seul poste décrit ci-dessous sur cette image. " +
            "Ignore légendes, cartouches, schémas et détails types répétés. Ne multiplie jamais un dessin par un facteur. " +
            "Pour chaque occurrence visible, encadre son dessin entre 0 et 1 dans cette image, origine en haut à gauche. " +
            "Donne le DN seulement s’il est lisible, sinon null. Sur une image vide, renvoie pins vide. " +
            "Si tu ne peux pas terminer la tuile, renvoie le statut truncated.\n" +
            JSON.stringify({ poste: item.label, précisions: item.qualifiers }),
        });
        calls++;
        for (const field of ["inputTokens", "reasoningTokens", "outputTokens", "totalTokens"] as const)
          usage[field] += response.tokenUsage[field];
        costCents += response.costCents;
        if (response.data.status === "truncated") return { status: "truncated" };
        return { status: "complete", pins: response.data.pins.map((pin) => ({ ...pin, poste: item.id })) };
      } catch (error) {
        if (!(error instanceof TakeoffError)) throw error;
        if (error.code === TakeoffErrorCode.TAKEOFF_USAGE_UNRECORDED) {
          if (!asRecord(error.details)?.tileAttempted) return { status: "not_read", stop: true };
          calls++;
          return { status: "unknown" };
        }
        const paid = asRecord(error.details)?.paidUsage;
        if (typeof paid !== "number" || paid < 0) throw error;
        calls++;
        usage.totalTokens += paid;
        return { status: asRecord(error.details)?.truncated ? "truncated" : "failed" };
      }
    });
    stopped ||= result.stopped;
    const installed = onInstallation ? result.pins.filter(onInstallation) : result.pins;
    const proposed = pageProposals(vector, installed, frame, item.id, diameter);
    let limited = proposed.limited;
    for (const mark of proposed.marks) {
      const size = jsonbTextBytes(mark) + (generation.marks.length ? 2 : 0);
      if (generation.marks.length >= 20_000 || bytes + size > 16_777_216) {
        limited = true;
        break;
      }
      generation.marks.push(mark);
      bytes += size;
    }
    coverage.push({ page, vector_state: vectorState, tiles: result.tiles, limited });
  }
  return { generation, coverage, usage, costCents, calls };
}
