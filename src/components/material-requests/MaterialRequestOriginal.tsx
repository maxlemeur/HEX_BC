"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Maximize2, RotateCcw, RotateCw, Scissors, Trash2 } from "lucide-react";

import { useToast } from "@/components/feedback/toast-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { fetchMaterialRequestFileBlob } from "@/lib/material-requests/client";
import {
  MATERIAL_REQUEST_PICKER_ACCEPT,
  MATERIAL_REQUEST_MAX_FILES,
  MATERIAL_REQUEST_MAX_LINES,
  MATERIAL_REQUEST_SOURCE_TEXT_MAX,
  type MaterialRequestFile,
  type MaterialRequestFileRotation,
} from "@/lib/material-requests/contracts";
import { splitSourceText } from "@/lib/material-requests/source-text";

import { ConfirmButton } from "./cells";
import { checkPhotoSelection, plural } from "./format";
import { photoUploadStepLabel, type PhotoUploadStep } from "./photo-upload";
import type { MaterialRequestEditorApi } from "./useMaterialRequestEditor";

function quarterTurn(rotation: MaterialRequestFileRotation, direction: 1 | -1): MaterialRequestFileRotation {
  return ((rotation + (direction === 1 ? 90 : 270)) % 360) as MaterialRequestFileRotation;
}

type PhotoResource = { fileId: string; url: string | null; error: string | null };

function usePhotoUrl(projectId: string, requestId: string, fileId: string) {
  const [resource, setResource] = useState<PhotoResource | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    let objectUrl: string | undefined;
    fetchMaterialRequestFileBlob(projectId, requestId, fileId, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setResource({ fileId, url: objectUrl, error: null });
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return;
        setResource({
          fileId,
          url: null,
          error: cause instanceof Error ? cause.message : "Impossible d’ouvrir cette photo.",
        });
      });
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, requestId, fileId, attempt]);

  const current = resource?.fileId === fileId ? resource : null;
  return { url: current?.url ?? null, error: current?.error ?? null, retry: () => setAttempt((value) => value + 1) };
}

/**
 * The photo in a square frame: a picture that fits a square still fits it after a quarter turn, so
 * turning never crops the sheet. The stored bytes are not touched; only the angle is saved.
 */
function PhotoFrame({
  url,
  alt,
  rotation,
  className,
}: Readonly<{ url: string; alt: string; rotation: MaterialRequestFileRotation; className?: string }>) {
  return (
    <div className={`relative aspect-square overflow-hidden rounded-lg border border-border bg-surface-subtle ${className ?? "w-full"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- private bytes behind an object URL */}
      <img
        src={url}
        alt={alt}
        className="absolute inset-0 m-auto max-h-full max-w-full object-contain transition-transform duration-150 motion-reduce:transition-none"
        style={{ transform: `rotate(${rotation}deg)` }}
      />
    </div>
  );
}

function Photos({ editor }: Readonly<{ editor: MaterialRequestEditorApi }>) {
  const { data, canWrite } = editor;
  const files = data.files;
  const [index, setIndex] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<PhotoUploadStep | null>(null);
  const sending = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const shownIndex = Math.min(index, Math.max(files.length - 1, 0));
  const file: MaterialRequestFile | undefined = files[shownIndex];

  const add = async (selection: File[]) => {
    // One batch at a time: a second choice made while photos travel is ignored, not queued.
    if (selection.length === 0 || sending.current) return;
    const refusal = checkPhotoSelection(selection, files.length);
    if (refusal) {
      setError(refusal);
      return;
    }
    sending.current = true;
    setError(null);
    setProgress({ step: "preparing", total: selection.length });
    const result = await editor.addFiles(selection, setProgress);
    sending.current = false;
    setProgress(null);
    setError(result.ok ? null : result.message);
    if (result.ok) setIndex(files.length);
  };

  return (
    <div className="space-y-2">
      {file ? (
        <Photo
          key={file.id}
          editor={editor}
          file={file}
          position={shownIndex + 1}
          count={files.length}
          enlarged={enlarged}
          onEnlargedChange={setEnlarged}
          onError={setError}
        />
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center text-sm text-muted-foreground">
          Pas de photo de l’original.
        </p>
      )}
      {files.length > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Photo précédente"
            disabled={shownIndex === 0}
            onClick={() => setIndex(shownIndex - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Photo {shownIndex + 1} sur {files.length}
          </p>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Photo suivante"
            disabled={shownIndex >= files.length - 1}
            onClick={() => setIndex(shownIndex + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      {canWrite ? (
        <>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept={MATERIAL_REQUEST_PICKER_ACCEPT}
            aria-label="Photos à ajouter"
            disabled={progress !== null}
            onChange={(event) => {
              const selection = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void add(selection);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={progress !== null}
            disabled={files.length >= MATERIAL_REQUEST_MAX_FILES}
            onClick={() => picker.current?.click()}
          >
            <ImagePlus aria-hidden="true" />
            Ajouter des photos
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {progress ? photoUploadStepLabel(progress) : null}
          </p>
        </>
      ) : null}
      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function Photo({
  editor,
  file,
  position,
  count,
  enlarged,
  onEnlargedChange,
  onError,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  file: MaterialRequestFile;
  position: number;
  count: number;
  enlarged: boolean;
  onEnlargedChange: (open: boolean) => void;
  onError: (message: string | null) => void;
}>) {
  const { canWrite, projectId, requestId } = editor;
  const photo = usePhotoUrl(projectId, requestId, file.id);
  const alt = `Photo ${position} de la demande : ${file.file_name}`;

  const rotate = async (direction: 1 | -1) => {
    const result = await editor.rotateFile(file.id, quarterTurn(file.rotation, direction));
    onError(result.ok ? null : result.message);
  };

  return (
    <div className="space-y-2">
      {photo.url ? (
        <PhotoFrame url={photo.url} alt={alt} rotation={file.rotation} />
      ) : photo.error ? (
        <div role="alert" className="rounded-lg border border-danger-border bg-danger-subtle px-4 py-6 text-center text-sm text-danger">
          <p>{photo.error}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={photo.retry}>
            Réessayer
          </Button>
        </div>
      ) : (
        <p role="status" className="aspect-square w-full rounded-lg border border-border bg-surface-subtle p-4 text-sm text-muted-foreground">
          Ouverture de la photo {count > 1 ? `${position} ` : ""}…
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => void rotate(-1)}>
              <RotateCcw aria-hidden="true" />
              Tourner à gauche
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void rotate(1)}>
              <RotateCw aria-hidden="true" />
              Tourner à droite
            </Button>
          </>
        ) : null}
        <Button type="button" variant="outline" size="sm" disabled={!photo.url} onClick={() => onEnlargedChange(true)}>
          <Maximize2 aria-hidden="true" />
          Agrandir
        </Button>
        {canWrite ? (
          <ConfirmButton
            label="Retirer la photo"
            confirmLabel="Confirmer le retrait de la photo"
            confirmText="Retirer ?"
            onConfirm={async () => {
              const result = await editor.removeFile(file.id);
              onError(result.ok ? null : result.message);
            }}
          >
            <Trash2 aria-hidden="true" />
            Retirer
          </ConfirmButton>
        ) : null}
      </div>
      <Dialog open={enlarged && Boolean(photo.url)} onOpenChange={onEnlargedChange}>
        <DialogContent size="full" className="items-center">
          <DialogHeader className="self-stretch">
            <DialogTitle>{file.file_name}</DialogTitle>
            <DialogDescription>
              Photo {position} sur {count}, telle que reçue.
            </DialogDescription>
          </DialogHeader>
          {photo.url ? (
            <PhotoFrame url={photo.url} alt={alt} rotation={file.rotation} className="w-[min(78dvh,100%)]" />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Where the splitting cuts the message, said where the office reads or corrects it. */
const SPLIT_RULE =
  "Le découpage propose une ligne par article : il coupe à chaque retour à la ligne, à un tiret entre deux espaces, et à une virgule ou un point-virgule suivi d’une quantité (« 50 coudes DN50, 10 manchons DN15 »).";

/**
 * The pasted message, shown as it was received; cutting it into lines only proposes drafts. Once corrected, it is
 * cut again in one gesture, in place of the lines, as long as they are all drafts no quote holds (TI-691): the office
 * no longer deletes them one by one, and never loses a validated or quoted line to a split.
 */
function SourceText({ editor }: Readonly<{ editor: MaterialRequestEditorApi }>) {
  const toast = useToast();
  const textId = useId();
  const ruleId = useId();
  const { data, canWrite } = editor;
  const sourceText = data.request.source_text;
  const lines = data.lines;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the message held more lines than a request accepts: what was read, what was created. */
  const [overflow, setOverflow] = useState<{ read: number; created: number } | null>(null);
  /** The office asked to cut the message again: the replacement waits for its confirmation. */
  const [confirming, setConfirming] = useState(false);
  /** The message was saved while the request had lines: they do not follow it by themselves. */
  const [savedOverLines, setSavedOverLines] = useState(false);
  /** The confirmation that held the focus is gone: the focus goes back to « Redécouper le message ». */
  const [refocus, setRefocus] = useState(false);
  const resplitButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!refocus) return;
    setRefocus(false);
    resplitButton.current?.focus();
  }, [refocus]);
  // A validated line, or one a retained quote prices, is never replaced (the server also refuses a line asked in a
  // quote, which this screen does not know).
  const kept = lines.filter((line) => line.status !== "draft" || line.price_quote_id !== null).length;
  const replaceable = lines.length > 0 && kept === 0;

  const split = async (replace: boolean) => {
    if (!sourceText) return;
    const read = splitSourceText(sourceText);
    const drafts = read.slice(0, MATERIAL_REQUEST_MAX_LINES);
    if (drafts.length === 0) {
      setConfirming(false);
      setError("Aucune ligne lisible dans ce message : ajoutez les lignes à la main.");
      return;
    }
    const replaced = lines.length;
    setBusy(true);
    const result = replace ? await editor.replaceLines(drafts) : await editor.addLines(drafts);
    setBusy(false);
    setConfirming(false);
    if (replace) setRefocus(true);
    setError(result.ok ? null : result.message);
    if (result.ok) {
      setSavedOverLines(false);
      // The button disappears with the first line: what was left out must be said and must stay on screen.
      setOverflow(read.length > drafts.length ? { read: read.length, created: drafts.length } : null);
      const doubtful = drafts.filter((line) => line.quantity_doubtful).length;
      toast.success({
        title: replace
          ? `${plural(drafts.length, "ligne", "lignes")} en brouillon, à la place ${replaced > 1 ? `des ${replaced} précédentes` : "de la précédente"}`
          : `${plural(drafts.length, "ligne créée", "lignes créées")} en brouillon`,
        description:
          doubtful > 0
            ? `Relisez chaque ligne avant de valider : ${plural(doubtful, "quantité est", "quantités sont")} à vérifier sur l’original.`
            : "Relisez chaque ligne avant de valider.",
      });
    }
  };

  const save = async () => {
    if (draft === null) return;
    setBusy(true);
    const result = await editor.updateRequest({ source_text: draft.trim() ? draft : null });
    setBusy(false);
    setError(result.ok ? null : result.message);
    if (result.ok) {
      setDraft(null);
      setSavedOverLines(lines.length > 0 && Boolean(draft.trim()));
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Message reçu</h3>
      {draft !== null ? (
        <>
          <label htmlFor={textId} className="sr-only">
            Message reçu, tel quel
          </label>
          <Textarea
            id={textId}
            className="min-h-32 px-3 py-2 text-sm"
            value={draft}
            maxLength={MATERIAL_REQUEST_SOURCE_TEXT_MAX}
            placeholder="Collez ici le SMS ou le message du technicien, sans le corriger."
            aria-describedby={ruleId}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <p id={ruleId} className="text-xs text-muted-foreground">
            {SPLIT_RULE}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" loading={busy} onClick={() => void save()}>
              Enregistrer le message
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Annuler
            </Button>
          </div>
        </>
      ) : sourceText ? (
        // A long message scrolls in place, so that the lines stay close under it.
        <p
          tabIndex={0}
          role="group"
          aria-label="Texte du message reçu"
          className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-subtle px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {sourceText}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Pas de message collé.</p>
      )}
      {canWrite && draft === null ? (
        <div className="flex flex-wrap gap-2">
          {sourceText && lines.length === 0 ? (
            <Button type="button" size="sm" loading={busy} aria-describedby={ruleId} onClick={() => void split(false)}>
              <Scissors aria-hidden="true" />
              Découper le texte en lignes
            </Button>
          ) : null}
          {sourceText && replaceable && !confirming ? (
            <Button ref={resplitButton} type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
              <Scissors aria-hidden="true" />
              Redécouper le message
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirming(false);
              setSavedOverLines(false);
              setDraft(sourceText ?? "");
            }}
          >
            {sourceText ? "Modifier le message" : "Coller un message"}
          </Button>
        </div>
      ) : null}
      {canWrite && draft === null && sourceText && lines.length === 0 ? (
        <p id={ruleId} className="text-xs text-muted-foreground">
          {SPLIT_RULE}
        </p>
      ) : null}
      {canWrite && draft === null && savedOverLines && !confirming ? (
        <p role="status" className="text-sm text-foreground">
          {replaceable
            ? "Message enregistré. Les lignes ne suivent pas d’elles-mêmes : redécoupez le message pour les remplacer."
            : `Message enregistré. Les lignes ne sont pas redécoupées : ${plural(kept, "ligne est validée ou chiffrée par un devis", "lignes sont validées ou chiffrées par un devis")}. Corrigez les lignes dans le tableau.`}
        </p>
      ) : null}
      {confirming ? (
        <Alert variant="warning">
          <AlertDescription>
            <p>
              {lines.length > 1
                ? `Les ${lines.length} lignes en brouillon seront remplacées par celles lues dans le message, avec ce qui y a été saisi : articles, fournisseurs, corrections.`
                : "La ligne en brouillon sera remplacée par celles lues dans le message, avec ce qui y a été saisi : article, fournisseur, corrections."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {/* The trigger leaves with the click: the choice takes the focus, so a keyboard user lands on it. */}
              <Button type="button" variant="danger" size="sm" loading={busy} autoFocus onClick={() => void split(true)}>
                {lines.length > 1 ? `Remplacer les ${lines.length} lignes` : "Remplacer la ligne"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setRefocus(true);
                }}
              >
                Annuler
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {overflow ? (
        <Alert variant="warning">
          <AlertDescription>
            <p>
              {overflow.read} lignes lues dans ce message, {overflow.created} créées en brouillon : une demande en
              compte {MATERIAL_REQUEST_MAX_LINES} au plus.{" "}
              {overflow.read - overflow.created > 1
                ? `Les ${overflow.read - overflow.created} dernières sont à reprendre à la main`
                : "La dernière est à reprendre à la main"}
              , à partir du message qui reste affiché ci-dessus.
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setOverflow(null)}>
              Compris
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** What the technician sent, kept beside the lines while the office rewrites it. */
export function MaterialRequestOriginal({
  editor,
  headingId,
}: Readonly<{ editor: MaterialRequestEditorApi; headingId: string }>) {
  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <h2 id={headingId} className="typo-h3 text-foreground">
        Original
      </h2>
      {/* Side by side where the width allows: the photo keeps a readable size, the message the rest. */}
      <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:gap-6">
        <Photos editor={editor} />
        <SourceText editor={editor} />
      </div>
    </section>
  );
}
