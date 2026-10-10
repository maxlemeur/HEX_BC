import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compares a request-supplied shared secret with the configured one in
 * constant time. Both sides are hashed first so neither the content nor the
 * length of the expected secret leaks through response timing.
 */
export function sharedSecretMatches(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!provided || !expected) {
    return false;
  }

  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
