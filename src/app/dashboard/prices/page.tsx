import { HubBreadcrumb } from "@/components/HubBreadcrumb";
import { PricesManager } from "@/components/catalogue/PricesManager";

export default function DashboardPricesPage() {
  return (
    <div className="animate-fade-in">
      <HubBreadcrumb hubHref="/dashboard/tarifs" hubLabel="Tarifs" currentLabel="Prix fournisseurs" />
      <PricesManager />
    </div>
  );
}
