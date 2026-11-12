// pgTAP and the behavioral RLS matrix prove the migrated database, not the journeys: the same result in each of
// the dozen stacks a pull request starts. There they run once, in the required check `rls-matrix`
// (.github/workflows/e2e-rls-matrix.yml), alone on their stack and with the CI statement ceilings; the Army jobs of
// that pull request name it and skip them (docs/testing/tester-army-ci.md, "Pile, confidentialité et diagnostic").
// A push to main, a campaign and a local run have no such check for their revision: they keep their own.

export const DATABASE_CHECKS_OWNER = "rls-matrix";

/** The check the database checks of this run are delegated to, when the workflow of a pull request named one. */
export function resolveDelegatedDatabaseChecks(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): string | undefined {
  const delegated = environment.ARMY_DATABASE_CHECKS_DELEGATED_TO?.trim();
  if (!delegated) return undefined;
  if (delegated !== DATABASE_CHECKS_OWNER) {
    throw new Error(`ARMY_DATABASE_CHECKS_DELEGATED_TO names ${DATABASE_CHECKS_OWNER} or nothing: no other check runs pgTAP and the RLS matrix.`);
  }
  if (environment.GITHUB_ACTIONS !== "true" || environment.GITHUB_EVENT_NAME !== "pull_request") {
    throw new Error(`The database checks are delegated to ${DATABASE_CHECKS_OWNER} inside the checks of a pull request only: nothing else runs them for this revision.`);
  }
  return delegated;
}
