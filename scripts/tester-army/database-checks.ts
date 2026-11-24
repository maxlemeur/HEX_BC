// pgTAP and the behavioral RLS matrix prove the migrated database, not the journeys: the same result in each of
// the dozen stacks a pull request or a push to main starts. There they run once, in `rls-matrix`
// (.github/workflows/e2e-rls-matrix.yml, required on a pull request), alone on their stack and with the CI statement
// ceilings; the Army jobs of that pull request or that push name it and skip them (docs/testing/tester-army-ci.md,
// "Pile, confidentialité et diagnostic"). On main, `rls-matrix` runs for every push the Army workflows run for and
// never cancels a push run, and a red one reaches the issue « CI rouge sur main » (ci-night-alert.yml).
// A scheduled or dispatched campaign, a push to another branch and a local run have no such check for their
// revision: they keep their own.

export const DATABASE_CHECKS_OWNER = "rls-matrix";

/** Whether `rls-matrix` runs for the revision of this GitHub Actions run: a pull request, or a push to main. */
function databaseChecksOwnerRuns(environment: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  if (environment.GITHUB_ACTIONS !== "true") return false;
  return environment.GITHUB_EVENT_NAME === "pull_request" ||
    (environment.GITHUB_EVENT_NAME === "push" && environment.GITHUB_REF === "refs/heads/main");
}

/** The check the database checks of this run are delegated to, when the workflow of a pull request or of a push to main named one. */
export function resolveDelegatedDatabaseChecks(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): string | undefined {
  const delegated = environment.ARMY_DATABASE_CHECKS_DELEGATED_TO?.trim();
  if (!delegated) return undefined;
  if (delegated !== DATABASE_CHECKS_OWNER) {
    throw new Error(`ARMY_DATABASE_CHECKS_DELEGATED_TO names ${DATABASE_CHECKS_OWNER} or nothing: no other check runs pgTAP and the RLS matrix.`);
  }
  if (!databaseChecksOwnerRuns(environment)) {
    throw new Error(`The database checks are delegated to ${DATABASE_CHECKS_OWNER} inside the checks of a pull request or of a push to main only: nothing else runs them for this revision.`);
  }
  return delegated;
}
