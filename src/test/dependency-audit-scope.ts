// When the npm audit of the Quality Gate blocks (docs/testing/tester-army-ci.md, "Audit des
// dépendances"). New advisories are published every day against dependencies a pull request
// does not touch: blocking on them turned unrelated pull requests red. The audit therefore
// blocks a pull request, or a push to main, only when it changes a file that decides what npm
// installs, what the audit accepts or how it judges; otherwise its findings become a warning, and the daily
// audit of main (scripts/dependency-audit-alert.ts) follows them in one issue.
//
// Every doubt blocks: a manual or local run, a first or forced push, a base that cannot be
// read. The inputs come from the workflow step's environment:
//   DEPENDENCY_AUDIT_EVENT   the GitHub event (pull_request, push, anything else);
//   DEPENDENCY_AUDIT_BASE    the pull request's base commit, or the push's `before`;
//   DEPENDENCY_AUDIT_FORCED  "true" for a push GitHub flags as forced.
import { spawnSync } from "node:child_process";

/** The files whose change makes the audit blocking: what npm installs, the audit's exceptions and its own code. */
export const DEPENDENCY_AUDIT_TRIGGER_FILES = [
  "package.json",
  "package-lock.json",
  ".npmrc",
  "config/dependency-audit-policy.json",
  "src/test/dependency-audit.ts",
  "src/test/dependency-audit-scope.ts",
  "scripts/check-dependency-audit.ts",
] as const;

const SHA1_PATTERN = /^[0-9a-f]{40}$/iu;
const ZERO_SHA = "0".repeat(40);

export interface DependencyAuditScope {
  blocking: boolean;
  /** The trigger files the pull request or push changes (empty when unknown or none). */
  changedFiles: string[];
  /** Why, in the words the job summary shows. */
  reason: string;
}

interface GitResult {
  status: number | null;
  stdout: string;
}

function runGit(rootDirectory: string, args: string[]): GitResult {
  const result = spawnSync("git", args, { cwd: rootDirectory, encoding: "utf8", shell: false, windowsHide: true });
  return { status: result.status, stdout: result.stdout ?? "" };
}

const blocking = (reason: string): DependencyAuditScope => ({ blocking: true, changedFiles: [], reason });

export function resolveDependencyAuditScope(options: {
  environment?: Record<string, string | undefined>;
  rootDirectory?: string;
} = {}): DependencyAuditScope {
  const environment = options.environment ?? process.env;
  const rootDirectory = options.rootDirectory ?? process.cwd();
  const git = (...args: string[]) => runGit(rootDirectory, args);
  const event = environment.DEPENDENCY_AUDIT_EVENT ?? "";
  if (event !== "pull_request" && event !== "push") {
    return blocking(`exécution « ${event || "locale"} », hors d'une pull request ou d'un push : l'audit bloque`);
  }

  const base = (environment.DEPENDENCY_AUDIT_BASE ?? "").trim().toLowerCase();
  if (event === "push") {
    if (!base || base === ZERO_SHA) return blocking("premier push, sans commit précédent : l'audit bloque");
    if (environment.DEPENDENCY_AUDIT_FORCED === "true") return blocking("push forcé : l'audit bloque");
  }
  if (!SHA1_PATTERN.test(base) || base === ZERO_SHA) return blocking(`base « ${base} » invalide : l'audit bloque`);
  if (git("cat-file", "-e", `${base}^{commit}`).status !== 0) {
    return blocking(`base ${base.slice(0, 8)} introuvable dans le checkout : l'audit bloque`);
  }

  let diffBase = base;
  if (event === "push") {
    // A history rewritten without the forced flag: the old head is no ancestor of the new one.
    if (git("merge-base", "--is-ancestor", base, "HEAD").status !== 0) {
      return blocking(`push qui réécrit l'historique (${base.slice(0, 8)} n'est pas un ancêtre) : l'audit bloque`);
    }
  } else {
    // The pull request's own changes. In CI, HEAD is GitHub's merge commit (refs/pull/N/merge) and
    // the base, pull_request.base.sha, its first parent: the merge base is the base itself, and the
    // diff is what the pull request brings to main, whatever main changed meanwhile. Run on the
    // branch head instead, the merge base still leaves out what main changed since the branch started.
    const mergeBase = git("merge-base", base, "HEAD");
    diffBase = mergeBase.stdout.trim();
    if (mergeBase.status !== 0 || !SHA1_PATTERN.test(diffBase)) {
      return blocking(`aucune base commune avec ${base.slice(0, 8)} : l'audit bloque`);
    }
  }

  const diff = git("diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", diffBase, "HEAD", "--", ...DEPENDENCY_AUDIT_TRIGGER_FILES);
  if (diff.status !== 0) return blocking("modifications illisibles : l'audit bloque");
  const changedFiles = diff.stdout.split("\0").filter(Boolean).sort();
  const subject = event === "push" ? "le push" : "la pull request";
  return changedFiles.length
    ? { blocking: true, changedFiles, reason: `${subject} modifie ${changedFiles.join(", ")} : l'audit bloque` }
    : { blocking: false, changedFiles, reason: `${subject} ne modifie ni les dépendances ni l'audit (${DEPENDENCY_AUDIT_TRIGGER_FILES.join(", ")})` };
}

export interface DependencyAuditVerdict {
  /** A GitHub workflow command, printed on stdout: the warning of a non-blocking red audit. */
  annotation: string | null;
  exitCode: 0 | 1;
  /** Markdown appended to the job summary. */
  summary: string;
}

/** Escapes a workflow command's message: a newline must not start a second command. */
function commandMessage(text: string) {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** The step's outcome, from its scope and the audit's failure message (null when the audit passed). */
export function dependencyAuditVerdict(scope: DependencyAuditScope, failure: string | null): DependencyAuditVerdict {
  if (failure === null) {
    return { annotation: null, exitCode: 0, summary: `Audit des dépendances : aucun avis bloquant (${scope.reason}).\n` };
  }
  const details = ["", "```text", failure.replaceAll("```", "'''"), "```", ""].join("\n");
  if (scope.blocking) {
    return { annotation: null, exitCode: 1, summary: `Audit des dépendances : rouge et bloquant, ${scope.reason}.\n${details}` };
  }
  return {
    annotation: `::warning title=Audit des dépendances (non bloquant)::${commandMessage(failure)}`,
    exitCode: 0,
    summary: `Audit des dépendances : rouge mais non bloquant, ${scope.reason}. L'audit quotidien de main suit ces avis dans le ticket « Audit des dépendances rouge sur main ».\n${details}`,
  };
}
