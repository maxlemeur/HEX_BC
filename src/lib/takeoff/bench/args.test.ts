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
// Ways the vector pipeline flag (TI-662) could start a run nobody asked for:
// - the default pipeline is not chatgpt, or the result does not say which
//   pipeline runs (the script would branch on a missing field);
// - --pipeline vector accepts --models or --efforts, as if a model were called;
// - --baseline is accepted for the chatgpt pipeline, where nothing reads it;
// - an unknown pipeline is accepted (and silently run as one of the two);
// - the vector pipeline starts without --dataset, --docs or --out;
// - the --baseline value is lost, or a vector run without it gets a baseline
//   instead of null; --pipeline or --baseline given twice or without value.
// Page triage (TI-663), written before the code:
// - a triage run without --max-decisions-tokens, or with a zero, fractional or
//   negative ceiling, starts paid Decisions calls without a ceiling (C3);
// - a triage run accepts models, efforts or repeats (one pass per page and prompt);
// - an extraction accepts a Decisions ceiling it would ignore;
// - a page list with 0, a reversed range, a repeated page or text is accepted, or
//   --pages and --pages-from are both given.
// Both modes together (merge of TI-662 and TI-663):
// - --pipeline vector accepts --mode, --pages or --pages-from it would ignore
//   (it reads every page);
// Decisions classes of the vector groups (TI-662 L3c), written before the code:
// - --pipeline vector refuses --max-decisions-tokens, or accepts a zero,
//   fractional or negative ceiling (paid calls without a real ceiling);
// - a vector run without it gets a ceiling (and an owner, and paid calls).
// The vision pass on the rejected lines (TI-664 L5c), written before the code:
// - a vector run without --vision-review calls ChatGPT; one with it does not;
// - --vision-review is accepted on the chatgpt pipeline, or with a value it would ignore.
// - a chatgpt run, extraction or triage, does not say its pipeline.

const required = ["--dataset", "/fixture/dataset", "--docs", "all", "--models", "model-a", "--efforts", "auto", "--out", "/fixture/run"];

describe("takeoff bench arguments", () => {
  it("reads the documents, models, efforts, passes and output, auto as null", () => {
    expect(parseBenchArgs(required)).toEqual({
      pipeline: "chatgpt", mode: "extract", dataset: "/fixture/dataset", docs: "all", models: ["model-a"], efforts: [null], repeat: 1,
      out: "/fixture/run", maxDecisionsTokens: null, pages: null, pagesFrom: null,
    });
    expect(parseBenchArgs(["--pipeline", "chatgpt", ...required])).toEqual(parseBenchArgs(required));
    expect(parseBenchArgs([
      "--dataset=/fixture/dataset", "--docs=a-plan-01,c-plan-01", "--models", "model-a,model-b", "--efforts", "none,max,auto",
      "--repeat", "3", "--out", "/fixture/run",
    ])).toMatchObject({
      pipeline: "chatgpt", docs: ["a-plan-01", "c-plan-01"], models: ["model-a", "model-b"], efforts: ["none", "max", null], repeat: 3,
    });
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

  const vector = ["--pipeline", "vector", "--dataset", "/fixture/dataset", "--docs", "a-plan-01,load-plan-01", "--out", "/fixture/run"];

  it("reads a vector run without model nor effort, its baseline null unless given", () => {
    expect(parseBenchArgs(vector)).toEqual({
      pipeline: "vector", dataset: "/fixture/dataset", docs: ["a-plan-01", "load-plan-01"], repeat: 1, out: "/fixture/run", baseline: null,
      maxDecisionsTokens: null, visionReview: false,
    });
    expect(parseBenchArgs([...vector, "--baseline", "/fixture/baseline/report.json", "--repeat", "3"]))
      .toEqual({ pipeline: "vector", dataset: "/fixture/dataset", docs: ["a-plan-01", "load-plan-01"], repeat: 3, out: "/fixture/run",
        baseline: "/fixture/baseline/report.json", maxDecisionsTokens: null, visionReview: false });
    expect(parseBenchArgs(["--pipeline=vector", "--dataset=/fixture/dataset", "--docs=all", "--out=/fixture/run",
      "--baseline=/fixture/baseline/report.json"])).toMatchObject({ pipeline: "vector", docs: "all", baseline: "/fixture/baseline/report.json" });
  });

  it("reads a vector run with its Decisions ceiling", () => {
    expect(parseBenchArgs([...vector, "--max-decisions-tokens", "500000"])).toMatchObject({ pipeline: "vector", maxDecisionsTokens: 500_000, baseline: null });
    expect(parseBenchArgs([...vector, "--max-decisions-tokens=10", "--repeat", "2"])).toMatchObject({ maxDecisionsTokens: 10, repeat: 2 });
  });

  it("reads a vector run with the vision pass on its rejected lines", () => {
    expect(parseBenchArgs([...vector, "--vision-review", "rejected"])).toMatchObject({ pipeline: "vector", visionReview: true, maxDecisionsTokens: null });
    expect(parseBenchArgs([...vector, "--vision-review=rejected", "--max-decisions-tokens", "10"])).toMatchObject({ visionReview: true, maxDecisionsTokens: 10 });
  });

  it.each([
    ["--vision-review on the chatgpt pipeline", [...required, "--vision-review", "rejected"]],
    ["--vision-review with another value", [...vector, "--vision-review", "all"]],
    ["--vision-review without value", [...vector, "--vision-review"]],
    ["--models on the vector pipeline", [...vector, "--models", "model-a"]],
    ["--efforts on the vector pipeline", [...vector, "--efforts", "auto"]],
    ["--baseline on the default chatgpt pipeline", [...required, "--baseline", "/fixture/baseline/report.json"]],
    ["--baseline on an explicit chatgpt pipeline", ["--pipeline", "chatgpt", ...required, "--baseline", "/fixture/baseline/report.json"]],
    ["an unknown pipeline", [...required, "--pipeline", "gemini"]],
    ["an unknown pipeline without models", vector.map((value) => (value === "vector" ? "vectors" : value))],
    ["a vector run without --dataset", vector.filter((_, index) => index !== 2 && index !== 3)],
    ["a vector run without --docs", vector.filter((_, index) => index !== 4 && index !== 5)],
    ["a vector run without --out", vector.slice(0, 6)],
    ["--pipeline given twice", [...vector, "--pipeline", "vector"]],
    ["--baseline without value", [...vector, "--baseline"]],
    ["--baseline given twice", [...vector, "--baseline", "/fixture/a.json", "--baseline", "/fixture/b.json"]],
    ["--mode triage on the vector pipeline", [...vector, "--mode", "triage", "--max-decisions-tokens", "10"]],
    ["a zero Decisions ceiling on the vector pipeline", [...vector, "--max-decisions-tokens", "0"]],
    ["a fractional Decisions ceiling on the vector pipeline", [...vector, "--max-decisions-tokens", "1.5"]],
    ["a negative Decisions ceiling on the vector pipeline", [...vector, "--max-decisions-tokens=-10"]],
    ["--pages on the vector pipeline", [...vector, "--pages", "1"]],
    ["--pages-from on the vector pipeline", [...vector, "--pages-from", "/fixture/triage/report.json"]],
    ["--baseline on a triage run", ["--mode", "triage", "--dataset", "/d", "--docs", "all", "--max-decisions-tokens", "10", "--out", "/o",
      "--baseline", "/fixture/baseline/report.json"]],
  ])("refuses %s", (_case, args) => {
    expect(() => parseBenchArgs(args)).toThrow(BenchUsageError);
  });

  it("reads a triage run under its Decisions ceiling, and page lists for an extraction", () => {
    const triage = ["--mode", "triage", "--dataset", "/fixture/dataset", "--docs", "all", "--max-decisions-tokens", "2000000", "--out", "/fixture/run"];
    expect(parseBenchArgs(triage)).toEqual({
      pipeline: "chatgpt", mode: "triage", dataset: "/fixture/dataset", docs: "all", models: [], efforts: [], repeat: 1, out: "/fixture/run",
      maxDecisionsTokens: 2_000_000, pages: null, pagesFrom: null,
    });
    expect(parseBenchArgs(["--pipeline", "chatgpt", ...triage])).toEqual(parseBenchArgs(triage));
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
