"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImagePlus, UserPlus, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  createMaterialRequest,
  createMaterialRequestTechnician,
  materialRequestErrorMessage,
} from "@/lib/material-requests/client";
import {
  MATERIAL_REQUEST_FILE_MIME_TYPES,
  MATERIAL_REQUEST_SOURCE_TEXT_MAX,
  type CreateMaterialRequestInput,
  type MaterialRequestTechnician,
} from "@/lib/material-requests/contracts";
import { cn } from "@/lib/utils";

import { checkPhotoSelection, materialRequestHref } from "./format";
import { photoUploadStepLabel, uploadMaterialRequestPhotos, type PhotoUploadStep } from "./photo-upload";

const LABEL = "mb-1 block text-sm font-medium text-foreground";

/**
 * A new request starts from who asked, and from the original when the operator has it at hand: the
 * pasted message, the photos of the paper. Nothing else is prefilled; the affaire is the page's.
 */
export function NewMaterialRequestDialog({
  open,
  onOpenChange,
  projectId,
  technicians,
  onTechnicianCreated,
  onRequestCreated,
}: Readonly<{
  /** A request now exists although the dialog did not open it (its photos failed): the list shows it. */
  onRequestCreated: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  technicians: readonly MaterialRequestTechnician[];
  onTechnicianCreated: (technician: MaterialRequestTechnician) => void;
}>) {
  const router = useRouter();
  const ids = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [technicianId, setTechnicianId] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<PhotoUploadStep | null>(null);
  const submitting = useRef(false);
  const leaving = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The request exists but its photos were refused: the operator opens it and adds them there. */
  const [createdWithoutPhotos, setCreatedWithoutPhotos] = useState<{ requestId: string; message: string } | null>(null);
  const active = technicians.filter((technician) => technician.is_active);

  // Leaving the page while the photos are on their way drops what was prepared for them.
  useEffect(() => {
    const controller = new AbortController();
    leaving.current = controller;
    return () => controller.abort();
  }, []);

  const addPhotos = (selection: File[]) => {
    if (selection.length === 0) return;
    const refusal = checkPhotoSelection(selection, photos.length);
    setError(refusal);
    if (!refusal) setPhotos((current) => [...current, ...selection]);
  };

  const addTechnician = async () => {
    const name = newName.trim();
    if (!name) return;
    setSavingName(true);
    try {
      const created = await createMaterialRequestTechnician(name);
      onTechnicianCreated(created);
      setTechnicianId(created.id);
      setAdding(false);
      setNewName("");
      setError(null);
    } catch (cause) {
      setError(materialRequestErrorMessage(cause, "Le technicien n’a pas pu être ajouté."));
    } finally {
      setSavingName(false);
    }
  };

  const create = async () => {
    // One request per press: a second submit while the first one runs is ignored.
    if (!technicianId || submitting.current) return;
    submitting.current = true;
    setCreating(true);
    setError(null);
    const input: CreateMaterialRequestInput = { technician_id: technicianId };
    if (sourceText.trim()) input.source_text = sourceText;
    let requestId: string;
    try {
      requestId = (await createMaterialRequest(projectId, input)).request.id;
    } catch (cause) {
      setError(materialRequestErrorMessage(cause, "La demande n’a pas pu être créée."));
      submitting.current = false;
      setCreating(false);
      return;
    }
    if (photos.length > 0) {
      const result = await uploadMaterialRequestPhotos({
        projectId,
        requestId,
        files: photos,
        onStep: setProgress,
        signal: leaving.current?.signal,
      });
      setProgress(null);
      if (!result.ok) {
        // The request exists: it is not created a second time, the photos are added from its page.
        setCreatedWithoutPhotos({ requestId, message: result.message });
        onRequestCreated();
        setCreating(false);
        return;
      }
    }
    router.push(materialRequestHref(projectId, requestId));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing while the request is being created would hide where its photos are.
        if (!creating) onOpenChange(next);
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Nouvelle demande</DialogTitle>
          <DialogDescription>
            Indiquez qui demande. Le message et les photos peuvent aussi être ajoutés après.
          </DialogDescription>
        </DialogHeader>

        {createdWithoutPhotos ? (
          <>
            <Alert variant="warning" role="alert">
              <AlertDescription>
                <p className="font-semibold">La demande est créée, mais sans ses photos.</p>
                <p>{createdWithoutPhotos.message}</p>
                <p>Ouvrez la demande pour les ajouter.</p>
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Link
                href={materialRequestHref(projectId, createdWithoutPhotos.requestId)}
                className={buttonVariants({ variant: "primary" })}
              >
                Ouvrir la demande
              </Link>
            </DialogFooter>
          </>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div>
              <label htmlFor={`${ids}-technician`} className={LABEL}>
                Technicien
              </label>
              <div className="flex flex-wrap gap-2">
                <NativeSelect
                  id={`${ids}-technician`}
                  size="sm"
                  wrapperClassName="min-w-40 flex-1"
                  value={technicianId}
                  onChange={(event) => setTechnicianId(event.currentTarget.value)}
                >
                  <option value="">Choisir…</option>
                  {active.map((technician) => (
                    <option key={technician.id} value={technician.id}>
                      {technician.name}
                    </option>
                  ))}
                </NativeSelect>
                {adding ? null : (
                  <Button type="button" variant="outline" onClick={() => setAdding(true)}>
                    <UserPlus aria-hidden="true" />
                    Ajouter un technicien
                  </Button>
                )}
              </div>
              {adding ? (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-subtle p-3">
                  <div className="min-w-40 flex-1">
                    <label htmlFor={`${ids}-name`} className="mb-1 block text-xs font-medium text-muted-foreground">
                      Nom du technicien
                    </label>
                    <Input
                      id={`${ids}-name`}
                      size="sm"
                      value={newName}
                      maxLength={120}
                      autoComplete="off"
                      autoFocus
                      onChange={(event) => setNewName(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void addTechnician();
                        }
                      }}
                    />
                  </div>
                  <Button type="button" loading={savingName} disabled={!newName.trim()} onClick={() => void addTechnician()}>
                    Ajouter
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setAdding(false);
                      setNewName("");
                    }}
                  >
                    Annuler
                  </Button>
                </div>
              ) : null}
            </div>

            <div>
              <label htmlFor={`${ids}-text`} className={LABEL}>
                Message reçu <span className="font-normal text-muted-foreground">(facultatif)</span>
              </label>
              <Textarea
                id={`${ids}-text`}
                className="min-h-28 px-3 py-2 text-sm"
                value={sourceText}
                maxLength={MATERIAL_REQUEST_SOURCE_TEXT_MAX}
                placeholder="Collez le SMS ou le message tel quel, sans le corriger."
                onChange={(event) => setSourceText(event.currentTarget.value)}
              />
            </div>

            <div>
              <label htmlFor={`${ids}-photos`} className={LABEL}>
                Photos de l’original <span className="font-normal text-muted-foreground">(facultatif)</span>
              </label>
              <div
                className={cn(
                  "rounded-lg border border-dashed px-3 py-4 text-center transition-colors",
                  dragging ? "border-primary bg-primary/5" : "border-border bg-surface-subtle",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  addPhotos(Array.from(event.dataTransfer.files));
                }}
              >
                <input
                  ref={picker}
                  id={`${ids}-photos`}
                  type="file"
                  multiple
                  hidden
                  accept={MATERIAL_REQUEST_FILE_MIME_TYPES.join(",")}
                  onChange={(event) => {
                    const selection = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    addPhotos(selection);
                  }}
                />
                <p className="text-sm text-muted-foreground">Déposez ici les photos du papier (JPEG, PNG ou WebP).</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={creating}
                  onClick={() => picker.current?.click()}
                >
                  <ImagePlus aria-hidden="true" />
                  Choisir des photos
                </Button>
              </div>
              {photos.length > 0 ? (
                <ul aria-label="Photos choisies" className="mt-2 space-y-1">
                  {photos.map((photo, index) => (
                    <li key={`${photo.name}-${index}`} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{photo.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Retirer ${photo.name}`}
                        disabled={creating}
                        onClick={() => setPhotos((current) => current.filter((_, position) => position !== index))}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {error ? (
              <Alert variant="danger">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <p role="status" className="text-sm text-muted-foreground sm:mr-auto">
                {progress ? photoUploadStepLabel(progress) : creating ? "Création de la demande…" : null}
              </p>
              <Button type="button" variant="ghost" disabled={creating} onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button type="submit" loading={creating} disabled={!technicianId}>
                Créer la demande
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
