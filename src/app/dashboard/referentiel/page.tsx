import Link from "next/link";

const CARDS = [
  {
    href: "/dashboard/suppliers",
    title: "Fournisseurs",
    description: "Gestion des fournisseurs et contacts",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        <rect width="20" height="14" x="2" y="6" rx="2" />
      </svg>
    ),
  },
  {
    href: "/dashboard/sites",
    title: "Chantiers",
    description: "Suivi des chantiers et localisations",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
  {
    href: "/dashboard/products",
    title: "Produits",
    description: "Catalogue produits interne",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="m7.5 4.27 9 5.15" />
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </svg>
    ),
  },
  {
    href: "/dashboard/estimates/assemblies",
    title: "Kits métiers",
    description: "Assemblages réutilisables pour vos chiffrages",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5z" />
        <path d="M8 7h8" />
        <path d="M8 11h8" />
        <path d="M8 15h5" />
      </svg>
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
