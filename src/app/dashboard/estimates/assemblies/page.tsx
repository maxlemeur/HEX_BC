"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

import {
  AssemblyEditorDialog,
  type AssemblyEditorInput,
} from "@/components/estimates/AssemblyEditorDialog";
import { AssemblyLibraryTable } from "@/components/estimates/AssemblyLibraryTable";
import { ConfirmModal } from "@/components/ui-legacy/ConfirmModal";
import { PromptModal } from "@/components/ui-legacy/PromptModal";
import {
  createEstimateAssembly,
  deleteEstimateAssembly,
  duplicateEstimateAssembly,
  fetchEstimateAssemblies,
  fetchEstimateAssemblyOptions,
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
  const [refreshedAssemblies, setRefreshedAssemblies] = useState<
    Record<string, EstimateAssemblyDetail>
  >({});
  const [renamingAssembly, setRenamingAssembly] = useState<{ id: string; name: string } | null>(null);
  const [duplicatingAssembly, setDuplicatingAssembly] = useState<{ id: string; name: string } | null>(null);
  const [deletingAssembly, setDeletingAssembly] = useState<{ id: string; name: string } | null>(null);

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
  const { data: assemblyOptions } = useSWR(
    "estimate-assembly-options",
    fetchEstimateAssemblyOptions,
    { revalidateOnFocus: false }
  );
  const laborRoles = assemblyOptions?.laborRoles ?? [];
  const supplyTypes = assemblyOptions?.supplyTypes ?? [];
  const availableAssemblies = assemblyOptions?.assemblies ?? assemblies;

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
        let savedAssembly: EstimateAssemblyDetail;
        if (editingAssembly) {
          savedAssembly = await updateEstimateAssembly(editingAssembly.id, input);
          setSuccessMessage("Ouvrage mis à jour.");
        } else {
          savedAssembly = await createEstimateAssembly(input);
          setSuccessMessage("Ouvrage créé.");
        }
        setRefreshedAssemblies((previous) => ({
          ...previous,
          [savedAssembly.id]: savedAssembly,
        }));
        setIsModalOpen(false);
        setEditingAssembly(null);
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible d'enregistrer l'ouvrage."
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
        error instanceof Error ? error.message : "Impossible de charger l'ouvrage."
      );
    } finally {
      setBusyAssemblyId(null);
    }
  }, []);

  const handleRename = useCallback((assembly: EstimateAssemblySummary) => {
    setRenamingAssembly({ id: assembly.id, name: assembly.name });
  }, []);

  const confirmRename = useCallback(
    async (nextName: string) => {
      if (!renamingAssembly || nextName === renamingAssembly.name) {
        setRenamingAssembly(null);
        return;
      }
      setActionError(null);
      setSuccessMessage(null);
      setBusyAssemblyId(renamingAssembly.id);
      setRenamingAssembly(null);
      try {
        const renamedAssembly = await updateEstimateAssembly(renamingAssembly.id, {
          name: nextName,
        });
        setRefreshedAssemblies((previous) => ({
          ...previous,
          [renamedAssembly.id]: renamedAssembly,
        }));
        setSuccessMessage("Ouvrage renommé.");
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de renommer l'ouvrage."
        );
      } finally {
        setBusyAssemblyId(null);
      }
    },
    [renamingAssembly, mutate]
  );

  const handleDuplicate = useCallback((assembly: EstimateAssemblySummary) => {
    setDuplicatingAssembly({ id: assembly.id, name: assembly.name });
  }, []);

  const confirmDuplicate = useCallback(
    async (duplicateName: string) => {
      if (!duplicatingAssembly) return;
      setActionError(null);
      setSuccessMessage(null);
      setBusyAssemblyId(duplicatingAssembly.id);
      setDuplicatingAssembly(null);
      try {
        await duplicateEstimateAssembly(duplicatingAssembly.id, { name: duplicateName });
        setSuccessMessage("Ouvrage dupliqué.");
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de dupliquer l'ouvrage."
        );
      } finally {
        setBusyAssemblyId(null);
      }
    },
    [duplicatingAssembly, mutate]
  );

  const handleDelete = useCallback((assembly: EstimateAssemblySummary) => {
    setDeletingAssembly({ id: assembly.id, name: assembly.name });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deletingAssembly) return;
    setActionError(null);
    setSuccessMessage(null);
    setBusyAssemblyId(deletingAssembly.id);
    setDeletingAssembly(null);
    try {
      await deleteEstimateAssembly(deletingAssembly.id);
      setSuccessMessage("Ouvrage supprimé.");
      await mutate();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible de supprimer l'ouvrage."
      );
    } finally {
      setBusyAssemblyId(null);
    }
  }, [deletingAssembly, mutate]);

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Bibliothèque d&apos;ouvrages</h1>
          <p className="page-description">
            Créez et réutilisez des groupes de lignes préconfigurés dans vos chiffrages.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
            Nouvel ouvrage
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
            Chargement des ouvrages...
          </div>
        ) : (
          <AssemblyLibraryTable
            assemblies={assemblies}
            laborRoles={laborRoles}
            refreshedAssemblies={refreshedAssemblies}
            busyAssemblyId={busyAssemblyId}
            onEdit={handleEdit}
            onRename={handleRename}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            loadAssembly={fetchEstimateAssembly}
          />
        )}
      </div>

      {isModalOpen ? (
        <AssemblyEditorDialog
          key={editingAssembly?.id ?? "new-assembly"}
          isSubmitting={isModalSubmitting}
          initialValue={editingAssembly}
          laborRoles={laborRoles}
          supplyTypes={supplyTypes}
          availableAssemblies={availableAssemblies}
          onClose={closeModal}
          onSubmit={handleSubmitModal}
        />
      ) : null}

      <PromptModal
        open={renamingAssembly !== null}
        title="Renommer l'ouvrage"
        label="Nouveau nom"
        defaultValue={renamingAssembly?.name ?? ""}
        confirmLabel="Renommer"
        onConfirm={confirmRename}
        onCancel={() => setRenamingAssembly(null)}
      />
      <PromptModal
        open={duplicatingAssembly !== null}
        title="Dupliquer l'ouvrage"
        label="Nom de la copie"
        defaultValue={duplicatingAssembly ? `${duplicatingAssembly.name} (copie)` : ""}
        confirmLabel="Dupliquer"
        onConfirm={confirmDuplicate}
        onCancel={() => setDuplicatingAssembly(null)}
      />
      <ConfirmModal
        open={deletingAssembly !== null}
        title="Supprimer l'ouvrage"
        message={`Supprimer l'ouvrage "${deletingAssembly?.name ?? ""}" ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        variant="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeletingAssembly(null)}
      />
    </div>
  );
}
