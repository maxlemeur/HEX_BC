import { PDFDocument } from "pdf-lib";

import type { TakeoffExchange } from "@/lib/takeoff/types";
import type { DownloadedTakeoffFile } from "@/lib/takeoff/source-loader";
import { toUnitToken } from "@/lib/takeoff/units";

export type TakeoffPdfChunk = {
  index: number;
  startPage: number;
  endPage: number;
};

export type TakeoffChunkingRuntimeConfig = {
  thresholdPages: number;
  chunkSizePages: number;
  overlapPages: number;
};

export type TakeoffChunkExchange = {
  chunk: TakeoffPdfChunk;
  exchange: TakeoffExchange;
};

export type MergedTakeoffChunkExchange = {
  exchange: TakeoffExchange;
  deduplicatedItems: number;
  duplicateItems: number;
};

function normalizeTextToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeConfidence(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return -1;
  }
  return value;
}

function mergeEvidence(a: string | undefined, b: string | undefined) {
  const merged = new Set<string>();
  [a, b].forEach((value) => {
    if (typeof value !== "string") return;
    const normalized = value.trim();
    if (normalized.length > 0) {
      merged.add(normalized);
    }
  });

  if (merged.size === 0) return undefined;
  return Array.from(merged).join(" | ");
}

function dedupeWarnings(warnings: TakeoffExchange["warnings"]) {
  const seen = new Set<string>();
  const deduped: TakeoffExchange["warnings"] = [];

  warnings.forEach((warning) => {
    const key = JSON.stringify(warning);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(warning);
  });

  return deduped;
}

/** The key mergeTakeoffChunkExchanges merges items on: designation, unit and page. */
export function buildItemKey(item: TakeoffExchange["items"][number]) {
  const designation = normalizeTextToken(item.designation);
  const unit = toUnitToken(item.unit);
  const sourcePage = item.source_page ?? 0;
  return `${designation}::${unit}::${sourcePage}`;
}

export async function getPdfPageCount(bytes: ArrayBuffer) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPageCount();
}

export function buildPdfChunks(
  pageCount: number,
  config: TakeoffChunkingRuntimeConfig
): TakeoffPdfChunk[] {
  if (!Number.isInteger(pageCount) || pageCount <= 0) {
    throw new Error("pageCount doit être un entier strictement positif.");
  }

  if (
    !Number.isInteger(config.thresholdPages) ||
    config.thresholdPages <= 0 ||
    !Number.isInteger(config.chunkSizePages) ||
    config.chunkSizePages <= 0 ||
    !Number.isInteger(config.overlapPages) ||
    config.overlapPages < 0
  ) {
    throw new Error("Configuration de chunking invalide.");
  }

  if (config.overlapPages >= config.chunkSizePages) {
    throw new Error("chunk_overlap_pages doit être strictement inférieur a chunk_size_pages.");
  }

  if (pageCount <= config.thresholdPages) {
    return [
      {
        index: 0,
        startPage: 1,
        endPage: pageCount,
      },
    ];
  }

  const step = config.chunkSizePages - config.overlapPages;
  const chunks: TakeoffPdfChunk[] = [];
  let index = 0;

  for (let startPage = 1; startPage <= pageCount; startPage += step) {
    const endPage = Math.min(startPage + config.chunkSizePages - 1, pageCount);
    chunks.push({
      index,
      startPage,
      endPage,
    });
    index += 1;

    if (endPage >= pageCount) {
      break;
    }
  }

  return chunks;
}

export async function createPdfChunkBytes(input: {
  bytes: ArrayBuffer;
  chunk: TakeoffPdfChunk;
}): Promise<Uint8Array> {
  const sourcePdf = await PDFDocument.load(input.bytes);
  const totalPages = sourcePdf.getPageCount();
  const startIndex = input.chunk.startPage - 1;
  const endIndex = input.chunk.endPage - 1;

  if (
    startIndex < 0 ||
    endIndex < startIndex ||
    endIndex >= totalPages ||
    input.chunk.endPage <= 0
  ) {
    throw new Error("Bornes de pages chunk invalides.");
  }

  const pageIndexes = Array.from(
    { length: endIndex - startIndex + 1 },
    (_, offset) => startIndex + offset
  );
  const outputPdf = await PDFDocument.create();
  const pages = await outputPdf.copyPages(sourcePdf, pageIndexes);
  pages.forEach((page) => outputPdf.addPage(page));
  return outputPdf.save();
}

export function createChunkPromptSourceHint(input: {
  fileName: string;
  chunk: TakeoffPdfChunk;
  totalChunks: number;
}) {
  return `${input.fileName} | chunk ${input.chunk.index + 1}/${input.totalChunks} | pages ${
    input.chunk.startPage
  }-${input.chunk.endPage}`;
}

/**
 * Where an unmeasured quantity is, read on the model's own structure: « Page N : observation », N a page of the
 * fragment and the observation not empty. The display text, built from file names, never decides it.
 */
function locateUnmeasuredQuantity(chunk: TakeoffPdfChunk, warning: TakeoffExchange["warnings"][number]) {
  if (warning.code !== "QUANTITE_A_VERIFIER") return null;
  const heading = /^Page\s+([0-9]+)\s*:\s*/iu.exec(warning.message);
  const localPage = heading ? Number(heading[1]) : 0;
  const index = chunk.startPage - 1 + localPage - 1;
  const observation = heading ? warning.message.slice(heading[0].length).trim() : "";
  return localPage > 0 && index < chunk.endPage && observation ? { index, observation } : null;
}

/** The unmeasured quantities of a fragment's answer that have a page and an observation (see above). */
export function countLocatedUnmeasuredQuantities(input: { chunk: TakeoffPdfChunk; exchange: TakeoffExchange }) {
  return input.exchange.warnings.filter((warning) => locateUnmeasuredQuantity(input.chunk, warning)).length;
}

export function remapChunkLocalPagesToAbsolute(input: {
  chunk: TakeoffPdfChunk;
  exchange: TakeoffExchange;
  source?: Pick<DownloadedTakeoffFile, "fileName" | "sourceFileNamesByPage" | "sourcePageNumbersByPage" | "sourceDocumentsByPage">;
}): TakeoffExchange {
  const pageOffset = input.chunk.startPage - 1;
  const { source, chunk } = input;
  const idsByName = new Map<string, Map<string, number>>();
  const planIdAt = (index: number) => {
    const document = source?.sourceDocumentsByPage?.[index];
    return document?.kind === "plan_file" ? document.plan_file_id : null;
  };
  source?.sourceFileNamesByPage?.forEach((name, index) => {
    const id = planIdAt(index);
    if (!id) return;
    const ids = idsByName.get(name) ?? new Map<string, number>();
    if (!ids.has(id)) ids.set(id, ids.size + 1);
    idsByName.set(name, ids);
  });

  return {
    ...input.exchange,
    warnings: source ? input.exchange.warnings.map((warning) => {
      if (warning.code !== "QUANTITE_A_VERIFIER") return warning;
      const located = locateUnmeasuredQuantity(chunk, warning);
      if (!located) {
        const observation = warning.message.replace(/^Page\s+[0-9]+\s*:\s*/iu, "").trim() || warning.message;
        return { ...warning, message: `${source.fileName} · page indéterminée (fragment ${chunk.index + 1}) — ${observation}`.slice(0, 500) };
      }
      const file = source.sourceFileNamesByPage?.[located.index] ?? source.fileName;
      const ids = idsByName.get(file);
      const id = planIdAt(located.index);
      const ordinal = id && ids && ids.size > 1 ? ids.get(id) : null;
      const label = ordinal ? `${file} (fichier ${ordinal})` : file;
      const page = source.sourcePageNumbersByPage?.[located.index] ?? located.index + 1;
      return { ...warning, message: `${label} · page ${page} — ${located.observation}`.slice(0, 500) };
    }) : input.exchange.warnings,
    items: input.exchange.items.map((item) => ({
      ...item,
      source_page: item.source_page === undefined ? undefined : item.source_page + pageOffset,
    })),
    tables: input.exchange.tables?.map((table) => ({
      ...table,
      page: table.page + pageOffset,
    })),
  };
}

export function mergeTakeoffChunkExchanges(
  chunkExchanges: TakeoffChunkExchange[]
): MergedTakeoffChunkExchange {
  if (chunkExchanges.length === 0) {
    throw new Error("Au moins un résultat de chunk est requis.");
  }

  const itemsByKey = new Map<string, TakeoffExchange["items"][number]>();
  const allWarnings: TakeoffExchange["warnings"] = [];
  const allTables: NonNullable<TakeoffExchange["tables"]> = [];
  let duplicateItems = 0;

  chunkExchanges.forEach((entry) => {
    allWarnings.push(...entry.exchange.warnings);

    if (Array.isArray(entry.exchange.tables)) {
      allTables.push(...entry.exchange.tables);
    }

    entry.exchange.items.forEach((item) => {
      const key = buildItemKey(item);
      const existing = itemsByKey.get(key);

      if (!existing) {
        itemsByKey.set(key, { ...item });
        return;
      }

      duplicateItems += 1;
      const existingConfidence = normalizeConfidence(existing.confidence);
      const incomingConfidence = normalizeConfidence(item.confidence);

      if (incomingConfidence > existingConfidence) {
        itemsByKey.set(key, {
          ...item,
          evidence: mergeEvidence(existing.evidence, item.evidence),
          source_file: item.source_file ?? existing.source_file,
        });
        return;
      }

      itemsByKey.set(key, {
        ...existing,
        evidence: mergeEvidence(existing.evidence, item.evidence),
      });
    });
  });

  const first = chunkExchanges[0]?.exchange;
  const confidenceValues = chunkExchanges
    .map((entry) => entry.exchange.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageConfidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : first?.confidence;

  return {
    exchange: {
      items: Array.from(itemsByKey.values()),
      warnings: dedupeWarnings(allWarnings),
      tables: allTables.length > 0 ? allTables : undefined,
      metadata: first.metadata,
      confidence: averageConfidence,
    },
    deduplicatedItems: itemsByKey.size,
    duplicateItems,
  };
}
