// @vitest-environment node

// One retry in CI and the `test.fail` quarantine (docs/testing/tester-army-ci.md,
// "Tentative unique et quarantaine"; scripts/tester-army/journey-outcomes.ts).
// Neither may turn a failing journey green. What no campaign can show on demand:
// 1. the e2e CLI exits 0 and reports `passed` when a journey only passed on its
//    retry (measured on e2e 0.23.0): unless the launchers read the result
//    themselves, an intermittent journey ends green;
// 2. a red campaign that does not say whether a journey failed both attempts or
//    passed on the second: its reader investigates a failure the change did not
//    cause, or dismisses one it did;
// 3. a quarantined journey that passes on one attempt and fails on the other,
//    reported as an ordinary intermittent failure;
// 4. a `test.fail` without an open ticket: the journey stays green for ever and
//    nobody is asked to repair it. The runner reports an expected failure as
//    `passed`, so only its reason tells a quarantine from a pass;
// 5. a quarantine nobody sees: the summary must name it with its ticket.
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ciRetries, describeNotPassed, describeQuarantined, journeyOutcomes, quarantineProblems, quarantineTicket,
} from "../../scripts/tester-army/journey-outcomes";

const root = process.cwd();
const FILE = "e2e/army/critical/estimate-integrity.e2e.ts";

type Attempt = { status: string; error?: { code: string; message: string }; expectedFailure?: { reason: string; error?: { code: string; message: string } } };

/** A result as e2e 0.23 writes it in report.json (run.results[]), reduced to what the launchers read. */
function result(title: string, status: string, attempts: Attempt[], extra: Record<string, unknown> = {}) {
  return {
    kind: "test", selected: true, file: FILE, titlePath: [title], targetId: "chromium-desktop", tags: ["critical"], status,
    attempts: attempts.map((attempt, index) => ({ index, secondaryErrors: [], ...attempt })), ...extra,
  };
}
const assertion = { code: "ASSERTION_FAILED", message: "expected 1 to be 2" };
const failedAttempt: Attempt = { status: "failed", error: assertion };
const passedAttempt: Attempt = { status: "passed" };
const run = (...results: unknown[]) => ({ exitCode: 0, status: "passed", errors: [], results });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The retries e2e.config.ts resolves for a suite and an E2E_ARMY_RETRIES value, as the e2e CLI would load it. */
async function configuredRetries(suite: string, setting: string | undefined) {
  vi.resetModules();
  vi.stubEnv("E2E_ARMY_SUITE", suite);
  vi.stubEnv("E2E_ARMY_RETRIES", setting);
  return ((await import("../../e2e.config")).default as { retries: number }).retries;
}

describe("one retry in CI classifies a failure and never passes it", () => {
  it("retries once only when the launcher itself runs in CI", () => {
    // The launcher always hands CI=1 to the e2e CLI, local runs included: its own environment decides.
    expect(ciRetries({})).toBe(0);
    for (const value of ["", "0", "false", "FALSE", " "]) expect(ciRetries({ CI: value }), value).toBe(0);
    for (const value of ["1", "true"]) expect(ciRetries({ CI: value }), value).toBe(1);
  });

  it("gives the journeys one retry only when the launcher asks for it, never more, and only to a campaign", async () => {
    // Unset: every local run, and the smoke, coverage and performance suites, whose own checks read a single attempt.
    expect(await configuredRetries("critical", undefined)).toBe(0);
    expect(await configuredRetries("critical", "0")).toBe(0);
    expect(await configuredRetries("critical", "1")).toBe(1);
    await expect(configuredRetries("critical", "2")).rejects.toThrow("E2E_ARMY_RETRIES must be 0 or 1");
    await expect(configuredRetries("critical", "true")).rejects.toThrow("E2E_ARMY_RETRIES must be 0 or 1");
    for (const suite of ["anonymous", "coverage", "performance"]) {
      expect(await configuredRetries(suite, undefined), suite).toBe(0);
      await expect(configuredRetries(suite, "1"), suite).rejects.toThrow("reserved for the critical and full campaigns");
    }
  });

  it("names a journey that passed on its retry as intermittent, apart from one that failed both attempts", () => {
    const outcomes = journeyOutcomes(run(
      result("EI01 keeps the totals", "passed", [passedAttempt]),
      result("EI02 saves the line", "flaky", [failedAttempt, passedAttempt]),
      result("EI03 exports the PDF", "failed", [failedAttempt, failedAttempt]),
    ));
    expect(outcomes.notPassed.map(({ title, group, label }) => [title, group, label])).toEqual([
      ["EI02 saves the line", "intermittent", "intermittent: failed on attempt 1, passed on attempt 2"],
      ["EI03 exports the PDF", "failed", "failed on both attempts"],
    ]);
    expect(describeNotPassed(outcomes.notPassed)).toBe(
      `intermittent: ${FILE} > EI02 saves the line (failed on attempt 1, passed on attempt 2); ` +
      `failed: ${FILE} > EI03 exports the PDF (failed on both attempts: ASSERTION_FAILED: expected 1 to be 2)`);
    // A green run names nothing.
    expect(describeNotPassed(journeyOutcomes(run(result("EI01 keeps the totals", "passed", [passedAttempt]))).notPassed)).toBe("");
  });

  it("never counts a result that needed a second attempt as passed, whatever status it carries", () => {
    const outcomes = journeyOutcomes(run(result("EI04 reopens the draft", "passed", [{ status: "timed-out", error: { code: "TEST_TIMEOUT", message: "test timed out after 90000 ms" } }, passedAttempt])));
    expect(outcomes.notPassed.map(({ group, label }) => [group, label])).toEqual([
      ["intermittent", "intermittent: timed-out on attempt 1, passed on attempt 2"],
    ]);
  });

  it("keeps the runner's status for a journey that was not retried, skipped or interrupted", () => {
    const outcomes = journeyOutcomes(run(
      result("EI05 local run", "failed", [failedAttempt]),
      result("EI06 hung", "timed-out", [{ status: "timed-out" }, { status: "timed-out" }]),
      result("EI07 gave up", "skipped", [failedAttempt, { status: "skipped" }]),
      result("EI08 cut by the run", "interrupted", []),
      // Outside the selection (another shard's file): not a result of this run.
      result("EI09 other shard", "skipped", [], { selected: false }),
    ));
    expect(outcomes.notPassed.map(({ group, label }) => [group, label])).toEqual([
      ["failed", "failed"],
      ["failed", "timed-out on both attempts"],
      ["skipped", "skipped: attempts failed, skipped"],
      ["interrupted", "interrupted"],
    ]);
    expect(describeNotPassed(outcomes.notPassed)).toContain(`skipped: ${FILE} > EI07 gave up (skipped: attempts failed, skipped: ASSERTION_FAILED: expected 1 to be 2)`);
  });

  it("reports the first attempt's error of a journey that failed twice, and the retry's when it differs", () => {
    // The retry runs on what the first attempt left: its error may be a consequence (a receipt already written),
    // and reporting it alone would hide the failure that happened on a fresh state.
    const outcomes = journeyOutcomes(run(result("EI16 writes its receipt", "failed", [
      { status: "failed", error: { code: "ASSERTION_FAILED", message: "expected 12,00 € to be 14,00 €" } },
      { status: "failed", error: { code: "TEST_ERROR", message: "EEXIST: file already exists, open 'receipt.json'" } },
    ])));
    expect(describeNotPassed(outcomes.notPassed)).toBe(
      `failed: ${FILE} > EI16 writes its receipt (failed on both attempts: ASSERTION_FAILED: expected 12,00 € to be 14,00 €; ` +
      "attempt 2: TEST_ERROR: EEXIST: file already exists, open 'receipt.json')");
  });

  it("tells a quarantined journey that passed on one attempt from an ordinary intermittent failure", () => {
    const reason = "TI-681: the PDF export is broken";
    const outcomes = journeyOutcomes(run(
      result("EI10 quarantined, passes then fails", "flaky", [
        { status: "failed", error: { code: "UNEXPECTED_PASS", message: "test is marked test.fail but passed" }, expectedFailure: { reason } },
        { status: "passed", expectedFailure: { reason, error: assertion } },
      ], { expectedFailure: { reason } }),
      result("EI11 quarantined, repaired", "failed", [
        { status: "failed", error: { code: "UNEXPECTED_PASS", message: "test is marked test.fail but passed" }, expectedFailure: { reason } },
        { status: "failed", error: { code: "UNEXPECTED_PASS", message: "test is marked test.fail but passed" }, expectedFailure: { reason } },
      ], { expectedFailure: { reason } }),
    ));
    expect(outcomes.notPassed.map(({ group, label }) => [group, label])).toEqual([
      ["intermittent", "intermittent: passed on attempt 1 although quarantined, failed as expected on attempt 2"],
      ["failed", "passed on both attempts although quarantined: remove its test.fail mark"],
    ]);
  });

  it("redacts the error of a failed journey before clipping it, and keeps one line of it", () => {
    const outcomes = journeyOutcomes(run(result("EI12 leaks", "failed", [
      { status: "failed", error: { code: "ASSERTION_FAILED", message: `token SECRET-VALUE refused\nsecond line ${"x".repeat(400)}` } },
    ])));
    const text = describeNotPassed(outcomes.notPassed, (value) => value.replaceAll("SECRET-VALUE", "<redacted>"));
    expect(text).toBe(`failed: ${FILE} > EI12 leaks (failed: ASSERTION_FAILED: token <redacted> refused)`);
  });

  it("names the first journeys of a long list and counts the rest", () => {
    const many = Array.from({ length: 25 }, (_, index) => result(`EI${index} red`, "failed", [failedAttempt, failedAttempt]));
    const text = describeNotPassed(journeyOutcomes(run(...many)).notPassed);
    expect(text).toContain("EI19 red");
    expect(text).not.toContain("EI20 red");
    expect(text).toContain("and 5 more in report.json");
  });
});

describe("test.fail is a quarantine with an open ticket", () => {
  const quarantined = (title: string, reason: string) => result(title, "passed",
    [{ status: "passed", expectedFailure: { reason, error: assertion } }], { expectedFailure: { reason } });

  it("reads a Linear id or a GitHub issue, and nothing that merely looks like one", () => {
    expect(quarantineTicket("TI-681: the PDF export is broken")).toBe("TI-681");
    expect(quarantineTicket("red on main since the import rework (#123)")).toBe("#123");
    expect(quarantineTicket("see #12, then TI-3")).toBe("#12");
    for (const reason of ["expected to fail", "", "UTF-8 header refused", "EST-374 opens the preview", "XTI-12", "colour #fff", "step #abc",
      "https://example.test/page#123", "TI-", "#", "TI-12a"]) {
      expect(quarantineTicket(reason), reason).toBeUndefined();
    }
    expect(quarantineTicket(undefined)).toBeUndefined();
  });

  it("lists every journey that failed as expected with its ticket, and counts none of them as a failure", () => {
    const outcomes = journeyOutcomes(run(
      result("EI01 keeps the totals", "passed", [passedAttempt]),
      quarantined("EI13 exports the PDF", "TI-681: the PDF export is broken"),
      quarantined("EI14 sends the offer", "red on main, see #123"),
    ));
    expect(outcomes.notPassed).toEqual([]);
    expect(outcomes.quarantined).toEqual([
      { file: FILE, title: "EI13 exports the PDF", reason: "TI-681: the PDF export is broken", ticket: "TI-681" },
      { file: FILE, title: "EI14 sends the offer", reason: "red on main, see #123", ticket: "#123" },
    ]);
    expect(quarantineProblems(outcomes.quarantined)).toEqual([]);
    expect(describeQuarantined(outcomes.quarantined)).toBe(
      `TI-681 : ${FILE} > EI13 exports the PDF (TI-681: the PDF export is broken); ` +
      `#123 : ${FILE} > EI14 sends the offer (red on main, see #123)`);
  });

  it("still lists a quarantined journey when it is red, so a repaired one is seen with its ticket", () => {
    const reason = "TI-681: the PDF export is broken";
    const outcomes = journeyOutcomes(run(result("EI11 quarantined, repaired", "failed", [
      { status: "failed", error: { code: "UNEXPECTED_PASS", message: "test is marked test.fail but passed" }, expectedFailure: { reason } },
    ], { expectedFailure: { reason } })));
    expect(outcomes.quarantined.map(({ title, ticket }) => [title, ticket])).toEqual([["EI11 quarantined, repaired", "TI-681"]]);
    expect(outcomes.notPassed).toHaveLength(1);
  });

  it("refuses at run time a quarantine whose reason cites no ticket", () => {
    // `test.fail(title, fn)` and `{ fail: true }` give the runner's default reason; a reason built at run time escapes the source guard below.
    const outcomes = journeyOutcomes(run(quarantined("EI15 marked without a reason", "expected to fail"), quarantined("EI13 exports the PDF", "TI-681: broken")));
    expect(quarantineProblems(outcomes.quarantined)).toEqual([
      `${FILE} > EI15 marked without a reason is expected to fail without a ticket (reason "expected to fail"): a test.fail reason cites an open Linear id (TI-681) or GitHub issue (#123)`,
    ]);
  });
});

// The policy check on the journeys' source. `test.fail` is accepted in e2e/
// only with a reason written as a literal that cites a ticket: the option
// `{ fail: "TI-681: …" }` or, in a body, `test.fail("TI-681: …")` and
// `test.fail(condition, "TI-681: …")`. The registration form
// `test.fail(title, fn)` and `{ fail: true }` carry no reason and are refused.
function quarantineOffenders(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const rootName = (node: ts.Expression): string | undefined => {
    let current = node;
    while (ts.isPropertyAccessExpression(current) || ts.isCallExpression(current)) current = current.expression;
    return ts.isIdentifier(current) ? current.text : undefined;
  };
  // The runner's registration API under any local name: `import { test as it }`, `const it = test.extend(…)`,
  // and an extended API imported from a fixtures module, which most journeys use (`armyTest`, `offerTest`).
  const api = new Set(["test", "describe"]);
  for (let size = -1; size !== api.size;) {
    size = api.size;
    const collect = (node: ts.Node) => {
      if (ts.isImportSpecifier(node) && (api.has((node.propertyName ?? node.name).text) || /Test$/u.test((node.propertyName ?? node.name).text))) api.add(node.name.text);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && api.has(rootName(node.initializer) ?? "")) api.add(node.name.text);
      ts.forEachChild(node, collect);
    };
    collect(source);
  }
  const literal = (node: ts.Node | undefined) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const offenders: string[] = [];
  const offend = (node: ts.Node, what: string) => {
    offenders.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${what}`);
  };
  const checkReason = (node: ts.Node, reason: ts.Node | undefined) => {
    const text = literal(reason);
    if (text === undefined) offend(node, "test.fail without a reason written as a string literal");
    else if (!quarantineTicket(text)) offend(node, `test.fail reason "${text}" cites no ticket`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && api.has(rootName(node.expression) ?? "")) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "fail") {
        if (node.arguments.some((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) {
          offend(node, "test.fail(title, fn) registers an expected failure without a reason: use the option { fail: \"TI-…: reason\" }");
        } else checkReason(node, node.arguments.length === 1 ? node.arguments[0] : node.arguments[1]);
      }
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue;
        for (const property of argument.properties) {
          if (!property.name || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) || property.name.text !== "fail") continue;
          checkReason(property, ts.isPropertyAssignment(property) ? property.initializer : undefined);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return offenders;
}

describe("test.fail in e2e/ cites a ticket", () => {
  it("refuses every form of test.fail whose reason is absent, computed or without a ticket", () => {
    const refused: Array<[source: string, why: string]> = [
      ['test.fail("exports the PDF", async ({ app }) => {});', "registers an expected failure without a reason"],
      ['test("exports the PDF", { fail: true }, async () => {});', "without a reason written as a string literal"],
      ['test("exports the PDF", { tags: ["critical"], fail: "the export is broken" }, async () => {});', 'reason "the export is broken" cites no ticket'],
      ['test("exports the PDF", { fail: reason }, async () => {});', "without a reason written as a string literal"],
      ['test("exports the PDF", { fail }, async () => {});', "without a reason written as a string literal"],
      ['test("exports the PDF", { fail: `TI-${id}: broken` }, async () => {});', "without a reason written as a string literal"],
      ['test("exports the PDF", async () => { test.fail(); });', "without a reason written as a string literal"],
      ['test("exports the PDF", async () => { test.fail("known gap"); });', 'reason "known gap" cites no ticket'],
      ['test("exports the PDF", async () => { test.fail(mobile); });', "without a reason written as a string literal"],
      ['test("exports the PDF", async () => { test.fail(mobile, "UTF-8 header refused"); });', 'reason "UTF-8 header refused" cites no ticket'],
      ['describe("exports", { fail: "broken" }, () => {});', 'reason "broken" cites no ticket'],
      ['import { test as it } from "@e2e-dev/web";\nit.fail("exports the PDF", async () => {});', "registers an expected failure without a reason"],
      ['const journey = test.extend({});\njourney("exports the PDF", { fail: "broken" }, async () => {});', 'reason "broken" cites no ticket'],
      ['import { armyTest } from "../critical/fixtures";\narmyTest("EI13 exports the PDF", { tags: ["critical"], fail: "export broken" }, async () => {});', 'reason "export broken" cites no ticket'],
      ['import { armyTest } from "../critical/fixtures";\narmyTest.fail("EI13 exports the PDF", async () => {});', "registers an expected failure without a reason"],
      ['import { offerTest as journey } from "./offer-fixtures";\njourney("OF01 sends the offer", { fail: true }, async () => {});', "without a reason written as a string literal"],
    ];
    for (const [source, why] of refused) {
      const offenders = quarantineOffenders("e2e/example.e2e.ts", source);
      expect(offenders, source).toHaveLength(1);
      expect(offenders[0], source).toContain(why);
      expect(offenders[0], source).toMatch(/^e2e\/example\.e2e\.ts:\d+: /u);
    }
  });

  it("accepts a literal reason that cites a ticket, and leaves other `fail` names alone", () => {
    const accepted = [
      'test("exports the PDF", { tags: ["critical"], fail: "TI-681: the PDF export is broken" }, async () => {});',
      'test("exports the PDF", async () => { test.fail("red on main, see #123"); });',
      'test("exports the PDF", async () => { test.fail(mobile, `TI-681: the mobile export is broken`); });',
      // A helper's own option and an assertion helper are not the runner's mark.
      'test("answers 500", async () => { const failing = await workerDecisionsFixture(ui, "TKW10", { fail: true }); expect.fail; });',
      'const outcome = { fail: true };',
    ];
    for (const source of accepted) expect(quarantineOffenders("e2e/example.e2e.ts", source), source).toEqual([]);
  });

  it("lets no journey ask for retries of its own", () => {
    // The runner accepts `retries` up to 10 on a test or a describe, above the configuration: the one retry of CI
    // would no longer be the only one. Zero is allowed (a journey that must never be replayed).
    const files = fs.readdirSync(path.join(root, "e2e"), { recursive: true, encoding: "utf8" })
      .filter((name) => /\.e2e\.[cm]?tsx?$/u.test(name));
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((name) => /\bretries\s*:\s*(?:[1-9]|[^\s\d])/u.test(fs.readFileSync(path.join(root, "e2e", name), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("finds no test.fail without a ticket in the journeys", () => {
    const files = fs.readdirSync(path.join(root, "e2e"), { recursive: true, encoding: "utf8" })
      .filter((name) => /\.[cm]?[jt]sx?$/u.test(name))
      .map((name) => path.posix.join("e2e", name.split(path.sep).join("/")))
      .sort();
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) => quarantineOffenders(file, fs.readFileSync(path.join(root, file), "utf8")));
    expect(offenders, "test.fail is a quarantine for a journey that is red on main: its reason is a string literal that cites an open " +
      "Linear id (TI-681) or GitHub issue (#123), and the campaign summary lists it (docs/testing/tester-army-ci.md).").toEqual([]);
  });
});
