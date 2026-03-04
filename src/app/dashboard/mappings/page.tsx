import { DpgfStepper } from "@/components/DpgfStepper";
import { MappingWizard } from "@/components/mappings/MappingWizard";

type DashboardMappingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function resolveImportId(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
    return first ?? null;
  }

  return null;
}

export default async function DashboardMappingsPage({ searchParams }: DashboardMappingsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const importId = resolveImportId(resolvedSearchParams?.import_id);

  return (
    <div className="animate-fade-in">
      <DpgfStepper importId={importId} />
      <div className="page-header">
        <h1 className="page-title">Mapping DPGF</h1>
        <p className="page-description">
          Associez les colonnes de votre fichier aux champs metier, puis validez le mapping.
        </p>
      </div>

      <MappingWizard initialImportId={importId} />
    </div>
  );
}
