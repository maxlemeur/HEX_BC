import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import { badRequest, conflict } from "@/lib/estimates/errors";

export function normalizeConcurrencyToken(token: string | null | undefined): string | null {
  const trimmed = token?.trim();
  if (!trimmed) return null;

  const [firstToken] = trimmed.split(",");
  const candidate = firstToken?.trim() ?? "";
  if (!candidate) return null;

  const weakMatch = candidate.match(/^W\/"(.*)"$/i);
  if (weakMatch?.[1]) {
    const weakValue = weakMatch[1].trim();
    return weakValue.length > 0 ? weakValue : null;
  }

  if (candidate.startsWith("\"") && candidate.endsWith("\"")) {
    const value = candidate.slice(1, -1).trim();
    return value.length > 0 ? value : null;
  }

  return candidate;
}

export function assertVersionConcurrencyToken(
  versionUpdatedAt: string,
  concurrencyToken: string | undefined
) {
  const normalizedToken = normalizeConcurrencyToken(concurrencyToken);

  if (!normalizedToken) {
    throw badRequest("Jeton de concurrence manquant.");
  }

  const tokenTimestamp = new Date(normalizedToken).getTime();
  const versionTimestamp = new Date(versionUpdatedAt).getTime();

  if (!Number.isFinite(tokenTimestamp)) {
    throw badRequest("Jeton de concurrence invalide.");
  }

  if (!Number.isFinite(versionTimestamp) || tokenTimestamp !== versionTimestamp) {
    throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, {
      updated_at: versionUpdatedAt,
    }, "VERSION_CONFLICT");
  }
}
