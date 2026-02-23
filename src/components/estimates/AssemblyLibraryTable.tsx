"use client";

import { useState, useRef, useEffect } from "react";
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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openMenuId]);

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
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-[var(--slate-400)] hover:text-[var(--slate-600)]"
                        onClick={() => {
                          setExpandedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(assembly.id)) next.delete(assembly.id);
                            else next.add(assembly.id);
                            return next;
                          });
                        }}
                        aria-label={expandedIds.has(assembly.id) ? "Reduire" : "Developper"}
                      >
                        {expandedIds.has(assembly.id) ? "\u25BC" : "\u25B6"}
                      </button>
                      <div className="font-semibold text-[var(--slate-800)]">{assembly.name}</div>
                    </div>
                    {expandedIds.has(assembly.id) && (
                      <div className="mt-2 rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] p-2 text-xs text-[var(--slate-600)]">
                        {assembly.itemCount > 0
                          ? `${assembly.itemCount} ligne(s) dans cet assemblage`
                          : "Aucune ligne"}
                      </div>
                    )}
                  </td>
                  <td className="text-[var(--slate-600)]">
                    {assembly.description?.trim() || "-"}
                  </td>
                  <td className="font-mono">{assembly.itemCount}</td>
                  <td>{formatDate(assembly.createdAt)}</td>
                  <td>
                    <div className="relative" ref={openMenuId === assembly.id ? menuRef : undefined}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm px-2"
                        disabled={isBusy}
                        onClick={() => setOpenMenuId(openMenuId === assembly.id ? null : assembly.id)}
                        aria-label="Actions"
                      >
                        &middot;&middot;&middot;
                      </button>
                      {openMenuId === assembly.id && (
                        <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-xl border border-[var(--slate-200)] bg-white py-1 shadow-xl">
                          <button
                            type="button"
                            className="w-full px-4 py-2 text-left text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)]"
                            onClick={() => { setOpenMenuId(null); onEdit(assembly); }}
                          >
                            Editer
                          </button>
                          <button
                            type="button"
                            className="w-full px-4 py-2 text-left text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)]"
                            onClick={() => { setOpenMenuId(null); onRename(assembly); }}
                          >
                            Renommer
                          </button>
                          <button
                            type="button"
                            className="w-full px-4 py-2 text-left text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)]"
                            onClick={() => { setOpenMenuId(null); onDuplicate(assembly); }}
                          >
                            Dupliquer
                          </button>
                          <div className="my-1 border-t border-[var(--slate-200)]" />
                          <button
                            type="button"
                            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                            onClick={() => { setOpenMenuId(null); onDelete(assembly); }}
                          >
                            Supprimer
                          </button>
                        </div>
                      )}
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
