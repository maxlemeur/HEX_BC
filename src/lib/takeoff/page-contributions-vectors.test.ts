import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  estimateLineTakeoffItemIds,
  findPagesAlreadyInEstimate,
  isSamePage,
  takeoffLinePageIdentity,
  type EarlierTakeoffLine,
  type EstimateLineProvenance,
  type NewTakeoffLine,
  type PageDocumentSource,
  type TakeoffPageIdentity,
} from "@/lib/takeoff/page-contributions";

// TI-682 lot D, PR 2: the database guard reads « the same page » and the earlier contribution of a page with its own
// functions (private.takeoff_same_page, private.takeoff_line_page_identity, private.takeoff_estimate_line_item_ids,
// private.takeoff_pages_already_in_estimate). Both readers run these vectors: this file runs the TypeScript reader, and
// supabase/tests/database/takeoff-page-contributions-twin.test.sql the SQL twin, on an embedded copy that must stay
// identical to page-contributions.vectors.json. Fictional identifiers and file names only.

type Vectors = {
  version: 1;
  same_page: Array<{ name: string; left: TakeoffPageIdentity; right: TakeoffPageIdentity; expected: boolean }>;
  line_identity: Array<{ name: string; line: { source_file_name: string | null; source_page: number | null; source_document?: unknown };
    sources: PageDocumentSource[] | null; expected: TakeoffPageIdentity | null }>;
  line_item_ids: Array<{ name: string; source_metadata: unknown; source_job_id: string | null; expected: string[] }>;
  pages: Array<{ name: string; job_id: string | null; new_lines: NewTakeoffLine[]; estimate_lines: EstimateLineProvenance[];
    earlier_items: EarlierTakeoffLine[]; job_sources?: Record<string, PageDocumentSource[]>; expected: ReturnType<typeof findPagesAlreadyInEstimate> }>;
};

const VECTORS_FILE = path.join(process.cwd(), "src/lib/takeoff/page-contributions.vectors.json");
const SQL_TWIN_FILE = path.join(process.cwd(), "supabase/tests/database/takeoff-page-contributions-twin.test.sql");
const vectors = JSON.parse(fs.readFileSync(VECTORS_FILE, "utf8")) as Vectors;

describe("page identity vectors — the TypeScript reader", () => {
  it.each(vectors.same_page.map((entry) => [entry.name, entry] as const))("same page: %s", (_name, entry) => {
    expect(isSamePage(entry.left, entry.right)).toBe(entry.expected);
    expect(isSamePage(entry.right, entry.left)).toBe(entry.expected);
  });

  it.each(vectors.line_identity.map((entry) => [entry.name, entry] as const))("line identity: %s", (_name, entry) => {
    expect(takeoffLinePageIdentity(entry.line, entry.sources)).toEqual(entry.expected);
  });

  it.each(vectors.line_item_ids.map((entry) => [entry.name, entry] as const))("source lines: %s", (_name, entry) => {
    expect(estimateLineTakeoffItemIds(entry.source_metadata, entry.source_job_id)).toEqual(entry.expected);
  });

  it.each(vectors.pages.map((entry) => [entry.name, entry] as const))("pages already in the estimate: %s", (_name, entry) => {
    expect(findPagesAlreadyInEstimate({ jobId: entry.job_id, newLines: entry.new_lines, estimateLines: entry.estimate_lines,
      earlierItems: new Map(entry.earlier_items.map((item) => [item.id, item])),
      jobSources: new Map(Object.entries(entry.job_sources ?? {})) })).toEqual(entry.expected);
  });

  it("covers the cases the SQL guard depends on", () => {
    // A guard that passes these is not proven by an empty table: each section holds both outcomes.
    expect(new Set(vectors.same_page.map((entry) => entry.expected))).toEqual(new Set([true, false]));
    expect(vectors.line_identity.some((entry) => entry.expected === null)).toBe(true);
    expect(vectors.pages.some((entry) => entry.expected.pages.length === 0)).toBe(true);
    expect(vectors.pages.some((entry) => entry.expected.pages.length > 1)).toBe(true);
    expect(vectors.pages.some((entry) => entry.expected.unidentified_item_ids.length > 0)).toBe(true);
  });
});

describe("page identity vectors — the SQL twin reads the same file", () => {
  it("embeds a copy identical to page-contributions.vectors.json", () => {
    const sql = fs.readFileSync(SQL_TWIN_FILE, "utf8");
    const embedded = /\$vectors\$\n([\s\S]*?)\$vectors\$/.exec(sql)?.[1];
    expect(embedded, "the pgTAP file embeds the vectors between $vectors$ quotes").toBeDefined();
    expect(JSON.parse(embedded!)).toEqual(vectors);
  });
});
