import { MailIcon, PhoneIcon } from "lucide-react";

import { COMPANY_INFO } from "@/lib/company-info";

export type PortalIssuerContact = {
  fullName: string | null;
  jobTitle: string | null;
  phone: string | null;
  email: string | null;
};

function hasContactDetails(issuer: PortalIssuerContact | null | undefined): issuer is PortalIssuerContact {
  return Boolean(issuer && (issuer.fullName || issuer.phone || issuer.email));
}

const linkClass =
  "inline-flex items-center gap-2 font-medium text-primary underline underline-offset-4 hover:text-brand-blue-light";

/**
 * Coordonnées de l'émetteur sur les pages d'impasse du portail.
 *
 * UX-D / UX67 : « Veuillez contacter votre interlocuteur » sans dire lequel
 * laisse le client dans une impasse — c'est le seul écran qu'il voit. Quand le
 * lien est reconnu, on affiche la personne qui a émis le devis (les mêmes
 * informations que sur le devis lui-même) ; sinon, les coordonnées de
 * l'entreprise.
 */
export function PortalContactBlock({ issuer }: Readonly<{ issuer?: PortalIssuerContact | null }>) {
  if (hasContactDetails(issuer)) {
    return (
      <address className="mt-6 w-full max-w-sm rounded-lg border border-border bg-surface px-5 py-4 text-left text-sm not-italic text-foreground-secondary shadow-card">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Votre interlocuteur
        </p>
        {issuer.fullName ? (
          <p className="mt-2 font-semibold text-foreground">{issuer.fullName}</p>
        ) : null}
        {issuer.jobTitle ? <p>{issuer.jobTitle}</p> : null}
        <ul className="mt-3 space-y-2">
          {issuer.phone ? (
            <li>
              <a className={linkClass} href={`tel:${issuer.phone.replaceAll(" ", "")}`}>
                <PhoneIcon aria-hidden="true" className="size-4 shrink-0" />
                {issuer.phone}
              </a>
            </li>
          ) : null}
          {issuer.email ? (
            <li className="min-w-0">
              <a className={`${linkClass} break-all`} href={`mailto:${issuer.email}`}>
                <MailIcon aria-hidden="true" className="size-4 shrink-0" />
                {issuer.email}
              </a>
            </li>
          ) : null}
        </ul>
      </address>
    );
  }

  return (
    <address className="mt-6 w-full max-w-sm rounded-lg border border-border bg-surface px-5 py-4 text-sm not-italic text-foreground-secondary shadow-card">
      <p className="font-semibold text-foreground">{COMPANY_INFO.name}</p>
      <p className="mt-1">
        {COMPANY_INFO.address.street}, {COMPANY_INFO.address.postalCode}{" "}
        {COMPANY_INFO.address.city}
      </p>
      <p className="mt-2">
        <a
          className={linkClass}
          href={`tel:${COMPANY_INFO.phone.landline.replaceAll(" ", "")}`}
        >
          <PhoneIcon aria-hidden="true" className="size-4 shrink-0" />
          {COMPANY_INFO.phone.landline}
        </a>
      </p>
    </address>
  );
}
