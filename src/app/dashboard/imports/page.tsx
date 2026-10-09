import { DpgfStepper } from "@/components/DpgfStepper";
import { ImportWizard } from "@/components/imports/ImportWizard";
import { PageHeader } from "@/components/layout/page-header";

export default function DashboardImportsPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Import DPGF"
        description="Décomposition du Prix Global et Forfaitaire — CSV, XLSX, XLS ou PDF tabulaire."
      />
      <DpgfStepper />

      <ImportWizard />
    </div>
  );
}
