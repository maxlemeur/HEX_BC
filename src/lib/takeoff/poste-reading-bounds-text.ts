/**
 * What a member reads of the bounds of a reading against the list of items (`poste-reading-bounds.ts`), from the few
 * numbers a refused request keeps in its reason's details: no text and no name is stored, the sentence is written where
 * it is shown. Free of the reading's own modules, for the screens that show a request's reason.
 */
export type PosteReadingBoundsFacts = {
  ok: boolean;
  items: number;
  plans: number;
  calls: number;
  /** The tokens the calls are estimated to take: calls times the ledger's estimate of a call. */
  tokens: number;
  requestBudgetTokens: number;
};

const count = (value: number, one: string, many: string) => `${value.toLocaleString("fr-FR")} ${value > 1 ? many : one}`;

/** The effective limits of a request, in French, as the member reads them before confirming or after a refusal. */
export function describePosteReadingBounds(facts: PosteReadingBoundsFacts): string {
  const text = `Lecture de ${count(facts.items, "poste", "postes")} sur ${count(facts.plans, "plan", "plans")} : `
    + `${count(facts.calls, "appel prévu", "appels prévus")}, environ ${facts.tokens.toLocaleString("fr-FR")} jetons pour un budget `
    + `de ${facts.requestBudgetTokens.toLocaleString("fr-FR")}.`;
  return facts.ok ? text : `${text} Réduisez les plans ou les pages à lire.`;
}

/** The facts a refusal keeps in its reason's details (`reading_bounds`): whole numbers only. */
export function posteReadingBoundsDetails(facts: PosteReadingBoundsFacts) {
  return { items: facts.items, plans: facts.plans, calls: facts.calls, tokens: facts.tokens,
    request_budget_tokens: facts.requestBudgetTokens };
}

/** The facts of a refused request read back from its reason's details; none when they are absent or not whole numbers. */
export function readPosteReadingBoundsFacts(value: unknown): PosteReadingBoundsFacts | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const whole = (key: string) => typeof record?.[key] === "number" && Number.isSafeInteger(record[key]) && (record[key] as number) >= 0
    ? record[key] as number : null;
  const [items, plans, calls, tokens, budget] = ["items", "plans", "calls", "tokens", "request_budget_tokens"].map(whole);
  if (items === null || plans === null || calls === null || tokens === null || budget === null) return null;
  return { ok: false, items, plans, calls, tokens, requestBudgetTokens: budget };
}
