// What a TesterArmy campaign says about the journeys of an e2e report (report.json, run.results[]): which did
// not pass and how, and which are in quarantine. Read by the campaign launchers (scripts/run-tester-army-ci.ts,
// calc-v3-campaign.ts) and by the aggregate of their parallel jobs (aggregate-shards.ts), which runs with plain
// Node: erasable TypeScript and no import. Contract: docs/testing/tester-army-ci.md, "Tentative unique et
// quarantaine"; failure modes: src/test/army-retry-quarantine.test.ts.
//
// Two rules, neither of which may turn a failing journey green:
// - In CI a campaign retries a failed journey once. The e2e CLI then reports a journey that passed on its second
//   attempt as `flaky`, exits 0 and gives the run the status `passed` (measured on e2e 0.23.0): the launchers
//   keep it red and name it "intermittent", apart from a journey that failed both attempts.
// - `test.fail` marks a journey expected to fail; the runner reports its failure as `passed`, with the reason in
//   `expectedFailure`, and its pass as a failure (UNEXPECTED_PASS). It is accepted only as a quarantine whose
//   reason cites a ticket, and every campaign lists the quarantined journeys it ran.

/** A Linear id of this project (TI-681) or a GitHub issue (#123). Requirement ids of titles (EST-374) are not tickets. */
const QUARANTINE_TICKET = /(?<![A-Za-z0-9-])TI-\d+\b|(?<![\w&/])#\d+\b/u;

/** The first ticket a `test.fail` reason cites, if any. */
export function quarantineTicket(reason: unknown): string | undefined {
  return typeof reason === "string" ? QUARANTINE_TICKET.exec(reason)?.[0] : undefined;
}

/**
 * The retries of a campaign's journeys: one when the launcher itself runs in CI (`CI` set, other than `false` or
 * `0`, as the workflows set it), none on a workstation. The launcher always hands `CI=1` to the e2e CLI, so only
 * its own environment tells the two apart.
 */
export function ciRetries(env: Readonly<Record<string, string | undefined>>): 0 | 1 {
  const ci = env.CI?.trim().toLowerCase();
  return ci && ci !== "false" && ci !== "0" ? 1 : 0;
}

export type NotPassedJourney = {
  file: string;
  /** The title path, joined with " > ". */
  title: string;
  /** The runner's status of the result. */
  status: string;
  /** intermittent: needed more than one attempt and ended on a passed one; failed (timed out included); otherwise the runner's status. */
  group: string;
  /** What happened, without the group: "failed on attempt 1, passed on attempt 2", "failed on both attempts", "skipped". */
  detail: string;
  /** One phrase for a list: the detail, prefixed with "intermittent: " for an intermittent journey. */
  label: string;
  /**
   * Code and message of the first attempt's error, when the journey did not end on a pass: the failure on a
   * fresh state. A retry runs on what that attempt left, so its own error may only be a consequence.
   */
  error?: string;
  /** The last attempt's error and its number, when it differs from the first's. */
  retryError?: { attempt: number; error: string };
};
export type QuarantinedJourney = { file: string; title: string; reason: string; ticket?: string };

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);

function titleOf(result: Record<string, unknown>) {
  return Array.isArray(result.titlePath) && result.titlePath.length ? result.titlePath.map(String).join(" > ") : String(result.testId ?? "");
}

/** "CODE: message" of an attempt's error; a marked attempt that passed (UNEXPECTED_PASS) is told by its detail instead. */
function errorOf(attempt: Record<string, unknown>): string | undefined {
  const error = record(attempt.error);
  if (typeof error.code !== "string" || error.code === "UNEXPECTED_PASS") return undefined;
  return `${error.code}: ${typeof error.message === "string" ? error.message : "no message"}`;
}

function describeAttempts(status: string, attempts: Record<string, unknown>[], quarantined: boolean): { intermittent: boolean; detail: string } {
  const statuses = attempts.map((attempt) => String(attempt.status));
  const count = statuses.length;
  const every = count === 2 ? "both" : `all ${count}`;
  // More than one attempt and a last one that passed: whatever the result's own status, it is not a pass.
  const intermittent = status === "flaky" || (status === "passed" && count > 1);
  if (intermittent) {
    if (count < 2) return { intermittent, detail: "passed only on a retry" };
    const before = statuses.slice(0, -1);
    const first = new Set(before).size === 1 ? before[0] : "not passed";
    const earlier = count === 2 ? "attempt 1" : `attempts 1 to ${count - 1}`;
    // A marked attempt "fails" by passing (UNEXPECTED_PASS) and "passes" by failing as expected.
    return { intermittent, detail: quarantined
      ? `passed on ${earlier} although quarantined, failed as expected on attempt ${count}`
      : `${first} on ${earlier}, passed on attempt ${count}` };
  }
  const unexpectedPass = attempts.length > 0 && attempts.every((attempt) => record(attempt.error).code === "UNEXPECTED_PASS");
  if (unexpectedPass) {
    return { intermittent, detail: `passed${count > 1 ? ` on ${every} attempts` : ""} although quarantined: remove its test.fail mark` };
  }
  if (count < 2) return { intermittent, detail: status };
  if (new Set(statuses).size === 1 && statuses[0] === status) return { intermittent, detail: `${status} on ${every} attempts` };
  return { intermittent, detail: `${status}: attempts ${statuses.join(", ")}` };
}

/** The selected results of a report's run that did not pass, and those marked `test.fail`, in the report's order. */
export function journeyOutcomes(run: unknown): { notPassed: NotPassedJourney[]; quarantined: QuarantinedJourney[] } {
  const notPassed: NotPassedJourney[] = [];
  const quarantined: QuarantinedJourney[] = [];
  for (const result of list(record(run).results).filter((entry) => entry.selected === true)) {
    const file = String(result.file);
    const title = titleOf(result);
    const status = String(result.status);
    const attempts = list(result.attempts);
    const mark = result.expectedFailure === undefined || result.expectedFailure === null ? undefined : record(result.expectedFailure);
    if (mark) {
      const reason = typeof mark.reason === "string" ? mark.reason : "";
      const ticket = quarantineTicket(reason);
      quarantined.push({ file, title, reason, ...(ticket ? { ticket } : {}) });
    }
    const { intermittent, detail } = describeAttempts(status, attempts, Boolean(mark));
    if (status === "passed" && !intermittent) continue;
    const errors = intermittent ? [] : attempts.map((attempt) => errorOf(attempt)).filter((error) => error !== undefined);
    const error = errors[0];
    const last = errors.length > 1 && errors.at(-1) !== error ? { attempt: attempts.length, error: errors.at(-1)! } : undefined;
    notPassed.push({
      file, title, status, group: intermittent ? "intermittent" : status === "timed-out" ? "failed" : status, detail,
      label: intermittent ? `intermittent: ${detail}` : detail, ...(error ? { error } : {}), ...(last ? { retryError: last } : {}),
    });
  }
  return { notPassed, quarantined };
}

const LISTED = 20;

/**
 * One line for a job log or a manifest: "intermittent: <file> > <title> (<what happened>); failed: …", a group
 * per kind, intermittent first. Empty when every journey passed. A journey that did not end on a pass carries the
 * error of its first attempt, and its retry's when that one differs. An error is redacted whole, then cut to its
 * first line: a cut could split a secret the redaction would then miss.
 */
export function describeNotPassed(notPassed: readonly NotPassedJourney[], redact: (text: string) => string = (text) => text): string {
  const groups = new Map<string, NotPassedJourney[]>();
  for (const journey of [...notPassed].sort((a, b) => Number(b.group === "intermittent") - Number(a.group === "intermittent"))) {
    groups.set(journey.group, [...(groups.get(journey.group) ?? []), journey]);
  }
  let listed = 0;
  const parts: string[] = [];
  for (const [group, journeys] of groups) {
    const shown = journeys.slice(0, Math.max(0, LISTED - listed));
    listed += shown.length;
    if (!shown.length) continue;
    const clip = (error: string) => redact(error).split(/\r?\n/u)[0].trim().slice(0, 200);
    parts.push(`${group}: ${shown.map((journey) => {
      const error = journey.error === undefined ? "" : `: ${clip(journey.error)}`;
      const retry = journey.retryError === undefined ? "" : `; attempt ${journey.retryError.attempt}: ${clip(journey.retryError.error)}`;
      return `${journey.file} > ${journey.title} (${journey.detail}${error}${retry})`;
    }).join(", ")}`);
  }
  if (notPassed.length > listed) parts.push(`and ${notPassed.length - listed} more in report.json`);
  return parts.join("; ");
}

/** "<ticket> : <file> > <title> (<reason>)" for each quarantined journey; "no ticket" when its reason cites none. */
export function describeQuarantined(quarantined: readonly QuarantinedJourney[]): string {
  return quarantined.map((journey) => `${journey.ticket ?? "no ticket"} : ${journey.file} > ${journey.title} (${journey.reason})`).join("; ");
}

/** A journey marked expected to fail without a ticket is not a quarantine: the campaign that ran it is red. */
export function quarantineProblems(quarantined: readonly QuarantinedJourney[]): string[] {
  return quarantined.filter((journey) => !journey.ticket).map((journey) =>
    `${journey.file} > ${journey.title} is expected to fail without a ticket (reason "${journey.reason}"): ` +
    "a test.fail reason cites an open Linear id (TI-681) or GitHub issue (#123)");
}
