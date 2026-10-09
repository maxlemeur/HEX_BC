import Link from "next/link";
import { ChartLineIcon, EuroIcon } from "lucide-react";

const CARDS = [
  {
    href: "/dashboard/prices",
    title: "Prix fournisseurs",
    description: "Grilles tarifaires des fournisseurs",
    icon: (
      <EuroIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
    ),
  },
  {
    href: "/dashboard/indices",
    title: "Indices",
    description: "Indices de révision et coefficients",
    icon: (
      <ChartLineIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
    ),
  },
];

export default function TarifsHubPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="animate-slide-in stagger-1">
        <h1 className="text-2xl font-bold text-foreground">Tarifs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Grilles tarifaires et indices de révision
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
