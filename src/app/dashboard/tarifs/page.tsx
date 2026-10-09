import { ChartLineIcon, EuroIcon } from "lucide-react";

import { HubLinkGrid, type HubLink } from "@/components/catalogue/HubLinkGrid";
import { PageHeader } from "@/components/layout/page-header";

const LINKS: HubLink[] = [
  {
    href: "/dashboard/prices",
    title: "Prix fournisseurs",
    description: "Grilles tarifaires des fournisseurs, imports CSV et fraîcheur des prix.",
    icon: EuroIcon,
  },
  {
    href: "/dashboard/indices",
    title: "Indices matière",
    description: "Indices de révision et coefficients des prix matière.",
    icon: ChartLineIcon,
  },
];

export default function TarifsHubPage() {
  return (
    <div className="mx-auto max-w-5xl animate-fade-in">
      <PageHeader title="Tarifs" description="Grilles tarifaires fournisseurs et indices de révision." />
      <HubLinkGrid items={LINKS} label="Sections des tarifs" />
    </div>
  );
}
