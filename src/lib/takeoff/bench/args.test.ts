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

const required = ["--dataset", "/fixture/dataset", "--docs", "all", "--models", "model-a", "--efforts", "auto", "--out", "/fixture/run"];

describe("takeoff bench arguments", () => {
  it("reads the documents, models, efforts, passes and output, auto as null", () => {
    expect(parseBenchArgs(required)).toEqual({
      pipeline: "chatgpt", dataset: "/fixture/dataset", docs: "all", models: ["model-a"], efforts: [null], repeat: 1, out: "/fixture/run",
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
    });
    expect(parseBenchArgs([...vector, "--baseline", "/fixture/baseline/report.json", "--repeat", "3"]))
      .toEqual({ pipeline: "vector", dataset: "/fixture/dataset", docs: ["a-plan-01", "load-plan-01"], repeat: 3, out: "/fixture/run",
        baseline: "/fixture/baseline/report.json" });
    expect(parseBenchArgs(["--pipeline=vector", "--dataset=/fixture/dataset", "--docs=all", "--out=/fixture/run",
      "--baseline=/fixture/baseline/report.json"])).toMatchObject({ pipeline: "vector", docs: "all", baseline: "/fixture/baseline/report.json" });
  });

  it.each([
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
  ])("refuses %s", (_case, args) => {
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
