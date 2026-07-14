"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import type {
  EstimateAssemblyDetail,
  EstimateAssemblySummary,
} from "@/lib/estimates/client";

type AssemblyLibraryTableProps = {
  assemblies: EstimateAssemblySummary[];
  busyAssemblyId: string | null;
  onEdit: (assembly: EstimateAssemblySummary) => void;
  onRename: (assembly: EstimateAssemblySummary) => void;
  onDuplicate: (assembly: EstimateAssemblySummary) => void;
  onDelete: (assembly: EstimateAssemblySummary) => void;
  loadAssembly: (assemblyId: string) => Promise<EstimateAssemblyDetail>;
};

function formatDate(dateIso: string) {
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return "-";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatNumber(value: number | null | undefined, fallback = "-") {
  if (value === null || value === undefined) return fallback;
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatLineCount(count: number) {
  return count + " " + (count === 1 ? "ligne" : "lignes");
}

function formatLegacyGeneratedText(value: string) {
  return value
    .replace(
      /^Ouvrage compose genere depuis /,
      "Ouvrage composé généré depuis ",
    )
    .replace(/^Main d'oeuvre - /, "Main-d’œuvre – ")
    .replace(/^Materiel de pose - /, "Matériel de pose – ");
}

type AssemblyContentPreviewProps = {
  assembly: EstimateAssemblySummary;
  detail: EstimateAssemblyDetail | undefined;
  isLoading: boolean;
  error: string | undefined;
  onRetry: () => void;
};

function AssemblyContentPreview({
  assembly,
  detail,
  isLoading,
  error,
  onRetry,
}: AssemblyContentPreviewProps) {
  return (
    <div className="ml-9">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
          Contenu de l&apos;assemblage
        </p>
        <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-[var(--slate-600)] shadow-sm">
          {formatLineCount(detail?.items.length ?? assembly.itemCount)}
        </span>
      </div>

      {isLoading ? (
        <div
          className="rounded-lg border border-[var(--slate-200)] bg-surface px-4 py-5 text-sm text-[var(--slate-500)]"
          role="status"
        >
          Chargement du contenu…
        </div>
      ) : error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onRetry}
          >
            Réessayer
          </button>
        </div>
      ) : detail?.items.length ? (
        <div className="overflow-x-auto rounded-lg border border-[var(--slate-200)] bg-surface">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="bg-[var(--slate-50)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                <th className="px-4 py-2.5">Position</th>
                <th className="px-4 py-2.5">Désignation</th>
                <th className="px-4 py-2.5">Unité</th>
                <th className="px-4 py-2.5">K FO</th>
                <th className="px-4 py-2.5">K MO</th>
                <th className="px-4 py-2.5">Qté par défaut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--slate-100)]">
              {[...detail.items]
                .sort((first, second) => first.position - second.position)
                .map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 font-mono text-[var(--slate-500)]">
                      {item.position}
                    </td>
                    <td className="px-4 py-3 font-medium text-[var(--slate-800)]">
                      {formatLegacyGeneratedText(item.title)}
                    </td>
                    <td className="px-4 py-3">{item.unit?.trim() || "-"}</td>
                    <td className="px-4 py-3 font-mono">
                      {formatNumber(item.k_fo, "1")}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {formatNumber(item.k_mo, "1")}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {formatNumber(item.default_quantity)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--slate-300)] bg-surface px-4 py-5 text-sm text-[var(--slate-500)]">
          Cet assemblage ne contient aucune ligne.
        </div>
      )}
    </div>
  );
}

export function AssemblyLibraryTable({
  assemblies,
  busyAssemblyId,
  onEdit,
  onRename,
  onDuplicate,
  onDelete,
  loadAssembly,
}: AssemblyLibraryTableProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [detailById, setDetailById] = useState<
    Record<string, EstimateAssemblyDetail>
  >({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [loadErrorById, setLoadErrorById] = useState<Record<string, string>>(
    {},
  );
  const loadingIdsRef = useRef<Set<string>>(new Set());

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

  async function loadAssemblyDetail(assemblyId: string) {
    if (loadingIdsRef.current.has(assemblyId)) return;

    loadingIdsRef.current.add(assemblyId);
    setLoadingIds((previous) => new Set(previous).add(assemblyId));
    setLoadErrorById((previous) => {
      const next = { ...previous };
      delete next[assemblyId];
      return next;
    });

    try {
      const detail = await loadAssembly(assemblyId);
      setDetailById((previous) => ({
        ...previous,
        [assemblyId]: detail,
      }));
    } catch (error) {
      setLoadErrorById((previous) => ({
        ...previous,
        [assemblyId]:
          error instanceof Error
            ? error.message
            : "Impossible de charger le contenu de l'assemblage.",
      }));
    } finally {
      loadingIdsRef.current.delete(assemblyId);
      setLoadingIds((previous) => {
        const next = new Set(previous);
        next.delete(assemblyId);
        return next;
      });
    }
  }

  function toggleAssembly(assembly: EstimateAssemblySummary) {
    const shouldExpand = !expandedIds.has(assembly.id);

    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (shouldExpand) next.add(assembly.id);
      else next.delete(assembly.id);
      return next;
    });

    if (shouldExpand && !detailById[assembly.id]) {
      void loadAssemblyDetail(assembly.id);
    }
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Description</th>
            <th>Lignes</th>
            <th>Créé le</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {assemblies.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="py-10 text-center text-[var(--slate-500)]"
              >
                Aucun assemblage disponible.
              </td>
            </tr>
          ) : (
            assemblies.map((assembly) => {
              const isBusy = busyAssemblyId === assembly.id;
              const isExpanded = expandedIds.has(assembly.id);
              const detail = detailById[assembly.id];
              const isLoadingDetail = loadingIds.has(assembly.id);
              const loadError = loadErrorById[assembly.id];
              const previewId = "assembly-preview-" + assembly.id;
              return (
                <Fragment key={assembly.id}>
                  <tr>
                    <td>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--slate-400)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-700)]"
                          onClick={() => toggleAssembly(assembly)}
                          aria-controls={previewId}
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded
                              ? "Masquer le contenu de " + assembly.name
                              : "Afficher le contenu de " + assembly.name
                          }
                        >
                          <span aria-hidden="true">
                            {isExpanded ? "\u25BC" : "\u25B6"}
                          </span>
                        </button>
                        <div className="font-semibold text-[var(--slate-800)]">
                          {assembly.name}
                        </div>
                      </div>
                    </td>
                    <td className="text-[var(--slate-600)]">
                      {assembly.description?.trim()
                        ? formatLegacyGeneratedText(assembly.description.trim())
                        : "-"}
                    </td>
                    <td className="font-mono">{assembly.itemCount}</td>
                    <td>{formatDate(assembly.createdAt)}</td>
                    <td>
                      <div
                        className="relative"
                        ref={openMenuId === assembly.id ? menuRef : undefined}
                      >
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm px-2"
                          disabled={isBusy}
                          onClick={() =>
                            setOpenMenuId(
                              openMenuId === assembly.id ? null : assembly.id,
                            )
                          }
                          aria-label="Actions"
                        >
                          &middot;&middot;&middot;
                        </button>
                        {openMenuId === assembly.id && (
                          <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-xl border border-[var(--slate-200)] bg-surface py-1 shadow-xl">
                            <button
                              type="button"
                              className="w-full px-4 py-2 text-left text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)]"
                              onClick={() => {
                                setOpenMenuId(null);
                                onEdit(assembly);
                              }}
                            >
                              Éditer
                            </button>
                            <button
                              type="button"
                              className="w-full px-4 py-2 text-left text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)]"
                              onClick={() => {
                                setOpenMenuId(null);
                                onRename(assembly);
                              }}
                            >
                              Renommer
                            </button>
                            <button
                              type="button"
                              className="w-full px-4 py-2 text-left text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)]"
                              onClick={() => {
                                setOpenMenuId(null);
                                onDuplicate(assembly);
                              }}
                            >
                              Dupliquer
                            </button>
                            <div className="my-1 border-t border-[var(--slate-200)]" />
                            <button
                              type="button"
                              className="w-full px-4 py-2 text-left text-sm text-danger hover:bg-error-light"
                              onClick={() => {
                                setOpenMenuId(null);
                                onDelete(assembly);
                              }}
                            >
                              Supprimer
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr id={previewId} className="bg-[var(--slate-50)]">
                      <td colSpan={5} className="!px-6 !py-4">
                        <AssemblyContentPreview
                          assembly={assembly}
                          detail={detail}
                          isLoading={isLoadingDetail}
                          error={loadError}
                          onRetry={() => void loadAssemblyDetail(assembly.id)}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
