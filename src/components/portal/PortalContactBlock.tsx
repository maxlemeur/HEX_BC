import { COMPANY_INFO } from "@/lib/company-info";

/**
 * Coordonnées de l'émetteur sur les pages d'impasse du portail.
 *
 * UX-D : « Veuillez contacter votre interlocuteur » sans dire lequel laisse le
 * client dans une impasse — c'est le seul écran qu'il voit, et il n'a aucun
 * moyen de savoir qui joindre. Un devis expiré ou un lien révoqué est un moment
 * où l'on veut justement qu'il rappelle.
 */
export function PortalContactBlock() {
  return (
    <div className="mt-6 rounded-xl border border-[var(--slate-200)] bg-white px-5 py-4 text-sm text-[var(--slate-600)]">
      <p className="font-semibold text-[var(--slate-800)]">
        {COMPANY_INFO.name}
      </p>
      <p className="mt-1">
        {COMPANY_INFO.address.street}, {COMPANY_INFO.address.postalCode}{" "}
        {COMPANY_INFO.address.city}
      </p>
      <p className="mt-1">
        <a
          className="font-medium text-[var(--brand-blue,#1e3a8a)] underline"
          href={`tel:${COMPANY_INFO.phone.landline.replaceAll(" ", "")}`}
        >
          {COMPANY_INFO.phone.landline}
        </a>
      </p>
    </div>
  );
}
