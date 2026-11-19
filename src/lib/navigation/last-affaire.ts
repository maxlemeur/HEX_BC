export function lastAffaireCookieName(userId: string, tenantId: string) {
  return `hex-affaire-${userId}-${tenantId}`;
}
