"use client";

import { useCallback, useMemo, useState } from "react";
import { PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import useSWR from "swr";

import {
  AssemblyEditorDialog,
  type AssemblyEditorInput,
} from "@/components/estimates/AssemblyEditorDialog";
import { AssemblyLibraryTable } from "@/components/estimates/AssemblyLibraryTable";
import { LibraryNameDialog } from "@/components/estimates/LibraryNameDialog";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  const confirm = useConfirm();
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

  const handleDelete = useCallback(
    async (assembly: EstimateAssemblySummary) => {
      const confirmed = await confirm({
        title: "Supprimer l'ouvrage ?",
        description: `L'ouvrage « ${assembly.name} » sera supprimé définitivement.`,
        confirmLabel: "Supprimer",
        tone: "danger",
      });
      if (!confirmed) return;

      setActionError(null);
      setSuccessMessage(null);
      setBusyAssemblyId(assembly.id);
      try {
        await deleteEstimateAssembly(assembly.id);
        setSuccessMessage("Ouvrage supprimé.");
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de supprimer l'ouvrage."
        );
      } finally {
        setBusyAssemblyId(null);
      }
    },
    [confirm, mutate]
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Bibliothèque d'ouvrages"
        description="Créez et réutilisez des groupes de lignes préconfigurés dans vos chiffrages."
        actions={
          <Button
            variant="primary"
            size="md"
            onClick={openCreateModal}
            leftIcon={<PlusIcon aria-hidden="true" />}
          >
            Nouvel ouvrage
          </Button>
        }
      />

      <div className="mb-6 flex flex-col gap-3 empty:hidden">
        {actionError ? <Alert variant="danger">{actionError}</Alert> : null}
        {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}
        {loadError ? <Alert variant="danger">{loadError.message}</Alert> : null}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border-subtle px-4 py-4 sm:px-6">
          <div className="w-full max-w-md">
            <FieldLabel htmlFor="assembly-search" className="mb-1.5">
              Rechercher
            </FieldLabel>
            <div className="relative">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="assembly-search"
                type="search"
                className="pl-9"
                placeholder="Nom ou description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <Button
            variant="outline"
            size="md"
            onClick={() => void mutate()}
            loading={isValidating}
            leftIcon={<RefreshCwIcon aria-hidden="true" />}
          >
            Actualiser
          </Button>
        </div>

        {isLoading ? (
          <LoadingState label="Chargement des ouvrages…" />
        ) : (
          <AssemblyLibraryTable
            assemblies={assemblies}
            laborRoles={laborRoles}
            refreshedAssemblies={refreshedAssemblies}
            busyAssemblyId={busyAssemblyId}
            onEdit={handleEdit}
            onRename={handleRename}
            onDuplicate={handleDuplicate}
            onDelete={(assembly) => void handleDelete(assembly)}
            loadAssembly={fetchEstimateAssembly}
          />
        )}
      </Card>

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

      <LibraryNameDialog
        open={renamingAssembly !== null}
        title="Renommer l'ouvrage"
        label="Nouveau nom"
        defaultValue={renamingAssembly?.name ?? ""}
        confirmLabel="Renommer"
        onConfirm={(value) => void confirmRename(value)}
        onCancel={() => setRenamingAssembly(null)}
      />
      <LibraryNameDialog
        open={duplicatingAssembly !== null}
        title="Dupliquer l'ouvrage"
        label="Nom de la copie"
        defaultValue={duplicatingAssembly ? `${duplicatingAssembly.name} (copie)` : ""}
        confirmLabel="Dupliquer"
        onConfirm={(value) => void confirmDuplicate(value)}
        onCancel={() => setDuplicatingAssembly(null)}
      />
    </div>
  );
}
