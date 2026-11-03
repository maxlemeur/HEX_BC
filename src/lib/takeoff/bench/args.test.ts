import { describe, expect, it } from "vitest";

import { BenchUsageError, benchCouples, parseBenchArgs, parseBenchOwner } from "@/lib/takeoff/bench/args";

// Ways the command line of `npm run takeoff:bench` (TI-660) could start a run
// nobody asked for, written before the code:
// - a missing --dataset, --docs, --models, --efforts or --out lets the bench
//   start (and write its reports elsewhere than the storage-guard run);
// - an effort outside auto, none … max is accepted, or auto is not sent as
//   null (automatic effort, no `reasoning` in the request);
// - a flag given twice, an empty or repeated list item, or an unknown flag is accepted;
// - --repeat is not a positive integer;
// - the couples are not models x efforts in the order given, one at a time;
// - an owner that is not <userId>:<tenantId> is accepted.
// Page triage (TI-663), written before the code:
// - a triage run without --max-decisions-tokens, or with a zero, fractional or
//   negative ceiling, starts paid Decisions calls without a ceiling (C3);
// - a triage run accepts models, efforts or repeats (one pass per page and prompt);
// - an extraction accepts a Decisions ceiling it would ignore;
// - a page list with 0, a reversed range, a repeated page or text is accepted, or
//   --pages and --pages-from are both given.

const required = ["--dataset", "/fixture/dataset", "--docs", "all", "--models", "model-a", "--efforts", "auto", "--out", "/fixture/run"];

describe("takeoff bench arguments", () => {
  it("reads the documents, models, efforts, passes and output, auto as null", () => {
    expect(parseBenchArgs(required)).toEqual({
      mode: "extract", dataset: "/fixture/dataset", docs: "all", models: ["model-a"], efforts: [null], repeat: 1, out: "/fixture/run",
      maxDecisionsTokens: null, pages: null, pagesFrom: null,
    });
    expect(parseBenchArgs([
      "--dataset=/fixture/dataset", "--docs=a-plan-01,c-plan-01", "--models", "model-a,model-b", "--efforts", "none,max,auto",
      "--repeat", "3", "--out", "/fixture/run",
    ])).toMatchObject({ docs: ["a-plan-01", "c-plan-01"], models: ["model-a", "model-b"], efforts: ["none", "max", null], repeat: 3 });
  });

  it.each([
    [required.filter((_, index) => index > 1)],
    [required.slice(0, 8)],
    [[...required.slice(0, 6), ...required.slice(8)]],
    [[...required, "--out", "/fixture/other"]],
    [[...required, "--unknown", "x"]],
    [required.map((value) => (value === "auto" ? "fastest" : value))],
    [required.map((value) => (value === "auto" ? "auto,auto" : value))],
    [required.map((value) => (value === "model-a" ? "model-a," : value))],
    [required.map((value) => (value === "all" ? "all,a-plan-01" : value))],
    [[...required, "--repeat", "0"]],
    [[...required, "--repeat", "1.5"]],
    [[...required, "--repeat"]],
  ])("refuses %j", (args) => {
    expect(() => parseBenchArgs(args)).toThrow(BenchUsageError);
  });

  it("reads a triage run under its Decisions ceiling, and page lists for an extraction", () => {
    const triage = ["--mode", "triage", "--dataset", "/fixture/dataset", "--docs", "all", "--max-decisions-tokens", "2000000", "--out", "/fixture/run"];
    expect(parseBenchArgs(triage)).toEqual({
      mode: "triage", dataset: "/fixture/dataset", docs: "all", models: [], efforts: [], repeat: 1, out: "/fixture/run",
      maxDecisionsTokens: 2_000_000, pages: null, pagesFrom: null,
    });
    expect(parseBenchArgs([...required, "--pages", "1,3-5"])).toMatchObject({ pages: [1, 3, 4, 5], pagesFrom: null });
    expect(parseBenchArgs([...required, "--pages-from", "/fixture/triage/report.json"])).toMatchObject({ pages: null, pagesFrom: "/fixture/triage/report.json" });
  });

  it.each([
    [["--mode", "triage", "--dataset", "/d", "--docs", "all", "--out", "/o"]],
    [["--mode", "triage", "--dataset", "/d", "--docs", "all", "--max-decisions-tokens", "0", "--out", "/o"]],
    [["--mode", "triage", "--dataset", "/d", "--docs", "all", "--max-decisions-tokens", "1.5", "--out", "/o"]],
    [["--mode", "triage", "--dataset", "/d", "--docs", "all", "--max-decisions-tokens", "-3", "--out", "/o"]],
    [["--mode", "triage", "--dataset", "/d", "--docs", "all", "--max-decisions-tokens", "10", "--models", "model-a", "--out", "/o"]],
    [["--mode", "triage", "--dataset", "/d", "--docs", "all", "--max-decisions-tokens", "10", "--repeat", "2", "--out", "/o"]],
    [["--mode", "triage", "--dataset", "/d", "--docs", "all", "--max-decisions-tokens", "10", "--pages", "1", "--out", "/o"]],
    [["--mode", "other", ...required]],
    [[...required, "--max-decisions-tokens", "10"]],
    [[...required, "--pages", "0"]],
    [[...required, "--pages", "3-1"]],
    [[...required, "--pages", "1,1"]],
    [[...required, "--pages", "1-2,2"]],
    [[...required, "--pages", "un"]],
    [[...required, "--pages", "1", "--pages-from", "/r.json"]],
  ])("refuses the page triage arguments %j", (args) => {
    expect(() => parseBenchArgs(args)).toThrow(BenchUsageError);
  });

  it("forms the couples models x efforts in the order given", () => {
    expect(benchCouples(["model-a", "model-b"], ["low", null])).toEqual([
      { model: "model-a", reasoningEffort: "low" }, { model: "model-a", reasoningEffort: null },
      { model: "model-b", reasoningEffort: "low" }, { model: "model-b", reasoningEffort: null },
    ]);
  });

  it("reads the ChatGPT owner as <userId>:<tenantId>", () => {
    expect(parseBenchOwner("11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222"))
      .toEqual({ userId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222" });
    for (const value of [undefined, "", "only-one", "a:b:c", ":tenant", "user:"]) {
      expect(() => parseBenchOwner(value)).toThrow(BenchUsageError);
    }
  });
});
