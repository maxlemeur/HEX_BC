type NormalizeDocumentIssuerInput = {
  issuerName?: string | null;
  issuerRole?: string | null;
  issuerEmail?: string | null;
  fallbackName?: string;
};

function isEmailLike(value: string | null | undefined): boolean {
  return Boolean(value?.trim().match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));
}

function nameFromEmail(email: string): string {
  const localPart = email.split("@")[0]?.trim() ?? "";
  const parts = localPart.split(/[._-]+/).filter(Boolean);

  if (parts.length === 0) return "Utilisateur";

  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0
        ? lower.charAt(0).toUpperCase() + lower.slice(1)
        : lower.toUpperCase();
    })
    .join(" ");
}

export function normalizeDocumentIssuerDisplay({
  issuerName,
  issuerRole,
  issuerEmail,
  fallbackName = "Utilisateur",
}: NormalizeDocumentIssuerInput) {
  const rawName = issuerName?.trim() ?? "";
  const rawRole = issuerRole?.trim() ?? "";
  const rawEmail = issuerEmail?.trim() ?? "";
  const nameSource = rawName || rawEmail;
  const nameIsEmail = isEmailLike(nameSource);
  const displayEmail = rawEmail || (nameIsEmail ? nameSource : "");
  const displayName = nameIsEmail
    ? nameFromEmail(nameSource)
    : nameSource || fallbackName;
  const displayRole =
    rawRole &&
    !isEmailLike(rawRole) &&
    rawRole !== rawName &&
    rawRole !== displayEmail
      ? rawRole
      : "";

  return {
    displayEmail,
    displayName,
    displayRole,
  };
}
