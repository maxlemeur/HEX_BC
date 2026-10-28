"use client";

import Link from "next/link";
import { useCallback, useId, useState } from "react";
import useSWR from "swr";

import { PlanFileCard, formatFileSize } from "@/components/takeoff/PlanFileCard";
import { PlanFileUploadZone } from "@/components/takeoff/PlanFileUploadZone";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  deletePlanFile as apiDeletePlanFile,
  deletePlanSet as apiDeletePlanSet,
  fetchPlanFiles,
  isTakeoffApiError,
} from "@/lib/takeoff/client";
import { resolvePlanSetFlowDescriptor } from "@/lib/takeoff/flow-hierarchy";
import type { PlanFileListItem, PlanSetListItem } from "@/lib/takeoff/types";
import { ChevronRightIcon, PencilIcon, Trash2Icon } from "lucide-react";

type PlanSetCardProps = {
  planSet: PlanSetListItem;
  versionId?: string | null;
  launchHref?: string | null;
  launchLabel?: string;
  deletePlanSetHandler?: (setId: string) => Promise<unknown>;
  onDeleted: (unsynchronizedProjectId?: string) => void;
  onFilesChanged: (unsynchronizedProjectId?: string) => void;
  onUpdated: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toApiErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload)) {
    const nestedError = payload.error;
    if (isRecord(nestedError) && typeof nestedError.message === "string") {
      return nestedError.message;
    }

    if (typeof payload.message === "string") {
      return payload.message;
    }
  }

  return fallback;
}

async function updatePlanSetRequest(input: {
  setId: string;
  name: string;
  description: string | null;
}) {
  const response = await fetch(
    `/api/takeoff/plan-sets/${encodeURIComponent(input.setId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        name: input.name,
        description: input.description,
      }),
    }
  );
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      toApiErrorMessage(payload, "Impossible de mettre à jour le jeu de plans.")
    );
  }
}

const absoluteDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatAbsoluteDate(isoDate: string) {
  return absoluteDateFormatter.format(new Date(isoDate));
}

function formatRelativeTime(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days}j`;
}

export function PlanSetCard({
  planSet,
  versionId,
  launchHref,
  launchLabel,
  deletePlanSetHandler,
  onDeleted,
  onFilesChanged,
  onUpdated,
}: PlanSetCardProps) {
  const flowDescriptor = resolvePlanSetFlowDescriptor(planSet);
  const resolvedLaunchHref =
    launchHref ??
    (versionId
      ? `/dashboard/estimates/${versionId}/takeoff/new?plan_set_id=${planSet.id}`
      : null);
  const resolvedLaunchLabel = launchLabel ?? "Lancer l'extraction";
  const regionId = useId();
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [deletingSet, setDeletingSet] = useState(false);
  const [deleteFileTarget, setDeleteFileTarget] = useState<string | null>(null);
  const [editingSet, setEditingSet] = useState(false);
  const [editName, setEditName] = useState(planSet.name);
  const [editDescription, setEditDescription] = useState(planSet.description ?? "");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingSet, setSavingSet] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const filesSWRKey = expanded ? `plan-files:${planSet.id}` : null;
  const {
    data: files,
    error: filesError,
    mutate: mutateFiles,
  } = useSWR<PlanFileListItem[]>(filesSWRKey, () => fetchPlanFiles(planSet.id), {
    revalidateOnFocus: false,
  });

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleDeleteSet = useCallback(async () => {
    if (deletingSet) return;
    const confirmed = await confirm({
      title: "Supprimer le jeu de plans",
      description: `« ${planSet.name} » et tous ses fichiers seront supprimés. Cette action est irréversible.`,
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!confirmed) return;

    setDeletingSet(true);
    try {
      const deleteSet = deletePlanSetHandler ?? apiDeletePlanSet;
      const result = await deleteSet(planSet.id);
      setAnnouncement(`Jeu « ${planSet.name} » supprimé.`);
      if (isRecord(result) && result.dossier_synchronized === false && planSet.project_id) onDeleted(planSet.project_id);
      else onDeleted();
    } catch (err) {
      const msg = isTakeoffApiError(err)
        ? err.message
        : "Impossible de supprimer le jeu de plans.";
      setAnnouncement(msg);
    } finally {
      setDeletingSet(false);
    }
  }, [confirm, deletePlanSetHandler, deletingSet, planSet.id, planSet.name, planSet.project_id, onDeleted]);

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      if (deleteFileTarget) return;
      const confirmed = await confirm({
        title: "Supprimer le fichier",
        description: "Le fichier sera retiré du jeu de plans. Cette action est irréversible.",
        confirmLabel: "Supprimer",
        tone: "danger",
      });
      if (!confirmed) return;

      setDeleteFileTarget(fileId);
      try {
        const result = await apiDeletePlanFile(planSet.id, fileId);
        setAnnouncement("Fichier supprimé.");
        await mutateFiles();
        if (result.dossier_synchronized === false && planSet.project_id) onFilesChanged(planSet.project_id);
        else onFilesChanged();
      } catch (err) {
        const msg = isTakeoffApiError(err)
          ? err.message
          : "Impossible de supprimer le fichier.";
        setAnnouncement(msg);
      } finally {
        setDeleteFileTarget(null);
      }
    },
    [confirm, deleteFileTarget, planSet.id, planSet.project_id, mutateFiles, onFilesChanged]
  );

  const handleUploadsComplete = useCallback(() => {
    mutateFiles();
    onFilesChanged();
  }, [mutateFiles, onFilesChanged]);

  const handleStartEdit = useCallback(() => {
    setEditName(planSet.name);
    setEditDescription(planSet.description ?? "");
    setEditError(null);
    setEditingSet(true);
    setExpanded(true);
  }, [planSet.name, planSet.description]);

  const handleCancelEdit = useCallback(() => {
    if (savingSet) return;
    setEditingSet(false);
    setEditError(null);
    setEditName(planSet.name);
    setEditDescription(planSet.description ?? "");
  }, [planSet.name, planSet.description, savingSet]);

  const handleSaveEdit = useCallback(async () => {
    const normalizedName = editName.trim();
    if (!normalizedName) {
      setEditError("Le nom du jeu est obligatoire.");
      return;
    }

    setSavingSet(true);
    setEditError(null);
    try {
      await updatePlanSetRequest({
        setId: planSet.id,
        name: normalizedName,
        description: editDescription.trim() || null,
      });
      setEditingSet(false);
      setAnnouncement(`Jeu "${normalizedName}" mis à jour.`);
      onUpdated();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Impossible de mettre à jour le jeu de plans.";
      setEditError(message);
      setAnnouncement(message);
    } finally {
      setSavingSet(false);
    }
  }, [editDescription, editName, onUpdated, planSet.id]);

  return (
    <Card className="overflow-hidden">
      {/* Header row */}
      <div className="flex w-full flex-wrap items-center gap-2 px-4 py-4 sm:flex-nowrap sm:gap-4 sm:px-5">
        {/* Accordion trigger */}
        <button
          type="button"
          className="flex min-w-0 basis-full items-center gap-3 text-left transition hover:opacity-80 sm:basis-auto sm:flex-1 sm:gap-4"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={handleToggle}
        >
          {/* Chevron */}
          <ChevronRightIcon className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden="true" />

          {/* Set info */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="line-clamp-2 text-sm font-semibold text-foreground sm:truncate">
                {planSet.name}
              </h2>
              <Badge size="sm" variant={flowDescriptor.kind === "legacy" ? "warning" : "success"}>
                {flowDescriptor.label}
              </Badge>
              <span className="text-micro text-muted-foreground sm:hidden">
                {planSet.file_count} {planSet.file_count === 1 ? "plan" : "plans"}
              </span>
            </div>
            {planSet.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground sm:truncate">
                {planSet.description}
              </p>
            )}
          </div>

          {/* Compact metadata */}
          <div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground sm:flex">
            <span>
              {planSet.file_count}{" "}
              {planSet.file_count === 1 ? "plan" : "plans"}
            </span>
            {planSet.total_size_bytes > 0 ? (
              <span className="hidden sm:inline">
                {formatFileSize(planSet.total_size_bytes)}
              </span>
            ) : null}
            <span className="hidden md:inline" title={formatRelativeTime(planSet.created_at)}>
              {formatAbsoluteDate(planSet.created_at)}
            </span>
            <span className="hidden sm:inline">
              {formatRelativeTime(planSet.updated_at)}
            </span>
          </div>
        </button>

        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          {/* Edit set button */}
          <IconButton
            label={`Modifier le jeu "${planSet.name}"`}
            icon={<PencilIcon aria-hidden="true" />}
            className="size-11 sm:size-8"
            onClick={handleStartEdit}
          />

          {/* Delete set button */}
          <IconButton
            label={`Supprimer le jeu "${planSet.name}"`}
            icon={<Trash2Icon aria-hidden="true" />}
            className="size-11 hover:text-danger sm:size-8"
            loading={deletingSet}
            onClick={() => void handleDeleteSet()}
          />
        </div>
      </div>

      {/* Body — expanded content */}
      <div
        id={regionId}
        role="region"
        aria-label={`Contenu du jeu "${planSet.name}"`}
        hidden={!expanded}
      >
        {expanded && (
          <div className="border-t border-border px-4 pb-5 pt-4 sm:px-5">
            <div
              className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
                flowDescriptor.kind === "legacy"
                  ? "border-warning-border bg-warning-subtle text-foreground-secondary"
                  : "border-success-border bg-success-subtle text-foreground-secondary"
              }`}
            >
              {flowDescriptor.summary}
            </div>

            {/* Set edit form */}
            {editingSet && (
              <div className="mb-4 rounded-lg border border-border bg-surface-subtle p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <FieldLabel htmlFor={`plan-set-name-${planSet.id}`}>Nom du jeu</FieldLabel>
                    <Input
                      id={`plan-set-name-${planSet.id}`}
                      type="text"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      maxLength={255}
                      disabled={savingSet}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <FieldLabel htmlFor={`plan-set-description-${planSet.id}`}>
                      Description (optionnel)
                    </FieldLabel>
                    <Textarea
                      id={`plan-set-description-${planSet.id}`}
                      className="min-h-20 resize-y"
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                      maxLength={2000}
                      disabled={savingSet}
                    />
                  </div>
                </div>

                {editError && (
                  <Alert variant="danger" className="mt-3">
                    <AlertDescription>{editError}</AlertDescription>
                  </Alert>
                )}

                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCancelEdit}
                    disabled={savingSet}
                  >
                    Annuler
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleSaveEdit}
                    loading={savingSet}
                    disabled={!editName.trim()}
                  >
                    Enregistrer
                  </Button>
                </div>
              </div>
            )}

            {/* Upload zone */}
            <PlanFileUploadZone
              setId={planSet.id}
              onUploadsComplete={handleUploadsComplete}
            />

            {/* Files list */}
            {filesError && (
              <Alert variant="danger" className="mt-4">
                <AlertDescription>
                  {isTakeoffApiError(filesError)
                    ? filesError.message
                    : "Impossible de charger les fichiers."}
                </AlertDescription>
              </Alert>
            )}

            {files && files.length === 0 && !filesError && (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Aucun fichier dans ce jeu. Glissez des PDF ci-dessus.
              </p>
            )}

            {files && files.length > 0 && (
              <div className="mt-4 space-y-2">
                {files.map((file) => (
                  <PlanFileCard
                    key={file.id}
                    file={file}
                    onDelete={handleDeleteFile}
                    deleting={deleteFileTarget === file.id}
                  />
                ))}
              </div>
            )}

            {/* Extraction link */}
            {files && files.length > 0 && resolvedLaunchHref && (
              <div className="mt-4 flex justify-end">
                <Link
                  href={resolvedLaunchHref}
                  className={buttonVariants({ variant: "primary" })}
                >
                  {resolvedLaunchLabel}
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </Card>
  );
}
