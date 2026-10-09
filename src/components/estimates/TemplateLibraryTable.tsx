"use client";

import { LayoutTemplateIcon } from "lucide-react";

import { TemplateActionMenu } from "@/components/estimates/TemplateActionMenu";
import { EmptyTableRow } from "@/components/layout/empty-state";
import type { EstimateTemplateSummary } from "@/lib/estimates/client";

type TemplateLibraryTableProps = {
  templates: EstimateTemplateSummary[];
  busyTemplateId: string | null;
  onRename: (template: EstimateTemplateSummary) => void;
  onDuplicate: (template: EstimateTemplateSummary) => void;
  onDelete: (template: EstimateTemplateSummary) => void;
};

function formatDate(dateIso: string) {
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return "-";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

export function TemplateLibraryTable({
  templates,
  busyTemplateId,
  onRename,
  onDuplicate,
  onDelete,
}: TemplateLibraryTableProps) {
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label="Modèles de chiffrage"
      tabIndex={0}
    >
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Nom</th>
            <th scope="col">Description</th>
            <th scope="col">Lignes</th>
            <th scope="col">Créé le</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {templates.length === 0 ? (
            <EmptyTableRow
              colSpan={5}
              icon={<LayoutTemplateIcon />}
              title="Aucun modèle disponible"
              description="Enregistrez une version de chiffrage comme modèle pour la retrouver ici."
            />
          ) : (
            templates.map((template) => (
              <tr key={template.id}>
                <td>
                  <div className="font-semibold text-foreground">{template.name}</div>
                </td>
                <td className="text-foreground-secondary">
                  {template.description?.trim() || "-"}
                </td>
                <td className="font-mono tabular-nums">{template.itemCount}</td>
                <td className="whitespace-nowrap">{formatDate(template.createdAt)}</td>
                <td>
                  <TemplateActionMenu
                    itemName={template.name}
                    disabled={busyTemplateId === template.id}
                    onRename={() => onRename(template)}
                    onDuplicate={() => onDuplicate(template)}
                    onDelete={() => onDelete(template)}
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
