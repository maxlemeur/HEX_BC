"use client";

import type { EstimateAssemblySummary } from "@/lib/estimates/client";

type AssemblyLibraryTableProps = {
  assemblies: EstimateAssemblySummary[];
  busyAssemblyId: string | null;
  onEdit: (assembly: EstimateAssemblySummary) => void;
  onRename: (assembly: EstimateAssemblySummary) => void;
  onDuplicate: (assembly: EstimateAssemblySummary) => void;
  onDelete: (assembly: EstimateAssemblySummary) => void;
};

function formatDate(dateIso: string) {
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return "-";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

export function AssemblyLibraryTable({
  assemblies,
  busyAssemblyId,
  onEdit,
  onRename,
  onDuplicate,
  onDelete,
}: AssemblyLibraryTableProps) {
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
          {assemblies.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-10 text-center text-[var(--slate-500)]">
                Aucun assemblage disponible.
              </td>
            </tr>
          ) : (
            assemblies.map((assembly) => {
              const isBusy = busyAssemblyId === assembly.id;
              return (
                <tr key={assembly.id}>
                  <td>
                    <div className="font-semibold text-[var(--slate-800)]">
                      {assembly.name}
                    </div>
                  </td>
                  <td className="text-[var(--slate-600)]">
                    {assembly.description?.trim() || "-"}
                  </td>
                  <td className="font-mono">{assembly.itemCount}</td>
                  <td>{formatDate(assembly.createdAt)}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={isBusy}
                        onClick={() => onEdit(assembly)}
                      >
                        Editer
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={isBusy}
                        onClick={() => onRename(assembly)}
                      >
                        Renommer
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={isBusy}
                        onClick={() => onDuplicate(assembly)}
                      >
                        Dupliquer
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={isBusy}
                        onClick={() => onDelete(assembly)}
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
