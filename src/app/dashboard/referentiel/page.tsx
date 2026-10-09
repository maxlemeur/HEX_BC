import Link from "next/link";
import { BookTextIcon, BriefcaseIcon, MapPinIcon, PackageIcon } from "lucide-react";

const CARDS = [
  {
    href: "/dashboard/suppliers",
    title: "Fournisseurs",
    description: "Gestion des fournisseurs et contacts",
    icon: (
      <BriefcaseIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
    ),
  },
  {
    href: "/dashboard/sites",
    title: "Chantiers",
    description: "Suivi des chantiers et localisations",
    icon: (
      <MapPinIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
    ),
  },
  {
    href: "/dashboard/products",
    title: "Produits",
    description: "Catalogue produits interne",
    icon: (
      <PackageIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
    ),
  },
  {
    href: "/dashboard/estimates/assemblies",
    title: "Kits métiers",
    description: "Ouvrages réutilisables pour vos chiffrages",
    icon: (
      <BookTextIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
    ),
  },
];

export default function ReferentielHubPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="animate-slide-in stagger-1">
        <h1 className="text-2xl font-bold text-foreground">Référentiel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Données de référence métier
        </p>
      </div>

      <section className="space-y-3 animate-slide-in stagger-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="dashboard-card hub-card p-5 lg:col-span-2"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
                {card.icon}
              </div>
              <h3 className="mt-3 font-semibold text-foreground">{card.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{card.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
