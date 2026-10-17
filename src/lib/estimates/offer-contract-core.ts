import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";

/**
 * Primitives strictes partagées par le contrat client 1 (`offer-contract.ts`) et le contrat
 * client 2 (`offer-contract-v2-parse.ts`, lot 2, sous-lot 2.7, D14). Elles ont été déplacées
 * telles quelles depuis `offer-contract.ts` : le contrat 2 réutilise les validateurs du contrat 1
 * sans que les deux modules dépendent l'un de l'autre à l'exécution (aucun cycle, budgets
 * d'architecture). Aucune règle ni aucun message ne change.
 */

type TermsFields = {
  templateId: string;
  title: string;
  body: string;
  version: number;
  capturedAt: string;
};
export type OfferTermsSnapshot =
  | (TermsFields & { legalReviewedAt: string })
  | (TermsFields & { legalReviewedAt: string | null; isDraft: true });
export type OfferProofParseOptions = { allowDevelopmentTerms?: boolean };
export type OfferContractErrorCode =
  | "OFFER_CLIENT_CONTRACT_INVALID"
  | "OFFER_DOCUMENT_PROOF_INVALID"
  | "OFFER_SEAL_INPUT_INVALID"
  | "OFFER_PRESENTATION_INVALID";

export class OfferContractError extends Error {
  constructor(public readonly code: OfferContractErrorCode, message: string) {
    super(message);
    this.name = "OfferContractError";
  }
}

export type OfferAddress = { street: string; postalCode: string; city: string };

export const MAX_CENTS = 2_147_483_647;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
export type RecordValue = Record<string, unknown>;

export class InvalidValue extends Error {}

export function invalid(location: string): never {
  throw new InvalidValue(`Invalid offer contract at ${location}.`);
}

export function object(value: unknown, required: readonly string[], location: string, optional: readonly string[] = []): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(location);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(location);
  const allowed = new Set([...required, ...optional]);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.has(key)) invalid(location);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !("value" in descriptor)) invalid(location);
  }
  if (required.some((key) => !Object.hasOwn(descriptors, key))) invalid(location);
  return value as RecordValue;
}

export function text(value: unknown, location: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) invalid(location);
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(location);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      invalid(location);
    }
  }
  return value;
}

export function nullableText(value: unknown, location: string): string | null {
  return value === null ? null : text(value, location);
}

export function integer(value: unknown, minimum: number, maximum: number, location: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0)
    || value < minimum || value > maximum) invalid(location);
  return value;
}

export function cents(value: unknown, location: string): number {
  return integer(value, 0, MAX_CENTS, location);
}

export function uuid(value: unknown, location: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(location);
  return value;
}

export function nullableUuid(value: unknown, location: string): string | null {
  return value === null ? null : uuid(value, location);
}

export function hash(value: unknown, location: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) invalid(location);
  return value;
}

export function choice<T extends string | number | null>(value: unknown, values: readonly T[], location: string): T {
  if (!values.includes(value as T)) invalid(location);
  return value as T;
}

export function boolean(value: unknown, location: string): boolean {
  if (typeof value !== "boolean") invalid(location);
  return value;
}

function validCalendar(year: number, month: number, day: number): boolean {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function date(value: unknown, location: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(location);
  const [year, month, day] = value.split("-").map(Number);
  if (!validCalendar(year, month, day)) invalid(location);
  return value;
}

export function instant(value: unknown, location: string): { original: string; utc: string } {
  if (typeof value !== "string") invalid(location);
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?([Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) invalid(location);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHour = Number(match[10] ?? 0);
  const offsetMinute = Number(match[11] ?? 0);
  if (!validCalendar(year, month, day) || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) invalid(location);
  const offset = (offsetHour * 60 + offsetMinute) * (match[9] === "-" ? -1 : 1);
  const wholeSecond = new Date(0);
  wholeSecond.setUTCFullYear(year, month - 1, day);
  wholeSecond.setUTCHours(hour, minute, second, 0);
  const utc = new Date(wholeSecond.getTime() - offset * 60_000).toISOString();
  if (!/^\d{4}-/.test(utc) || utc.startsWith("0000-")) invalid(location);
  // Date handles only whole seconds/zone arithmetic. Never pass the microseconds
  // through its millisecond precision; preserve them as an independent fraction.
  return { original: value, utc: `${utc.slice(0, -5)}.${(match[7] ?? "").padEnd(6, "0")}Z` };
}

function calendarOrInstant(value: unknown, location: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return date(value, location);
  return instant(value, location).original;
}

export function address(value: unknown, location: string): OfferAddress {
  const source = object(value, ["street", "postalCode", "city"], location);
  return {
    street: text(source.street, `${location}.street`),
    postalCode: text(source.postalCode, `${location}.postalCode`),
    city: text(source.city, `${location}.city`),
  };
}

export function parseLayout(value: unknown): EstimatePdfLayoutOptions {
  const source = object(value, ["preset", "detailLevel", "priceMode", "density", "showNumbering", "showSectionSubtotals", "conditionsPlacement", "includeTerms"], "layoutOptions");
  return {
    preset: choice(source.preset, ["client_detailed", "decision_summary", "fo_mo"], "layoutOptions.preset"),
    detailLevel: choice(source.detailLevel, [1, 2, 3, 4, "lines"], "layoutOptions.detailLevel"),
    priceMode: choice(source.priceMode, ["total_only", "unit_and_total", "fo_mo_and_total"], "layoutOptions.priceMode"),
    density: choice(source.density, ["compact", "standard", "comfortable"], "layoutOptions.density"),
    showNumbering: boolean(source.showNumbering, "layoutOptions.showNumbering"),
    showSectionSubtotals: boolean(source.showSectionSubtotals, "layoutOptions.showSectionSubtotals"),
    conditionsPlacement: choice(source.conditionsPlacement, ["auto", "new_page"], "layoutOptions.conditionsPlacement"),
    includeTerms: boolean(source.includeTerms, "layoutOptions.includeTerms"),
  };
}

export function parseTerms(value: unknown, options: OfferProofParseOptions): OfferTermsSnapshot | null {
  if (value === null) return null;
  const source = object(value, ["templateId", "title", "body", "version", "legalReviewedAt", "capturedAt"], "termsSnapshot", ["isDraft"]);
  const draft = Object.hasOwn(source, "isDraft");
  if (draft && (source.isDraft !== true || options.allowDevelopmentTerms !== true)) invalid("termsSnapshot.isDraft");
  const fields: TermsFields = { templateId: text(source.templateId, "termsSnapshot.templateId"), title: text(source.title, "termsSnapshot.title"),
    body: text(source.body, "termsSnapshot.body"), version: integer(source.version, 1, Number.MAX_SAFE_INTEGER, "termsSnapshot.version"),
    capturedAt: instant(source.capturedAt, "termsSnapshot.capturedAt").original };
  if (draft) return { ...fields, legalReviewedAt: source.legalReviewedAt === null ? null : calendarOrInstant(source.legalReviewedAt, "termsSnapshot.legalReviewedAt"), isDraft: true };
  return { ...fields, legalReviewedAt: calendarOrInstant(source.legalReviewedAt, "termsSnapshot.legalReviewedAt") };
}

export function run<T>(code: OfferContractErrorCode, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    // Unknown input can contain throwing proxies. Do not echo their values or
    // messages; the public interface exposes only a stable code and location.
    throw new OfferContractError(code, error instanceof InvalidValue ? error.message : "Invalid offer contract.");
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object" && value !== null) {
    const source = value as RecordValue;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalValue(source[key])]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}
