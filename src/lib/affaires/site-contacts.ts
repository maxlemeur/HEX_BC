import { z } from "zod";

/**
 * The site contacts of an affaire (TI-691, owner's decision of 22/11/2026): the people a supplier calls when it
 * delivers, each usually with one number. Entered on the affaire's fiche and written, at the creation of a draft made
 * from one of its material requests, in that draft's « Instructions complémentaires ». The database
 * (estimate_projects.site_contacts, private.normalize_affaire_site_contacts) trims them and refuses another shape; this
 * module is the same contract for the screen and the server action.
 */

export const AFFAIRE_SITE_CONTACTS_MAX = 20;
export const AFFAIRE_SITE_CONTACT_NAME_MAX = 120;
export const AFFAIRE_SITE_CONTACT_ROLE_MAX = 80;
export const AFFAIRE_SITE_CONTACT_PHONE_MAX = 40;

export type AffaireSiteContact = { name: string; role?: string; phone?: string };

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} : ${max} caractères au plus.`)
    .nullable()
    .optional()
    .transform((value) => (value ? value : undefined));

export const affaireSiteContactSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Chaque contact sur site a un nom.")
      .max(AFFAIRE_SITE_CONTACT_NAME_MAX, `Nom du contact : ${AFFAIRE_SITE_CONTACT_NAME_MAX} caractères au plus.`),
    role: optionalText(AFFAIRE_SITE_CONTACT_ROLE_MAX, "Rôle du contact"),
    phone: optionalText(AFFAIRE_SITE_CONTACT_PHONE_MAX, "Téléphone du contact"),
  })
  .strict()
  .transform(({ name, role, phone }): AffaireSiteContact => ({
    name,
    ...(role ? { role } : {}),
    ...(phone ? { phone } : {}),
  }));

export const affaireSiteContactsSchema = z
  .array(affaireSiteContactSchema)
  .max(AFFAIRE_SITE_CONTACTS_MAX, `${AFFAIRE_SITE_CONTACTS_MAX} contacts sur site au plus.`);

/**
 * The contacts as the database stores them, read one by one: a contact the screen's rules do not accept (written
 * outside it, with a name of non-breaking spaces for instance) is shown as stored rather than dropping the whole
 * list, which the next save would then erase.
 */
export function readAffaireSiteContacts(value: unknown): AffaireSiteContact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AffaireSiteContact[] => {
    const parsed = affaireSiteContactSchema.safeParse(entry);
    if (parsed.success) return [parsed.data];
    if (!entry || typeof entry !== "object" || typeof (entry as { name?: unknown }).name !== "string") return [];
    const { name, role, phone } = entry as { name: string; role?: unknown; phone?: unknown };
    return [{
      name,
      ...(typeof role === "string" && role ? { role } : {}),
      ...(typeof phone === "string" && phone ? { phone } : {}),
    }];
  });
}

/** « Jean Fictif (chef de chantier) : 06 00 00 00 01 », as the purchase orders print each contact. */
export function affaireSiteContactText(contact: AffaireSiteContact): string {
  return `${contact.name}${contact.role ? ` (${contact.role})` : ""}${contact.phone ? ` : ${contact.phone}` : ""}`;
}
