import { PricesManager } from "@/components/catalogue/PricesManager";

export default function DashboardPricesPage() {
  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Prix fournisseurs</h1>
        <p className="page-description">
          CRUD des prix fournisseur et operation bulk create pour les imports massifs.
        </p>
      </div>

      <PricesManager />
    </div>
  );
}
