"use client";

import { TemplateActionMenu } from "@/components/estimates/TemplateActionMenu";
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
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Description</th>
            <th>Lignes</th>
            <th>Cree le</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {templates.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-10 text-center text-[var(--slate-500)]">
                Aucun template disponible.
              </td>
            </tr>
          ) : (
            templates.map((template) => (
              <tr key={template.id}>
                <td>
                  <div className="font-semibold text-[var(--slate-800)]">{template.name}</div>
                </td>
                <td className="text-[var(--slate-600)]">
                  {template.description?.trim() || "-"}
                </td>
                <td className="font-mono">{template.itemCount}</td>
                <td>{formatDate(template.createdAt)}</td>
                <td>
                  <TemplateActionMenu
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
