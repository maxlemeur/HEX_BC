"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

import { TemplateLibraryTable } from "@/components/estimates/TemplateLibraryTable";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { PromptModal } from "@/components/ui/PromptModal";
import {
  deleteEstimateTemplate,
  duplicateEstimateTemplate,
  fetchEstimateTemplates,
  updateEstimateTemplate,
  type EstimateTemplateSummary,
} from "@/lib/estimates/client";

export default function EstimateTemplatesPage() {
  const [search, setSearch] = useState("");
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [renamingTemplate, setRenamingTemplate] = useState<{ id: string; name: string } | null>(null);
  const [duplicatingTemplate, setDuplicatingTemplate] = useState<{ id: string; name: string } | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<{ id: string; name: string } | null>(null);

  const swrKey = useMemo(
    () => ["estimate-templates", search.trim().toLowerCase()],
    [search]
  );

  const fetcher = useCallback(async () => {
    return fetchEstimateTemplates({
      search: search.trim() || undefined,
      limit: 100,
      order: "recent",
    });
  }, [search]);

  const {
    data: templates = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<EstimateTemplateSummary[]>(swrKey, fetcher, {
    revalidateOnFocus: true,
  });

  const handleRename = useCallback((template: EstimateTemplateSummary) => {
    setRenamingTemplate({ id: template.id, name: template.name });
  }, []);

  const confirmRename = useCallback(
    async (nextName: string) => {
      if (!renamingTemplate || nextName === renamingTemplate.name) {
        setRenamingTemplate(null);
        return;
      }
      setActionError(null);
      setSuccessMessage(null);
      setBusyTemplateId(renamingTemplate.id);
      setRenamingTemplate(null);
      try {
        await updateEstimateTemplate(renamingTemplate.id, { name: nextName });
        setSuccessMessage("Template renomme.");
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de renommer le template."
        );
      } finally {
        setBusyTemplateId(null);
      }
    },
    [renamingTemplate, mutate]
  );

  const handleDuplicate = useCallback((template: EstimateTemplateSummary) => {
    setDuplicatingTemplate({ id: template.id, name: template.name });
  }, []);

  const confirmDuplicate = useCallback(
    async (duplicateName: string) => {
      if (!duplicatingTemplate) return;
      setActionError(null);
      setSuccessMessage(null);
      setBusyTemplateId(duplicatingTemplate.id);
      setDuplicatingTemplate(null);
      try {
        await duplicateEstimateTemplate(duplicatingTemplate.id, { name: duplicateName });
        setSuccessMessage("Template duplique.");
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de dupliquer le template."
        );
      } finally {
        setBusyTemplateId(null);
      }
    },
    [duplicatingTemplate, mutate]
  );

  const handleDelete = useCallback((template: EstimateTemplateSummary) => {
    setDeletingTemplate({ id: template.id, name: template.name });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deletingTemplate) return;
    setActionError(null);
    setSuccessMessage(null);
    setBusyTemplateId(deletingTemplate.id);
    setDeletingTemplate(null);
    try {
      await deleteEstimateTemplate(deletingTemplate.id);
      setSuccessMessage("Template supprime.");
      await mutate();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible de supprimer le template."
      );
    } finally {
      setBusyTemplateId(null);
    }
  }, [deletingTemplate, mutate]);

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Templates de chiffrage</h1>
          <p className="page-description">
            Bibliotheque des modeles reutilisables de votre tenant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link className="btn btn-secondary btn-sm" href="/dashboard/estimates/new">
            Nouveau chiffrage
          </Link>
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
            <label className="form-label" htmlFor="template-search">
              Rechercher
            </label>
            <input
              id="template-search"
              className="form-input"
              placeholder="Nom ou description"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => void mutate()} disabled={isValidating}>
            {isValidating ? "Actualisation..." : "Actualiser"}
          </button>
        </div>

        {isLoading ? (
          <div className="px-6 py-8 text-sm text-[var(--slate-500)]">Chargement des templates...</div>
        ) : (
          <TemplateLibraryTable
            templates={templates}
            busyTemplateId={busyTemplateId}
            onRename={handleRename}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
          />
        )}
      </div>

      <PromptModal
        open={renamingTemplate !== null}
        title="Renommer le template"
        label="Nouveau nom"
        defaultValue={renamingTemplate?.name ?? ""}
        confirmLabel="Renommer"
        onConfirm={confirmRename}
        onCancel={() => setRenamingTemplate(null)}
      />
      <PromptModal
        open={duplicatingTemplate !== null}
        title="Dupliquer le template"
        label="Nom de la copie"
        defaultValue={duplicatingTemplate ? `${duplicatingTemplate.name} (copie)` : ""}
        confirmLabel="Dupliquer"
        onConfirm={confirmDuplicate}
        onCancel={() => setDuplicatingTemplate(null)}
      />
      <ConfirmModal
        open={deletingTemplate !== null}
        title="Supprimer le template"
        message={`Supprimer le template "${deletingTemplate?.name ?? ""}" ? Cette action est irreversible.`}
        confirmLabel="Supprimer"
        variant="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeletingTemplate(null)}
      />
    </div>
  );
}
