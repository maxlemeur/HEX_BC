"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

import {
  AssemblyEditorModal,
  type AssemblyEditorInput,
} from "@/components/estimates/AssemblyEditorModal";
import { AssemblyLibraryTable } from "@/components/estimates/AssemblyLibraryTable";
import {
  createEstimateAssembly,
  deleteEstimateAssembly,
  duplicateEstimateAssembly,
  fetchEstimateAssemblies,
  fetchEstimateAssembly,
  updateEstimateAssembly,
  type EstimateAssemblyDetail,
  type EstimateAssemblySummary,
} from "@/lib/estimates/client";

export default function EstimateAssembliesPage() {
  const [search, setSearch] = useState("");
  const [busyAssemblyId, setBusyAssemblyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isModalSubmitting, setIsModalSubmitting] = useState(false);
  const [editingAssembly, setEditingAssembly] = useState<EstimateAssemblyDetail | null>(
    null
  );

  const swrKey = useMemo(
    () => ["estimate-assemblies", search.trim().toLowerCase()],
    [search]
  );

  const fetcher = useCallback(async () => {
    return fetchEstimateAssemblies({
      search: search.trim() || undefined,
      limit: 100,
      order: "recent",
    });
  }, [search]);

  const {
    data: assemblies = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<EstimateAssemblySummary[]>(swrKey, fetcher, {
    revalidateOnFocus: true,
  });

  const openCreateModal = useCallback(() => {
    setEditingAssembly(null);
    setActionError(null);
    setSuccessMessage(null);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (isModalSubmitting) return;
    setIsModalOpen(false);
    setEditingAssembly(null);
  }, [isModalSubmitting]);

  const handleSubmitModal = useCallback(
    async (input: AssemblyEditorInput) => {
      setActionError(null);
      setSuccessMessage(null);
      setIsModalSubmitting(true);

      try {
        if (editingAssembly) {
          await updateEstimateAssembly(editingAssembly.id, input);
          setSuccessMessage("Assemblage mis a jour.");
        } else {
          await createEstimateAssembly(input);
          setSuccessMessage("Assemblage cree.");
        }
        setIsModalOpen(false);
        setEditingAssembly(null);
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible d'enregistrer l'assemblage."
        );
      } finally {
        setIsModalSubmitting(false);
      }
    },
    [editingAssembly, mutate]
  );

  const handleEdit = useCallback(async (assembly: EstimateAssemblySummary) => {
    setActionError(null);
    setSuccessMessage(null);
    setBusyAssemblyId(assembly.id);
    try {
      const detail = await fetchEstimateAssembly(assembly.id);
      setEditingAssembly(detail);
      setIsModalOpen(true);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible de charger l'assemblage."
      );
    } finally {
      setBusyAssemblyId(null);
    }
  }, []);

  const handleRename = useCallback(
    async (assembly: EstimateAssemblySummary) => {
      const nextName = window
        .prompt("Nouveau nom de l'assemblage", assembly.name)
        ?.trim();
      if (!nextName || nextName === assembly.name) return;

      setActionError(null);
      setSuccessMessage(null);
      setBusyAssemblyId(assembly.id);
      try {
        await updateEstimateAssembly(assembly.id, { name: nextName });
        setSuccessMessage("Assemblage renomme.");
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de renommer l'assemblage."
        );
      } finally {
        setBusyAssemblyId(null);
      }
    },
    [mutate]
  );

  const handleDuplicate = useCallback(
    async (assembly: EstimateAssemblySummary) => {
      const duplicateName = window
        .prompt("Nom de l'assemblage duplique", `${assembly.name} (copie)`)
        ?.trim();
      if (!duplicateName) return;

      setActionError(null);
      setSuccessMessage(null);
      setBusyAssemblyId(assembly.id);
      try {
        await duplicateEstimateAssembly(assembly.id, { name: duplicateName });
        setSuccessMessage("Assemblage duplique.");
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de dupliquer l'assemblage."
        );
      } finally {
        setBusyAssemblyId(null);
      }
    },
    [mutate]
  );

  const handleDelete = useCallback(
    async (assembly: EstimateAssemblySummary) => {
      const confirmed = window.confirm(
        `Supprimer l'assemblage "${assembly.name}" ? Cette action est irreversible.`
      );
      if (!confirmed) return;

      setActionError(null);
      setSuccessMessage(null);
      setBusyAssemblyId(assembly.id);
      try {
        await deleteEstimateAssembly(assembly.id);
        setSuccessMessage("Assemblage supprime.");
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de supprimer l'assemblage."
        );
      } finally {
        setBusyAssemblyId(null);
      }
    },
    [mutate]
  );

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Assemblages reutilisables</h1>
          <p className="page-description">
            Bibliotheque partagee du tenant pour inserer rapidement des sections preconfigurees.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
            Nouvel assemblage
          </button>
          <Link className="btn btn-secondary btn-sm" href="/dashboard/estimates">
            Retour
          </Link>
        </div>
      </div>

      {actionError ? <div className="alert alert-error mb-6">{actionError}</div> : null}
      {successMessage ? <div className="alert alert-success mb-6">{successMessage}</div> : null}
      {loadError ? <div className="alert alert-error mb-6">{loadError.message}</div> : null}

      <div className="dashboard-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--slate-200)] px-6 py-4">
          <div className="w-full max-w-md">
            <label className="form-label" htmlFor="assembly-search">
              Rechercher
            </label>
            <input
              id="assembly-search"
              className="form-input"
              placeholder="Nom ou description"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void mutate()}
            disabled={isValidating}
          >
            {isValidating ? "Actualisation..." : "Actualiser"}
          </button>
        </div>

        {isLoading ? (
          <div className="px-6 py-8 text-sm text-[var(--slate-500)]">
            Chargement des assemblages...
          </div>
        ) : (
          <AssemblyLibraryTable
            assemblies={assemblies}
            busyAssemblyId={busyAssemblyId}
            onEdit={handleEdit}
            onRename={handleRename}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
          />
        )}
      </div>

      {isModalOpen ? (
        <AssemblyEditorModal
          key={editingAssembly?.id ?? "new-assembly"}
          isSubmitting={isModalSubmitting}
          initialValue={editingAssembly}
          onClose={closeModal}
          onSubmit={handleSubmitModal}
        />
      ) : null}
    </div>
  );
}
