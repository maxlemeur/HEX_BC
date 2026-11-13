/**
 * What the screens of an order of an affaire need to order and receive it (TI-691, delivery 3b-1), without any
 * dependency: the order pages are under a bundle budget, so validation schemas stay in lifecycle-contracts.ts, on the
 * server. The database decides; these only say what to offer.
 */

export type OrderStatus = "draft" | "sent" | "confirmed" | "received" | "canceled";

/**
 * The statuses an order of an affaire may be given directly, from the one it has: a draft is canceled, a canceled
 * draft reopened, and one marked « envoyée » before delivery 3b-1 returns to draft or is canceled. Confirming and
 * receiving go through their own actions; once ordered, nothing else changes.
 */
export function affaireDirectStatuses(status: OrderStatus): OrderStatus[] {
  switch (status) {
    case "draft":
      return ["draft", "canceled"];
    case "canceled":
      return ["canceled", "draft"];
    case "sent":
      return ["sent", "draft", "canceled"];
    default:
      return [status];
  }
}

/** Today in Paris, AAAA-MM-JJ: the day the database compares an order or a reception date with. */
export function parisToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now);
}

/** « 2026-11-12 » → « 12/11/2026 », without a time zone in the way. */
export function formatOrderDay(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/** The units a price is for, as the order screens write them: « les 100 », « les 1 000 » (no-break space). */
export function formatPriceLot(per: number): string {
  return per === 1 ? "" : `les ${per === 1000 ? "1 000" : String(per)}`;
}

/** What the screen says about a refusal of the confirmation or the reception: the server's sentence, else a fallback. */
export async function refusalMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } | string } | null;
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    return typeof message === "string" && message.trim() ? message : fallback;
  } catch {
    return fallback;
  }
}
