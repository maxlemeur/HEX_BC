import { describe, expect, it } from "vitest";

import {
  estimateLineTakeoffItemIds,
  findPagesAlreadyInEstimate,
  isSamePage,
  launchDocumentsOf,
  takeoffLinePageIdentity,
  type EarlierTakeoffLine,
  type EstimateLineProvenance,
  type TakeoffPageIdentity,
} from "@/lib/takeoff/page-contributions";

// TI-682 lot D, PR 1: a plan page enters an estimate once. Before any refusal, the estimator is warned when a takeoff
// reads a page that another takeoff already brought into the same estimate version. These cases fix the definition
// of « the same page » and how the earlier contribution is traced from the estimate's lines to the frozen takeoff
// lines; the SQL twin of PR 2 reads the same cases. Fictional identifiers and file names only.

const PLAN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_EARLIER = "11111111-1111-4111-8111-111111111111";
const JOB_NEW = "22222222-2222-4222-8222-222222222222";
const JOB_OTHER = "33333333-3333-4333-8333-333333333333";
const HASH = "c".repeat(64);
const OTHER_HASH = "d".repeat(64);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const doc = (input: Partial<TakeoffPageIdentity["document"]>) => ({ plan_file_id: null, content_hash: null, logical_document_id: null, file_name: null, ...input });
const at = (document: Partial<TakeoffPageIdentity["document"]>, page: number | null): TakeoffPageIdentity => ({ document: doc(document), page });

describe("isSamePage — the definition of « the same page » (section 2.a)", () => {
  it.each([
    ["same plan file, even renamed", at({ plan_file_id: PLAN_A, file_name: "Plan R+1.pdf" }, 2), at({ plan_file_id: PLAN_A, file_name: "Plan R+1 v2.pdf" }, 2), true],
    ["same content hash of two uploads", at({ content_hash: HASH, file_name: "a.pdf" }, 1), at({ content_hash: HASH.toUpperCase(), file_name: "b.pdf" }, 1), true],
    ["same plan reference across two revisions", at({ plan_file_id: PLAN_A, logical_document_id: "PLB-R1", file_name: "ind A.pdf" }, 1),
      at({ plan_file_id: PLAN_B, logical_document_id: " plb-r1 ", file_name: "ind B.pdf" }, 1), true],
    ["same name without identifier", at({ file_name: "Plan  R+1.PDF" }, 1), at({ file_name: "plan r+1.pdf" }, 1), true],
    ["same name, one side identified only by its name", at({ plan_file_id: PLAN_A, file_name: "plan.pdf" }, 1), at({ file_name: "plan.pdf" }, 1), true],
    ["two files of the same name with two identifiers", at({ plan_file_id: PLAN_A, file_name: "plan.pdf" }, 1), at({ plan_file_id: PLAN_B, file_name: "plan.pdf" }, 1), false],
    ["two uploads of the same name with two hashes", at({ content_hash: HASH, file_name: "plan.pdf" }, 1), at({ content_hash: OTHER_HASH, file_name: "plan.pdf" }, 1), false],
    ["a page missing on one side is the same page", at({ plan_file_id: PLAN_A }, null), at({ plan_file_id: PLAN_A }, 4), true],
    ["another page of the same document", at({ plan_file_id: PLAN_A }, 1), at({ plan_file_id: PLAN_A }, 2), false],
    ["another document of another name", at({ file_name: "zone-Z1.pdf" }, 1), at({ file_name: "zone-Z2.pdf" }, 1), false],
    ["an empty plan reference proves nothing", at({ plan_file_id: PLAN_A, logical_document_id: " " }, 1), at({ plan_file_id: PLAN_B, logical_document_id: "" }, 1), false],
  ])("%s", (_case, left, right, expected) => {
    expect(isSamePage(left, right)).toBe(expected);
    expect(isSamePage(right, left)).toBe(expected);
  });
});

describe("takeoffLinePageIdentity — the page a takeoff line reads (section 1.5)", () => {
  const preparedSources = [
    { document_id: PLAN_A, kind: "plan", active: true, content_hash: HASH, logical_document_id: "PLB-R1" },
    { document_id: `upload:${OTHER_HASH}`, kind: "plan", active: true, content_hash: OTHER_HASH, logical_document_id: null },
  ];

  it("reads a plan file, its hash and its plan reference from the job's preparation", () => {
    expect(takeoffLinePageIdentity({ source_file_name: "Plan R+1.pdf", source_page: 3,
      source_document: { kind: "plan_file", plan_file_id: PLAN_A } }, [preparedSources[0]]))
      .toEqual(at({ plan_file_id: PLAN_A, content_hash: HASH, logical_document_id: "PLB-R1", file_name: "Plan R+1.pdf" }, 3));
  });

  it("reads a direct upload by its content hash, never by its job (it changes with every takeoff)", () => {
    expect(takeoffLinePageIdentity({ source_file_name: "plan.pdf", source_page: 1,
      source_document: { kind: "job_upload", job_id: JOB_NEW } }, [preparedSources[1]]))
      .toEqual(at({ content_hash: OTHER_HASH, file_name: "plan.pdf" }, 1));
  });

  it("falls back on the file name for an upload without preparation", () => {
    expect(takeoffLinePageIdentity({ source_file_name: "plan.pdf", source_page: 1,
      source_document: { kind: "job_upload", job_id: JOB_NEW } }, null)).toEqual(at({ file_name: "plan.pdf" }, 1));
  });

  it("keeps a plan file identity without a file name", () => {
    expect(takeoffLinePageIdentity({ source_file_name: null, source_page: 2,
      source_document: { kind: "plan_file", plan_file_id: PLAN_B } }, null)).toEqual(at({ plan_file_id: PLAN_B }, 2));
  });

  it("identifies nothing for a line without a file (multi-file takeoff without preparation)", () => {
    expect(takeoffLinePageIdentity({ source_file_name: null, source_page: 5, source_document: null }, null)).toBeNull();
    expect(takeoffLinePageIdentity({ source_file_name: "  ", source_page: null, source_document: undefined }, null)).toBeNull();
  });

  it("ignores a malformed source document", () => {
    expect(takeoffLinePageIdentity({ source_file_name: "plan.pdf", source_page: 1,
      source_document: { kind: "plan_file", plan_file_id: 42 } }, null)).toEqual(at({ file_name: "plan.pdf" }, 1));
  });
});

describe("estimateLineTakeoffItemIds — the takeoff lines an estimate line comes from", () => {
  it("reads the single source of a line", () => {
    expect(estimateLineTakeoffItemIds({ takeoff_item_id: id(1) })).toEqual([id(1)]);
  });
  it("reads every source of a length rounded once after merging", () => {
    expect(estimateLineTakeoffItemIds({ takeoff_item_id: id(1), takeoff_length_rounding: { item_ids: [id(1), id(2)] } }))
      .toEqual([id(1), id(2)]);
  });
  it("reads the sources of a DPGF target", () => {
    expect(estimateLineTakeoffItemIds({ takeoff_quantity_policy: { item_ids: [id(3), id(4)] } })).toEqual([id(3), id(4)]);
  });
  it("reads the source of an assembly line", () => {
    expect(estimateLineTakeoffItemIds({ takeoff_item_id: id(5), mapping_action: "apply_assembly", assembly_id: id(9) })).toEqual([id(5)]);
  });
  it("ignores a rounding or DPGF key another takeoff left behind (a later merge kept it)", () => {
    const stale = { takeoff_item_id: id(1), takeoff_length_rounding: { job_id: JOB_EARLIER, item_ids: [id(2)] },
      takeoff_quantity_policy: { job_id: JOB_EARLIER, item_ids: [id(3)] } };
    expect(estimateLineTakeoffItemIds(stale, JOB_NEW)).toEqual([id(1)]);
    expect(estimateLineTakeoffItemIds(stale, JOB_EARLIER)).toEqual([id(1), id(2), id(3)]);
  });
  it("ignores what is not an identifier", () => {
    expect(estimateLineTakeoffItemIds({ takeoff_item_id: "x", takeoff_length_rounding: { item_ids: "y" }, takeoff_quantity_policy: null })).toEqual([]);
    expect(estimateLineTakeoffItemIds(null)).toEqual([]);
  });
});

describe("findPagesAlreadyInEstimate — the estimate's lines traced back to the frozen takeoff lines (A1)", () => {
  const earlier = (n: number, identity: TakeoffPageIdentity | null, jobId = JOB_EARLIER): [string, EarlierTakeoffLine] =>
    [id(n), { id: id(n), job_id: jobId, identity }];
  const estimateLine = (n: number, input: Partial<EstimateLineProvenance>): EstimateLineProvenance => ({
    id: id(n), source_provider: "takeoff", source_job_id: JOB_EARLIER, source_file_name: null, source_page: null, source_metadata: {}, ...input,
  });
  const newLine = (n: number, identity: TakeoffPageIdentity | null) => ({ id: id(n), identity });

  it("names a page another takeoff brought, the earlier takeoff and its lines", () => {
    const result = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, at({ content_hash: HASH, file_name: "plan.pdf" }, 1)), newLine(102, at({ content_hash: HASH, file_name: "plan.pdf" }, 1))],
      estimateLines: [estimateLine(201, { source_metadata: { takeoff_item_id: id(1) } }), estimateLine(202, { source_metadata: { takeoff_item_id: id(2) } })],
      earlierItems: new Map([earlier(1, at({ content_hash: HASH, file_name: "plan.pdf" }, 1)), earlier(2, at({ content_hash: HASH, file_name: "plan.pdf" }, 1))]),
    });
    expect(result.pages).toEqual([{ file_name: "plan.pdf", page: 1, item_ids: [id(101), id(102)],
      earlier: [{ job_id: JOB_EARLIER, estimate_item_ids: [id(201), id(202)] }], own_estimate_item_ids: [] }]);
    expect(result.other_takeoff_line_count).toBe(2);
  });

  it("reports nothing for two zone plans of one level (TKR negative control)", () => {
    const result = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, at({ file_name: "zone-R+1-Z2.pdf" }, 1))],
      estimateLines: [estimateLine(201, { source_metadata: { takeoff_item_id: id(1) } })],
      earlierItems: new Map([earlier(1, at({ file_name: "zone-R+1-Z1.pdf" }, 1))]),
    });
    expect(result.pages).toEqual([]);
    expect(result.other_takeoff_line_count).toBe(1);
  });

  it("splits a rounded line over the pages of its sources, and keeps only the page re-read", () => {
    const result = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, at({ plan_file_id: PLAN_A, file_name: "plan.pdf" }, 2))],
      estimateLines: [estimateLine(201, { source_metadata: { takeoff_item_id: id(1), takeoff_length_rounding: { item_ids: [id(1), id(2)] } } })],
      earlierItems: new Map([earlier(1, at({ plan_file_id: PLAN_A, file_name: "plan.pdf" }, 1)), earlier(2, at({ plan_file_id: PLAN_A, file_name: "plan.pdf" }, 2))]),
    });
    expect(result.pages).toEqual([{ file_name: "plan.pdf", page: 2, item_ids: [id(101)], earlier: [{ job_id: JOB_EARLIER, estimate_item_ids: [id(201)] }], own_estimate_item_ids: [] }]);
  });

  it("reads a DPGF target by its takeoff sources, never by the DPGF's own file and page", () => {
    const dpgfTarget = estimateLine(201, { source_provider: "dpgf", source_file_name: "plan.pdf", source_page: 1,
      source_metadata: { takeoff_quantity_policy: { item_ids: [id(1)] } } });
    const onOtherPage = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, at({ file_name: "plan.pdf" }, 1))],
      estimateLines: [dpgfTarget],
      earlierItems: new Map([earlier(1, at({ file_name: "plan.pdf" }, 3))]),
    });
    expect(onOtherPage.pages).toEqual([]);
    const onSamePage = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, at({ file_name: "plan.pdf" }, 3))],
      estimateLines: [dpgfTarget],
      earlierItems: new Map([earlier(1, at({ file_name: "plan.pdf" }, 3))]),
    });
    expect(onSamePage.pages.map((page) => page.page)).toEqual([3]);
    // A DPGF line no takeoff fed is no contribution, even with a plan-like file and page.
    const unmeasured = findPagesAlreadyInEstimate({ jobId: JOB_NEW, newLines: [newLine(101, at({ file_name: "plan.pdf" }, 1))],
      estimateLines: [estimateLine(202, { source_provider: "dpgf", source_job_id: null, source_file_name: "plan.pdf", source_page: 1 })],
      earlierItems: new Map() });
    expect(unmeasured).toMatchObject({ pages: [], other_takeoff_line_count: 0 });
  });

  it("reads an engine 1/2 line, without source identifier, by its takeoff, file and page", () => {
    const result = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, at({ plan_file_id: PLAN_A, file_name: "Plan R+1.pdf" }, 1))],
      estimateLines: [estimateLine(201, { source_file_name: "plan r+1.pdf", source_page: 1 }), estimateLine(202, { source_file_name: "Plan R+1.pdf", source_page: 2 })],
      earlierItems: new Map(),
    });
    expect(result.pages).toEqual([{ file_name: "Plan R+1.pdf", page: 1, item_ids: [id(101)], earlier: [{ job_id: JOB_EARLIER, estimate_item_ids: [id(201)] }], own_estimate_item_ids: [] }]);
  });

  it("does not count a pasted line, a manual line nor the takeoff's own lines", () => {
    const result = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, at({ file_name: "plan.pdf" }, 1))],
      estimateLines: [
        estimateLine(201, { source_provider: null, source_job_id: null, source_file_name: "plan.pdf", source_page: 1 }),
        estimateLine(202, { source_job_id: JOB_NEW, source_file_name: "plan.pdf", source_page: 1, source_metadata: { takeoff_item_id: id(7) } }),
      ],
      earlierItems: new Map([earlier(7, at({ file_name: "plan.pdf" }, 1), JOB_NEW)]),
    });
    expect(result).toMatchObject({ pages: [], other_takeoff_line_count: 0 });
  });

  it("counts the lines without a file or a page as not compared", () => {
    const result = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, null), newLine(102, at({ file_name: "plan.pdf" }, 1))],
      estimateLines: [estimateLine(201, { source_metadata: { takeoff_item_id: id(1) } })],
      earlierItems: new Map([earlier(1, at({ file_name: "plan.pdf" }, 1))]),
    });
    expect(result.unidentified_item_ids).toEqual([id(101)]);
    expect(result.pages.map((page) => page.item_ids)).toEqual([[id(102)]]);
  });

  it("puts a line without page on every page the earlier takeoff brought, and names two earlier takeoffs of one page", () => {
    const result = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, at({ plan_file_id: PLAN_A, file_name: "plan.pdf" }, null)), newLine(102, at({ plan_file_id: PLAN_A, file_name: "plan.pdf" }, 2))],
      estimateLines: [
        estimateLine(201, { source_metadata: { takeoff_item_id: id(1) } }),
        estimateLine(202, { source_job_id: JOB_OTHER, source_metadata: { takeoff_item_id: id(2) } }),
        estimateLine(203, { source_metadata: { takeoff_item_id: id(3) } }),
      ],
      earlierItems: new Map([
        earlier(1, at({ plan_file_id: PLAN_A, file_name: "plan.pdf" }, 1)),
        earlier(2, at({ plan_file_id: PLAN_A, file_name: "plan.pdf" }, 2), JOB_OTHER),
        earlier(3, at({ plan_file_id: PLAN_A, file_name: "plan.pdf" }, 2)),
      ]),
    });
    expect(result.pages).toEqual([
      { file_name: "plan.pdf", page: 1, item_ids: [id(101)], earlier: [{ job_id: JOB_EARLIER, estimate_item_ids: [id(201)] }], own_estimate_item_ids: [] },
      { file_name: "plan.pdf", page: 2, item_ids: [id(101), id(102)], earlier: [
        { job_id: JOB_EARLIER, estimate_item_ids: [id(203)] }, { job_id: JOB_OTHER, estimate_item_ids: [id(202)] }], own_estimate_item_ids: [] },
    ]);
  });

  it("finds the earlier contribution after a version copy: the copied lines keep their frozen sources", () => {
    // The copy's lines point to the old version's takeoff; nothing is read by estimate version on the takeoff side.
    const result = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, at({ logical_document_id: "PLB-R1", plan_file_id: PLAN_B, file_name: "ind B.pdf" }, 1))],
      estimateLines: [estimateLine(301, { source_metadata: { takeoff_item_id: id(1) } })],
      earlierItems: new Map([earlier(1, at({ logical_document_id: "PLB-R1", plan_file_id: PLAN_A, file_name: "ind A.pdf" }, 1))]),
    });
    expect(result.pages).toEqual([{ file_name: "ind B.pdf", page: 1, item_ids: [id(101)], earlier: [{ job_id: JOB_EARLIER, estimate_item_ids: [id(301)] }], own_estimate_item_ids: [] }]);
  });

  it("does not name an earlier takeoff through a key a later merge left on the line", () => {
    // B's DPGF target, later matched by title by C's merge: the line is C's, on another page; B's policy key stayed.
    const result = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, at({ file_name: "plan.pdf" }, 1))],
      estimateLines: [estimateLine(201, { source_job_id: JOB_OTHER,
        source_metadata: { takeoff_item_id: id(2), takeoff_quantity_policy: { job_id: JOB_EARLIER, item_ids: [id(1)] } } })],
      earlierItems: new Map([earlier(1, at({ file_name: "plan.pdf" }, 1)), earlier(2, at({ file_name: "plan.pdf" }, 4), JOB_OTHER)]),
    });
    expect(result.pages).toEqual([]);
  });

  it("counts on each page the lines this takeoff itself still has in the estimate", () => {
    const result = findPagesAlreadyInEstimate({
      jobId: JOB_NEW,
      newLines: [newLine(101, at({ file_name: "plan.pdf" }, 1)), newLine(102, at({ file_name: "plan.pdf" }, 2))],
      estimateLines: [
        estimateLine(201, { source_metadata: { takeoff_item_id: id(1) } }),
        estimateLine(202, { source_metadata: { takeoff_item_id: id(2) } }),
        estimateLine(203, { source_job_id: JOB_NEW, source_metadata: { takeoff_item_id: id(101) } }),
      ],
      earlierItems: new Map([earlier(1, at({ file_name: "plan.pdf" }, 1)), earlier(2, at({ file_name: "plan.pdf" }, 2)),
        earlier(101, at({ file_name: "plan.pdf" }, 1), JOB_NEW)]),
    });
    expect(result.pages.map((page) => [page.page, page.own_estimate_item_ids])).toEqual([[1, [id(203)]], [2, []]]);
    expect(result.other_takeoff_line_count).toBe(2);
  });
});

describe("launchDocumentsOf — what a launch is about to read", () => {
  it("keeps the active plan sources with their identity and pages", () => {
    expect(launchDocumentsOf([
      { document_id: PLAN_A, document_name: "Plan R+1.pdf", kind: "plan", active: true, content_hash: null, logical_document_id: "PLB-R1", pages: [2, 3] },
      { document_id: `upload:${HASH}`, document_name: "plan.pdf", kind: "plan", active: true, content_hash: null, logical_document_id: null, pages: [] },
      { document_id: PLAN_B, document_name: "CCTP.pdf", kind: "cctp", active: true, content_hash: null, logical_document_id: null, pages: [] },
      { document_id: PLAN_B, document_name: "Plan R+2.pdf", kind: "plan", active: false, content_hash: null, logical_document_id: null, pages: [] },
    ])).toEqual([
      { plan_file_id: PLAN_A, content_hash: null, logical_document_id: "PLB-R1", file_name: "Plan R+1.pdf", pages: [2, 3] },
      { plan_file_id: null, content_hash: HASH, logical_document_id: null, file_name: "plan.pdf", pages: [] },
    ]);
  });
});
