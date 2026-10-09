import { BookTextIcon, BriefcaseIcon, LibraryIcon, MapPinIcon, PackageIcon } from "lucide-react";

import { HubLinkGrid, type HubLink } from "@/components/catalogue/HubLinkGrid";
import { PageHeader } from "@/components/layout/page-header";

const LINKS: HubLink[] = [
  {
    href: "/dashboard/suppliers",
    title: "Fournisseurs",
    description: "Coordonnées, contacts et conditions de paiement de vos fournisseurs.",
    icon: BriefcaseIcon,
  },
  {
    href: "/dashboard/sites",
    title: "Chantiers",
    description: "Sites de livraison, codes projet et contacts sur place.",
    icon: MapPinIcon,
  },
  {
    href: "/dashboard/products",
    title: "Produits",
    description: "Base articles interne et prix de référence.",
    icon: PackageIcon,
  },
  {
    href: "/dashboard/catalogue",
    title: "Catalogue",
    description: "Articles du catalogue et liaison des lignes DPGF importées.",
    icon: LibraryIcon,
  },
  {
    href: "/dashboard/estimates/assemblies",
    title: "Ouvrages",
    description: "Bibliothèque d’ouvrages réutilisables pour vos chiffrages.",
    icon: BookTextIcon,
  },
];

export default function ReferentielHubPage() {
  return (
    <div className="mx-auto max-w-5xl animate-fade-in">
      <PageHeader title="Référentiel" description="Données de référence métier partagées par vos chiffrages et vos commandes." />
      <HubLinkGrid items={LINKS} label="Sections du référentiel" />
    </div>
  );
}
