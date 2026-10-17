import { resolveEstimateEngineVersionForDisplay } from "@/lib/estimates/calc-engine-version";
import { isLegacyEngine, isUnifiedEngine, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";

const MAX_CENTS = 2_147_483_647;

export type FixedDiscountVersion = {
  discount_amount_cents?: number | null;
  total_ht_cents?: number | null;
  calc_engine_version?: number | null;
  content_revision?: number | string | null;
  calc_snapshot_content_revision?: number | string | null;
  calc_snapshot_context?: unknown;
  id?: string;
  tenant_id?: string;
  project_id?: string;
  status?: string;
  updated_at?: string;
  /** Moteur 3 : brut et remise appliquée stockés (§6.2), comparés au gel. */
  gross_ht_cents?: number | null;
  discount_applied_cents?: number | null;
};

export type CanonicalFixedDiscountEvidence = Readonly<{
  source: "authenticated_live" | "stored_v1";
  version: Readonly<{
    id: string;
    tenant_id: string;
    project_id: string;
    status: string;
    content_revision: number;
    updated_at: string;
  }>;
  fixed_discount: Readonly<{
    requested_cents: number;
    base_cents: number;
    applied_cents: number;
  }>;
  net_cents: number;
}>;

export type ReadyFixedDiscountSignal = {
  state: "ready";
  source: "snapshot_v2" | "snapshot_v3" | CanonicalFixedDiscountEvidence["source"];
  requestedCents: number;
  baseCents: number;
  appliedCents: number;
  netCents: number;
};

export type FixedDiscountSignal =
  | { state: "legacy" }
  | { state: "unavailable" }
  | ReadyFixedDiscountSignal;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    !Object.is(value, -0) && value >= 0 && value <= MAX_CENTS;
}

function revision(value: unknown): number | null {
  const number = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function readSignal(
  value: unknown,
  version: FixedDiscountVersion,
  source: ReadyFixedDiscountSignal["source"],
): ReadyFixedDiscountSignal | null {
  const input = record(value);
  if (!input || !cents(version.discount_amount_cents) || !cents(version.total_ht_cents) ||
    !cents(input.requested_cents) || !cents(input.base_cents) || !cents(input.applied_cents) ||
    input.requested_cents !== version.discount_amount_cents ||
    input.applied_cents !== Math.min(input.requested_cents, input.base_cents) ||
    input.base_cents - input.applied_cents !== version.total_ht_cents) return null;
  return {
    state: "ready", source, requestedCents: input.requested_cents,
    baseCents: input.base_cents, appliedCents: input.applied_cents,
    netCents: input.base_cents - input.applied_cents,
  };
}

/**
 * Lot 2, sous-lot 2.5 - remise exacte v3 (D6, §6.5). Une intention en pourcentage est exacte dans
 * `discount_bp` (aucun montant dérivé) : signal « historique » sur ce taux. Une intention en montant
 * n'est prouvée que par un gel v3 frais dont la clé `discount` retrouve le montant demandé, le brut
 * et la remise appliquée stockés ; sinon elle est indisponible, jamais un taux inventé.
 */
function resolveV3FixedDiscountSignal(version: FixedDiscountVersion): FixedDiscountSignal {
  if (version.discount_amount_cents == null) return { state: "legacy" };
  if (!cents(version.discount_amount_cents)) return { state: "unavailable" };
  const currentRevision = revision(version.content_revision);
  if (currentRevision === null || revision(version.calc_snapshot_content_revision) !== currentRevision) {
    return { state: "unavailable" };
  }
  const context = record(version.calc_snapshot_context);
  const discount = record(context?.discount);
  if (!context || context.engine !== 3 || !discount || discount.kind !== "amount" ||
    !cents(discount.requested_cents) || !cents(discount.base_cents) || !cents(discount.applied_cents) ||
    discount.requested_cents !== version.discount_amount_cents ||
    discount.applied_cents !== Math.min(discount.requested_cents, discount.base_cents) ||
    discount.base_cents !== version.gross_ht_cents || discount.applied_cents !== version.discount_applied_cents) {
    return { state: "unavailable" };
  }
  return {
    state: "ready", source: "snapshot_v3", requestedCents: discount.requested_cents,
    baseCents: discount.base_cents, appliedCents: discount.applied_cents,
    netCents: discount.base_cents - discount.applied_cents,
  };
}

/** A missing fixed proof is unavailable, never an invented zero or inverse net. */
export function resolveFixedDiscountSignal(
  version: FixedDiscountVersion,
  evidence?: CanonicalFixedDiscountEvidence | null,
): FixedDiscountSignal {
  const calcEngineVersion = resolveEstimateEngineVersionForDisplay(version);
  if (calcEngineVersion === null) return { state: "unavailable" };
  if (usesSaleCoefficients(calcEngineVersion)) return resolveV3FixedDiscountSignal(version);
  if (version.discount_amount_cents == null) return { state: "legacy" };
  if (!cents(version.discount_amount_cents)) return { state: "unavailable" };
  if (evidence) {
    const currentRevision = revision(version.content_revision);
    const identityMatches = currentRevision !== null &&
      evidence.version.content_revision === currentRevision &&
      (evidence.source === "authenticated_live" ? version.status === "draft" :
        evidence.source === "stored_v1" && isLegacyEngine(calcEngineVersion) &&
        typeof version.status === "string" && version.status !== "draft") &&
      ["id", "tenant_id", "project_id", "status", "updated_at"].every((key) => {
        const name = key as "id" | "tenant_id" | "project_id" | "status" | "updated_at";
        return typeof version[name] === "string" && version[name] === evidence.version[name];
      }) && evidence.net_cents === version.total_ht_cents;
    if (identityMatches) {
      const signal = readSignal(evidence.fixed_discount, version, evidence.source);
      if (signal) return signal;
    }
  }
  const currentRevision = revision(version.content_revision);
  if (!isUnifiedEngine(calcEngineVersion) || currentRevision === null ||
    revision(version.calc_snapshot_content_revision) !== currentRevision) return { state: "unavailable" };
  const signal = readSignal(record(version.calc_snapshot_context)?.fixed_discount, version, "snapshot_v2");
  return signal ?? { state: "unavailable" };
}

function decimalRational(value: number): { numerator: bigint; denominator: bigint } {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const [coefficient, exponent = "0"] = safe.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const scale = fraction.length - Number(exponent);
  const numerator = BigInt(whole + fraction);
  return scale >= 0
    ? { numerator, denominator: BigInt(10) ** BigInt(scale) }
    : { numerator: numerator * BigInt(10) ** BigInt(-scale), denominator: BigInt(1) };
}

function compareThreshold(signal: ReadyFixedDiscountSignal, thresholdBp: number): number {
  const threshold = decimalRational(thresholdBp);
  // A proved zero base has effective rate zero, unlike a missing proof.
  if (signal.baseCents === 0) return threshold.numerator === BigInt(0) ? 0 : -1;
  const left = BigInt(signal.appliedCents) * BigInt(10_000) * threshold.denominator;
  const right = threshold.numerator * BigInt(signal.baseCents);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function exceedsDiscountThreshold(signal: ReadyFixedDiscountSignal, thresholdBp: number): boolean {
  return compareThreshold(signal, thresholdBp) > 0;
}

export function meetsDiscountThreshold(signal: ReadyFixedDiscountSignal, thresholdBp: number): boolean {
  return compareThreshold(signal, thresholdBp) >= 0;
}

/** Display value only: threshold decisions use exact cross multiplication. */
export function fixedDiscountBasisPoints(signal: ReadyFixedDiscountSignal): number {
  return signal.baseCents === 0 ? 0 : signal.appliedCents * 10_000 / signal.baseCents;
}
