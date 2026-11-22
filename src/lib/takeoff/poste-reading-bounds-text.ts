/**
 * What a member reads of the bounds of a reading against the list of items (`poste-reading-bounds.ts`), from the few
 * numbers a refused request keeps in its reason's details: no text and no name is stored, the sentence is written where
 * it is shown. Free of the reading's own modules, for the screens that show a request's reason.
 */
export type PosteReadingBoundsFacts = {
  ok: boolean;
  items: number;
  plans: number;
  /** The reading's calls (fragments times batches), those of the vector classifier at most, and their time on one Mac. */
  readingCalls: number;
  classifierCalls: number;
  minutes: number;
  /** The ceilings of the reading's calls when they were checked: a request's, a plan's; and the pages of a plan. */
  maxRequestCalls: number;
  maxPlanCalls: number;
  maxPlanPages: number;
};

const count = (value: number, one: string, many: string) => `${value.toLocaleString("fr-FR")} ${value > 1 ? many : one}`;

/** A duration on the Mac as the member reads it: « 47 min », « 12 h », « 9 h 30 ». */
function duration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${String(rest).padStart(2, "0")}` : ""}`;
}

/**
 * The reading a request plans, in French: its calls and their time on the Mac (never a token budget, which the member
 * cannot act on); once refused, the ceilings and what to reduce.
 */
export function describePosteReadingBounds(facts: PosteReadingBoundsFacts): string {
  const calls = count(facts.readingCalls, "appel de lecture", "appels de lecture")
    + (facts.classifierCalls ? ` et ${facts.classifierCalls.toLocaleString("fr-FR")} de classification vectorielle au plus` : "");
  const text = `Lecture de ${count(facts.items, "poste", "postes")} sur ${count(facts.plans, "plan", "plans")} : ${calls}, `
    + `environ ${duration(facts.minutes)} sur un Mac.`;
  return facts.ok ? text : `${text} Au plus ${facts.maxRequestCalls.toLocaleString("fr-FR")} appels de lecture par demande, `
    + `${facts.maxPlanCalls.toLocaleString("fr-FR")} par plan et ${facts.maxPlanPages.toLocaleString("fr-FR")} pages par plan : `
    + "réduisez les plans ou les pages à lire.";
}

/** The facts a refusal keeps in its reason's details (`reading_bounds`): whole numbers only. */
export function posteReadingBoundsDetails(facts: PosteReadingBoundsFacts) {
  return { items: facts.items, plans: facts.plans, reading_calls: facts.readingCalls, classifier_calls: facts.classifierCalls,
    minutes: facts.minutes, max_request_calls: facts.maxRequestCalls, max_plan_calls: facts.maxPlanCalls,
    max_plan_pages: facts.maxPlanPages };
}

/** The facts of a refused request read back from its reason's details; none when they are absent or not whole numbers. */
export function readPosteReadingBoundsFacts(value: unknown): PosteReadingBoundsFacts | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const whole = (key: string) => typeof record?.[key] === "number" && Number.isSafeInteger(record[key]) && (record[key] as number) >= 0
    ? record[key] as number : null;
  const [items, plans, readingCalls, classifierCalls, minutes, maxRequestCalls, maxPlanCalls, maxPlanPages] = ["items", "plans",
    "reading_calls", "classifier_calls", "minutes", "max_request_calls", "max_plan_calls", "max_plan_pages"].map(whole);
  if (items === null || plans === null || readingCalls === null || classifierCalls === null || minutes === null
    || maxRequestCalls === null || maxPlanCalls === null || maxPlanPages === null) return null;
  return { ok: false, items, plans, readingCalls, classifierCalls, minutes, maxRequestCalls, maxPlanCalls, maxPlanPages };
}
