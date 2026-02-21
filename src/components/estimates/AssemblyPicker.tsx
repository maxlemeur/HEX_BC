"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import {
  fetchEstimateAssemblies,
  fetchEstimateAssembly,
  type EstimateAssemblyDetail,
  type EstimateAssemblySummary,
} from "@/lib/estimates/client";

type AssemblyPickerProps = {
  isOpen: boolean;
  isReadOnly: boolean;
  anchorItemId: string | null;
  onClose: () => void;
  onInsert: (assemblyId: string) => Promise<void>;
};

function normalizedText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function AssemblyPicker({
  isOpen,
  isReadOnly,
  anchorItemId,
  onClose,
  onInsert,
}: AssemblyPickerProps) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, EstimateAssemblyDetail>>({});
  const [isInserting, setIsInserting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const swrKey = useMemo(() => ["assembly-picker", isOpen], [isOpen]);
  const {
    data: assemblies = [],
    isLoading,
    error: loadError,
  } = useSWR<EstimateAssemblySummary[]>(
    swrKey,
    async () => {
      if (!isOpen) return [];
      return fetchEstimateAssemblies({
        limit: 100,
        order: "recent",
      });
    },
    {
      revalidateOnFocus: false,
    }
  );

  useEffect(() => {
    if (!isOpen) return;
    setSearchInput("");
    setDebouncedSearch("");
    setSelectedAssemblyId(null);
    setActionError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim().toLowerCase());
    }, 300);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isOpen, searchInput]);

  useEffect(() => {
    if (!isOpen || !debouncedSearch) return;

    const candidates = assemblies.filter((assembly) => {
      const name = normalizedText(assembly.name);
      const description = normalizedText(assembly.description);
      if (name.includes(debouncedSearch) || description.includes(debouncedSearch)) {
        return false;
      }
      return !detailById[assembly.id];
    });

    if (candidates.length === 0) return;

    let active = true;
    void Promise.all(
      candidates.map(async (assembly) => {
        try {
          const detail = await fetchEstimateAssembly(assembly.id);
          return [assembly.id, detail] as const;
        } catch {
          return null;
        }
      })
    ).then((entries) => {
      if (!active) return;
      setDetailById((previous) => {
        const next = { ...previous };
        entries.forEach((entry) => {
          if (!entry) return;
          const [assemblyId, detail] = entry;
          next[assemblyId] = detail;
        });
        return next;
      });
    });

    return () => {
      active = false;
    };
  }, [assemblies, debouncedSearch, detailById, isOpen]);

  const filteredAssemblies = useMemo(() => {
    if (!debouncedSearch) return assemblies;

    return assemblies.filter((assembly) => {
      const name = normalizedText(assembly.name);
      const description = normalizedText(assembly.description);
      if (name.includes(debouncedSearch) || description.includes(debouncedSearch)) {
        return true;
      }

      const detail = detailById[assembly.id];
      if (!detail) return false;
      return detail.items.some((item) =>
        normalizedText(item.title).includes(debouncedSearch)
      );
    });
  }, [assemblies, debouncedSearch, detailById]);

  useEffect(() => {
    if (!isOpen) return;
    if (!selectedAssemblyId) return;
    if (detailById[selectedAssemblyId]) return;

    let active = true;
    void fetchEstimateAssembly(selectedAssemblyId)
      .then((detail) => {
        if (!active) return;
        setDetailById((previous) => ({
          ...previous,
          [selectedAssemblyId]: detail,
        }));
      })
      .catch(() => {
        if (!active) return;
        setActionError("Impossible de charger l'aperu de l'assemblage.");
      });

    return () => {
      active = false;
    };
  }, [detailById, isOpen, selectedAssemblyId]);

  const selectedDetail =
    selectedAssemblyId ? detailById[selectedAssemblyId] ?? null : null;

  async function handleInsert() {
    if (!selectedAssemblyId || isInserting) return;
    setActionError(null);
    setIsInserting(true);
    try {
      await onInsert(selectedAssemblyId);
      onClose();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible d'inserer l'assemblage."
      );
    } finally {
      setIsInserting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(2,6,23,0.35)]"
        onClick={onClose}
        aria-label="Fermer le picker assemblages"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[var(--slate-200)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--slate-800)]">Assemblages</h2>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Inserer un groupe de lignes apres la ligne active.
            </p>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              Ancre d'insertion: {anchorItemId ?? "fin de racine"}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Fermer
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[300px_1fr]">
          <div className="border-b border-[var(--slate-200)] md:border-b-0 md:border-r">
            <div className="p-4">
              <label className="form-label" htmlFor="assembly-picker-search">
                Rechercher
              </label>
              <input
                id="assembly-picker-search"
                className="form-input"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Nom ou designation de ligne"
              />
            </div>
            <div className="max-h-[calc(100vh-220px)] overflow-auto px-2 pb-3">
              {isLoading ? (
                <div className="px-3 py-4 text-sm text-[var(--slate-500)]">Chargement...</div>
              ) : loadError ? (
                <div className="px-3 py-4 text-sm text-rose-600">{loadError.message}</div>
              ) : filteredAssemblies.length === 0 ? (
                <div className="px-3 py-4 text-sm text-[var(--slate-500)]">
                  Aucun assemblage.
                </div>
              ) : (
                filteredAssemblies.map((assembly) => (
                  <button
                    key={assembly.id}
                    type="button"
                    className={`mb-2 w-full rounded-lg border px-3 py-2 text-left ${
                      selectedAssemblyId === assembly.id
                        ? "border-[var(--brand-blue)] bg-blue-50"
                        : "border-[var(--slate-200)] bg-white"
                    }`}
                    onClick={() => setSelectedAssemblyId(assembly.id)}
                  >
                    <div className="font-medium text-[var(--slate-800)]">{assembly.name}</div>
                    <div className="text-xs text-[var(--slate-500)]">
                      {assembly.itemCount} ligne(s)
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="flex-1 overflow-auto p-4">
              {!selectedAssemblyId ? (
                <div className="text-sm text-[var(--slate-500)]">
                  Selectionnez un assemblage pour afficher son apercu.
                </div>
              ) : !selectedDetail ? (
                <div className="text-sm text-[var(--slate-500)]">Chargement de l'aperu...</div>
              ) : (
                <div>
                  <h3 className="text-base font-semibold text-[var(--slate-800)]">
                    {selectedDetail.name}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--slate-500)]">
                    {selectedDetail.description?.trim() || "Sans description"}
                  </p>

                  <div className="mt-4 table-scroll rounded-lg border border-[var(--slate-200)]">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Pos.</th>
                          <th>Designation</th>
                          <th>U</th>
                          <th>K FO</th>
                          <th>K MO</th>
                          <th>Qte defaut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDetail.items.map((item) => (
                          <tr key={item.id}>
                            <td className="font-mono">{item.position}</td>
                            <td>{item.title}</td>
                            <td>{item.unit ?? "-"}</td>
                            <td>{item.k_fo ?? 1}</td>
                            <td>{item.k_mo ?? 1}</td>
                            <td>{item.default_quantity ?? 1}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-[var(--slate-200)] p-4">
              {actionError ? <div className="alert alert-error mb-3">{actionError}</div> : null}
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClose}
                  disabled={isInserting}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleInsert()}
                  disabled={!selectedAssemblyId || isInserting || isReadOnly}
                >
                  {isInserting ? "Insertion..." : "Inserer dans l'editeur"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
