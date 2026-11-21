/**
 * The key of a manual launch command (`launchTakeoffRelaunch`) while its answer is unknown: a lost answer, a server error.
 * It is kept in the browser for that intention of that member (affaire, intent, analysis replaced, plan set, preparation
 * revision), so that a click after a reload sends it again and the replay finds the command's receipt instead of paying a
 * second analysis. An answer, a success or a refusal the server named, ends it: a later click is a new command.
 */
export type TakeoffLaunchIntention = {
  tenantId: string | null;
  userId: string | null;
  projectId: string;
  /** The analysis the launch replaces; none for the affaire's first analysis (intent `initial`). */
  predecessorJobId: string | null;
  planSetId: string;
  preparationRevision: number;
};

const PREFIX = "mergeone:takeoff-launch-intent:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// When the browser keeps nothing (storage refused): the key still outlives the dialogue, until the page is left.
const pendingInPage = new Map<string, string>();

function intentionKey(intention: TakeoffLaunchIntention) {
  return PREFIX + [intention.tenantId ?? "-", intention.userId ?? "-", intention.projectId,
    intention.predecessorJobId ? "reread_plans" : "initial", intention.predecessorJobId ?? "-", intention.planSetId,
    String(intention.preparationRevision)].join(":");
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The key the intention's unanswered command used, or a new one, kept until its answer. */
export function takeTakeoffLaunchIntentKey(intention: TakeoffLaunchIntention): string {
  const key = intentionKey(intention);
  const storage = browserStorage();
  let pending: string | null = null;
  try {
    pending = storage?.getItem(key) ?? null;
  } catch {
    pending = null;
  }
  pending ??= pendingInPage.get(key) ?? null;
  const intentKey = pending && UUID.test(pending) ? pending : crypto.randomUUID();
  pendingInPage.set(key, intentKey);
  try {
    storage?.setItem(key, intentKey);
  } catch {
    // Kept in the page only.
  }
  return intentKey;
}

/** The command was answered: the same intention later is a new command. */
export function settleTakeoffLaunchIntentKey(intention: TakeoffLaunchIntention) {
  const key = intentionKey(intention);
  pendingInPage.delete(key);
  try {
    browserStorage()?.removeItem(key);
  } catch {
    // Nothing kept.
  }
}
