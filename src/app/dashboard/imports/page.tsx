import { ImportWizard } from "@/components/imports/ImportWizard";

export default function DashboardImportsPage() {
  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Imports</h1>
        <p className="page-description">
          Chargez vos fichiers CSV ou Excel, suivez le parsing et l&apos;etat de traitement.
        </p>
      </div>

      <ImportWizard />
    </div>
  );
}
