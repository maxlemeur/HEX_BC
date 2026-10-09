"use client";

import { useCallback, useMemo, useState } from "react";
import { RefreshCwIcon, SearchIcon } from "lucide-react";
import useSWR from "swr";

import { LibraryNameDialog } from "@/components/estimates/LibraryNameDialog";
import { TemplateLibraryTable } from "@/components/estimates/TemplateLibraryTable";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  deleteEstimateTemplate,
  duplicateEstimateTemplate,
  fetchEstimateTemplates,
  updateEstimateTemplate,
  type EstimateTemplateSummary,
} from "@/lib/estimates/client";

export default function EstimateTemplatesPage() {
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [renamingTemplate, setRenamingTemplate] = useState<{ id: string; name: string } | null>(null);
  const [duplicatingTemplate, setDuplicatingTemplate] = useState<{ id: string; name: string } | null>(null);

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
        setSuccessMessage("Modèle renommé.");
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de renommer le modèle."
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
        setSuccessMessage("Modèle dupliqué.");
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de dupliquer le modèle."
        );
      } finally {
        setBusyTemplateId(null);
      }
    },
    [duplicatingTemplate, mutate]
  );

  const handleDelete = useCallback(
    async (template: EstimateTemplateSummary) => {
      const confirmed = await confirm({
        title: "Supprimer le modèle ?",
        description: `Le modèle « ${template.name} » sera supprimé définitivement.`,
        confirmLabel: "Supprimer",
        tone: "danger",
      });
      if (!confirmed) return;

      setActionError(null);
      setSuccessMessage(null);
      setBusyTemplateId(template.id);
      try {
        await deleteEstimateTemplate(template.id);
        setSuccessMessage("Modèle supprimé.");
        await mutate();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de supprimer le modèle."
        );
      } finally {
        setBusyTemplateId(null);
      }
    },
    [confirm, mutate]
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Modèles de chiffrage"
        description="Bibliothèque des modèles réutilisables de votre organisation. Un modèle s’enregistre depuis une version de chiffrage (« Sauvegarder comme modèle »)."
      />

      <div className="mb-6 flex flex-col gap-3 empty:hidden">
        {actionError ? <Alert variant="danger">{actionError}</Alert> : null}
        {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}
        {loadError ? <Alert variant="danger">{loadError.message}</Alert> : null}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border-subtle px-4 py-4 sm:px-6">
          <div className="w-full max-w-md">
            <FieldLabel htmlFor="template-search" className="mb-1.5">
              Rechercher
            </FieldLabel>
            <div className="relative">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="template-search"
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
          <LoadingState label="Chargement des modèles…" />
        ) : (
          <TemplateLibraryTable
            templates={templates}
            busyTemplateId={busyTemplateId}
            onRename={handleRename}
            onDuplicate={handleDuplicate}
            onDelete={(template) => void handleDelete(template)}
          />
        )}
      </Card>

      <LibraryNameDialog
        open={renamingTemplate !== null}
        title="Renommer le modèle"
        label="Nouveau nom"
        defaultValue={renamingTemplate?.name ?? ""}
        confirmLabel="Renommer"
        onConfirm={(value) => void confirmRename(value)}
        onCancel={() => setRenamingTemplate(null)}
      />
      <LibraryNameDialog
        open={duplicatingTemplate !== null}
        title="Dupliquer le modèle"
        label="Nom de la copie"
        defaultValue={duplicatingTemplate ? `${duplicatingTemplate.name} (copie)` : ""}
        confirmLabel="Dupliquer"
        onConfirm={(value) => void confirmDuplicate(value)}
        onCancel={() => setDuplicatingTemplate(null)}
      />
    </div>
  );
}
