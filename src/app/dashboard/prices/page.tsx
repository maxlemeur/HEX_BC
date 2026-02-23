import { PricesManager } from "@/components/catalogue/PricesManager";

export default function DashboardPricesPage() {
  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Prix fournisseurs</h1>
        <p className="page-description">
          Gerez les tarifs de vos fournisseurs. Ajoutez-les un par un ou importez-les en masse depuis un fichier CSV.
        </p>
      </div>

      <PricesManager />
    </div>
  );
}
