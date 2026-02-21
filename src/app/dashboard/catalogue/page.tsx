import { CatalogueManager } from "@/components/catalogue/CatalogueManager";

export default function DashboardCataloguePage() {
  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Catalogue</h1>
        <p className="page-description">
          CRUD catalogue et helper de liaison des lignes mappees via `hex_code` / `designation`.
        </p>
      </div>

      <CatalogueManager />
    </div>
  );
}
