const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function stripAccents(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function takeFirstWord(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}

export function slugifySupplierName(name: string) {
  const normalized = stripAccents(name).toUpperCase();
  const firstWord = takeFirstWord(normalized);
  const compact = firstWord.replace(/[^A-Z0-9]/g, "");
  return compact.slice(0, 10) || "FOURNISSEUR";
}

export function normalizeProjectCode(projectCode?: string | null) {
  const normalized = stripAccents(projectCode ?? "").toUpperCase();
  const compact = normalized.replace(/[^A-Z0-9]/g, "");
  return compact.slice(0, 10) || "NOSITE";
}

export function initialsFromFullName(fullName: string) {
  const normalized = stripAccents(fullName).toUpperCase();
  const parts = normalized.split(/[\s-]+/).filter(Boolean);
  const initials = parts.map((part) => part[0]).join("");
  return initials.slice(0, 3) || "XX";
}

export function randomSuffix(length = 3) {
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += ALPHANUM[Math.floor(Math.random() * ALPHANUM.length)];
  }
  return value;
}

export function formatTimestamp(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return (
    `${date.getFullYear()}` +
    `${pad(date.getMonth() + 1)}` +
    `${pad(date.getDate())}` +
    `${pad(date.getHours())}` +
    `${pad(date.getMinutes())}` +
    `${pad(date.getSeconds())}`
  );
}

type PurchaseOrderReferenceInput = {
  supplierName: string;
  projectCode?: string | null;
  fullName: string;
  issuedAt?: Date;
};

export function buildPurchaseOrderReference({
  supplierName,
  projectCode,
  fullName,
  issuedAt = new Date(),
}: PurchaseOrderReferenceInput) {
  const supplier = slugifySupplierName(supplierName);
  const project = normalizeProjectCode(projectCode);
  const initials = initialsFromFullName(fullName);
  const timestamp = formatTimestamp(issuedAt);
  const suffix = randomSuffix(3);

  return `${supplier}_${project}_${initials}_${timestamp}_${suffix}`;
}
