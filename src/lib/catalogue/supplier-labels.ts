import { foldText } from "@/lib/text/fold";

/** What a picker may read of a supplier to tell it from another of the same name. */
export type SupplierIdentity = {
  id: string;
  name: string;
  city?: string | null;
  email?: string | null;
  siret?: string | null;
  created_at?: string | null;
};

const DAY = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
const TIME = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

function sameName(name: string): string {
  return foldText(name).replace(/\s+/g, " ").trim();
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function createdOn(value: string | null | undefined, withTime: boolean): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return withTime ? `créé le ${DAY.format(date)} à ${TIME.format(date)}` : `créé le ${DAY.format(date)}`;
}

/** What may tell a supplier apart, most telling first; the last one is always there and always differs. */
const MARKS: ReadonlyArray<(supplier: SupplierIdentity) => string | null> = [
  (supplier) => text(supplier.city),
  (supplier) => text(supplier.email),
  (supplier) => (text(supplier.siret) ? `SIRET ${text(supplier.siret)}` : null),
  (supplier) => createdOn(supplier.created_at, false),
  (supplier) => createdOn(supplier.created_at, true),
  (supplier) => `fiche ${supplier.id.slice(0, 8)}`,
];

/**
 * The words each supplier is shown by in a picker (TI-691): its name alone, unless another supplier of the list bears
 * the same one (letter case, accents and spaces aside). Then each homonym gets the first mark that no other homonym
 * shares: its city, its e-mail, its SIRET, the day it was created, the minute, at last the start of its identifier.
 * Nothing is merged or hidden: two suppliers stay two choices, told apart.
 */
export function supplierPickerLabels(suppliers: readonly SupplierIdentity[]): Map<string, string> {
  const groups = new Map<string, SupplierIdentity[]>();
  for (const supplier of suppliers) {
    const key = sameName(supplier.name);
    groups.set(key, [...(groups.get(key) ?? []), supplier]);
  }
  const labels = new Map<string, string>();
  for (const group of groups.values()) {
    for (const supplier of group) {
      if (group.length === 1) {
        labels.set(supplier.id, supplier.name);
        continue;
      }
      const mark = MARKS.map((read) => {
        const value = read(supplier);
        const shared = value !== null && group.some((other) => other.id !== supplier.id && read(other) === value);
        return shared ? null : value;
      }).find((value) => value !== null);
      labels.set(supplier.id, `${supplier.name} · ${mark ?? supplier.id}`);
    }
  }
  return labels;
}
