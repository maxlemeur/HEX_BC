"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, ImagePlus, Maximize2, RotateCcw, RotateCw, Scissors, Sparkles, Trash2 } from "lucide-react";

import { loadPhotoAnalysisModelOptions } from "@/app/dashboard/_actions/chatgpt";
import { AiRequestSettings } from "@/components/ai/AiRequestSettings";
import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import type { ChatGptPreferences } from "@/lib/ai/chatgpt-model-preferences";
import { useToast } from "@/components/feedback/toast-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  analyzeMaterialRequestPhoto,
  fetchMaterialRequestFileBlob,
  isPhotoAnalysisNotFound,
  isPhotoAnalysisSkippable,
  isPhotoAnalysisUnavailable,
  materialRequestErrorMessage,
  materialRequestFileUrl,
} from "@/lib/material-requests/client";
import {
  isMaterialRequestPdf,
  MATERIAL_REQUEST_PICKER_ACCEPT,
  MATERIAL_REQUEST_MAX_FILES,
  MATERIAL_REQUEST_MAX_LINES,
  MATERIAL_REQUEST_SOURCE_TEXT_MAX,
  type MaterialRequestFile,
  type MaterialRequestFileRotation,
  type MaterialRequestLineInput,
} from "@/lib/material-requests/contracts";
import {
  MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES,
  MATERIAL_REQUEST_PHOTO_API_CEILING_NANO_USD,
} from "@/lib/material-requests/photo-analysis";
import { splitSourceText } from "@/lib/material-requests/source-text";

import { ConfirmButton } from "./cells";
import { checkPhotoSelection } from "./format";
import { MaterialRequestPdfViewer } from "./MaterialRequestPdfViewer";
import { photoUploadStepLabel, type PhotoUploadStep } from "./photo-upload";
import type { MaterialRequestEditorApi } from "./useMaterialRequestEditor";
import { plural } from "@/lib/text/plural";

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
            aria-label={files.some(isMaterialRequestPdf) ? "Original précédent" : "Photo précédente"}
            disabled={shownIndex === 0}
            onClick={() => setIndex(shownIndex - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {files.some(isMaterialRequestPdf) ? "Original" : "Photo"} {shownIndex + 1} sur {files.length}
          </p>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={files.some(isMaterialRequestPdf) ? "Original suivant" : "Photo suivante"}
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
            Ajouter des photos ou PDF
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {progress ? photoUploadStepLabel(progress) : null}
          </p>
          <PhotoAnalysis key={editor.requestId} editor={editor} />
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

type PhotoAnalysisRun = { step: "reading"; position: number; total: number; isPdf: boolean } | { step: "writing" };

const PROFILE_HREF = "/dashboard/profile";
const MAX_ANALYSIS_MB = MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES / (1024 * 1024);

function formatSkippedOriginals(skipped: ReadonlyArray<{ name: string; reason: string }>): string {
  if (skipped.length === 0) return "";
  const list = skipped.map((entry) => `« ${entry.name} » (${entry.reason})`).join(", ");
  return skipped.length === 1
    ? `Original ignoré : ${list}. À reprendre à la main.`
    : `Originaux ignorés : ${list}. À reprendre à la main.`;
}

function formatRemovedOriginals(names: readonly string[]): string {
  if (names.length === 0) return "";
  const list = names.map((name) => `« ${name} »`).join(", ");
  return names.length === 1
    ? `${list} a été retiré pendant la lecture et n’a pas été repris.`
    : `${list} ont été retirés pendant la lecture et n’ont pas été repris.`;
}

function formatAddedOriginals(files: readonly MaterialRequestFile[]): string {
  if (files.length === 0) return "";
  const list = files.map((entry) => `« ${entry.file_name} »`).join(", ");
  return files.length === 1
    ? `1 original ajouté pendant la lecture (${list}) n’a pas été lu : relancez l’analyse pour l’inclure.`
    : `${files.length} originaux ajoutés pendant la lecture (${list}) n’ont pas été lus : relancez l’analyse pour les inclure.`;
}

/**
 * Each original (photo or PDF) is read in turn with the member’s chosen AI source. The reading becomes draft lines,
 * as the splitting of the pasted message does. It decides nothing: the office reads every line against the original.
 * An original that exceeds 15 MB or cannot be read on its own is skipped so the remaining originals are still read,
 * and named in the notice; an original removed during the reading is excluded; a global failure (quota, disconnected
 * plan, network) stops the batch without creating lines and keeps already-read originals cached.
 */
function PhotoAnalysis({ editor }: Readonly<{ editor: MaterialRequestEditorApi }>) {
  const hintId = useId();
  const { data, projectId, requestId } = editor;
  const availability = data.photoAnalysis ?? null;
  const files = data.files;
  const lines = data.lines;
  const [run, setRun] = useState<PhotoAnalysisRun | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<{ message: string; profile: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof loadPhotoAnalysisModelOptions>> | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const ready = availability?.status === "available";
  const canConfigure = ready && files.length > 0;
  useEffect(() => {
    if (!canConfigure) return;
    let active = true;
    void loadPhotoAnalysisModelOptions().then((result) => {
      if (active) setSettings(result);
    }).catch(() => {
      if (active) setSettingsError(true);
    });
    return () => { active = false; };
  }, [canConfigure, settingsAttempt]);
  /** What each original gave at its angle and reading settings, until lines are created from it. */
  const read = useRef(new Map<string, { fileId: string; lines: MaterialRequestLineInput[] }>());
  const reading = useRef<AbortController | null>(null);
  /** Live list of originals, so a reading that takes minutes sees files added or removed meanwhile. */
  const currentFiles = useRef(files);
  useEffect(() => {
    currentFiles.current = files;
    const liveIds = new Set(files.map((entry) => entry.id));
    for (const [key, entry] of read.current.entries()) {
      if (!liveIds.has(entry.fileId)) read.current.delete(key);
    }
  }, [files]);
  /** How many lines the screen shows now, for the room left under the cap: a reading takes minutes. */
  const shown = useRef(lines.length);
  useEffect(() => {
    shown.current = lines.length;
  }, [lines.length]);
  useEffect(() => () => reading.current?.abort(), []);
  /** The control that held the focus is gone (the choice, « Arrêter »): the focus goes back to the reading's button. */
  const trigger = useRef<HTMLButtonElement>(null);
  const [refocus, setRefocus] = useState(false);
  useEffect(() => {
    if (!refocus) return;
    setRefocus(false);
    trigger.current?.focus();
  }, [refocus]);

  // Nothing is offered where no reading can ever run (an instance without AI), nor without an original to read.
  if (!availability || availability.status === "disabled" || files.length === 0) return null;

  const kept = lines.filter((line) => line.status !== "draft" || line.price_quote_id !== null).length;
  const replaceable = lines.length > 0 && kept === 0;
  const several = files.length > 1;
  const hasPdf = files.some(isMaterialRequestPdf);
  const allPdf = files.every(isMaterialRequestPdf);
  const heavyFiles = files.filter((entry) => entry.byte_size > MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES);
  const readableCount = files.length - heavyFiles.length;
  const analyzeLabel = several
    ? allPdf
      ? "Analyser les PDF avec l’IA"
      : hasPdf
        ? "Analyser les originaux avec l’IA"
        : "Analyser les photos avec l’IA"
    : allPdf
      ? "Analyser le PDF avec l’IA"
      : "Analyser la photo avec l’IA";
  const preferences = settings?.preferences ?? null;

  const changePreferences = (next: ChatGptPreferences) => {
    if (!settings || run || choosing) return;
    const reread = read.current.size > 0;
    read.current.clear();
    setSettings({ ...settings, preferences: next });
    setError(null);
    setNotice(reread ? (hasPdf ? "Les originaux seront relus avec les nouveaux réglages." : "Les photos seront relues avec les nouveaux réglages.") : null);
  };

  const start = async (mode: "add" | "replace") => {
    if (!ready || !settings || !preferences || run) return;
    // What the office saw when it chose: the drafts, and everything typed on them.
    const expected = lines.map((line) => line.id);
    const seen = JSON.stringify(lines);
    const initialFiles = files;
    const initialIds = new Set(initialFiles.map((entry) => entry.id));
    const initialHasPdf = initialFiles.some(isMaterialRequestPdf);
    const initialSeveral = initialFiles.length > 1;
    const keptText = initialHasPdf ? "Les originaux déjà lus ne seront pas relus." : "Les photos déjà lues ne seront pas relues.";
    const analysisSettings = { preferences, billingSource: settings.billingSource, connectionId: settings.connectionId ?? undefined };
    const settingsKey = JSON.stringify(analysisSettings);
    const controller = new AbortController();
    reading.current = controller;
    setChoosing(false);
    setError(null);
    setNotice(null);

    const readResults: Array<{ file: MaterialRequestFile; position: number; lines: MaterialRequestLineInput[] }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    const removed: string[] = [];
    const rememberRemoved = (name: string) => {
      if (!removed.includes(name)) removed.push(name);
    };

    let position = 0;
    try {
      for (const file of initialFiles) {
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        position += 1;
        // Withdrawn before we reached it: skip without spending a provider call; use live rotation if rotated meanwhile.
        const live = currentFiles.current.find((entry) => entry.id === file.id);
        if (!live) {
          rememberRemoved(file.file_name);
          continue;
        }
        if (live.byte_size > MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES) {
          skipped.push({ name: live.file_name, reason: `dépasse ${MAX_ANALYSIS_MB} Mo` });
          continue;
        }
        const isPdf = isMaterialRequestPdf(live);
        const key = `${settingsKey}:${live.id}:${isPdf ? 0 : live.rotation}`;
        let found = read.current.get(key)?.lines;
        if (!found) {
          setRun({ step: "reading", position, total: initialFiles.length, isPdf });
          try {
            found = (await analyzeMaterialRequestPhoto(projectId, requestId, live.id, controller.signal, analysisSettings)).lines;
            read.current.set(key, { fileId: live.id, lines: found });
          } catch (cause) {
            if (controller.signal.aborted) throw cause;
            if (isPhotoAnalysisNotFound(cause)) {
              rememberRemoved(live.file_name);
              continue;
            }
            if (isPhotoAnalysisSkippable(cause)) {
              const fallback = isPdf ? "PDF illisible par l’IA" : "photo illisible par l’IA";
              skipped.push({ name: live.file_name, reason: materialRequestErrorMessage(cause, fallback).replace(/\.$/, "") });
              continue;
            }
            throw cause;
          }
        }
        readResults.push({ file: live, position, lines: found });
      }
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    } catch (cause) {
      setRun(null);
      if (controller.signal.aborted) {
        setNotice(`Lecture arrêtée : aucune ligne n’a été créée. ${keptText}`);
        setRefocus(true);
        return;
      }
      const message = materialRequestErrorMessage(cause, initialHasPdf ? "L’original n’a pas pu être lu par l’IA." : "La photo n’a pas pu être lue par l’IA.");
      const labelPrefix = initialSeveral
        ? `${initialHasPdf ? "Original" : "Photo"} ${position} sur ${initialFiles.length} : `
        : "";
      setError({
        message: `${labelPrefix}${message} Aucune ligne n’a été créée.${readResults.length > 0 ? ` ${keptText}` : ""}`,
        profile: isPhotoAnalysisUnavailable(cause),
      });
      return;
    }

    // Reconcile against live originals: drop lines from any original withdrawn after it was read, and report additions.
    const liveFiles = currentFiles.current;
    const liveIds = new Set(liveFiles.map((entry) => entry.id));
    const survivingReads = readResults.filter((entry) => {
      if (liveIds.has(entry.file.id)) return true;
      rememberRemoved(entry.file.file_name);
      return false;
    });
    const addedDuringRead = liveFiles.filter((entry) => !initialIds.has(entry.id));

    const drafts: MaterialRequestLineInput[] = [];
    const empty: number[] = [];
    for (const entry of survivingReads) {
      if (entry.lines.length === 0) empty.push(entry.position);
      drafts.push(...entry.lines);
    }

    const sideNotes = [
      formatSkippedOriginals(skipped),
      formatRemovedOriginals(removed),
      formatAddedOriginals(addedDuringRead),
    ].filter(Boolean);

    if (survivingReads.length === 0) {
      setRun(null);
      read.current.clear();
      const message = [...sideNotes, "Aucune ligne n’a été créée."].join(" ");
      if (skipped.length > 0) setError({ message, profile: false });
      else setNotice(message);
      return;
    }

    if (drafts.length === 0) {
      setRun(null);
      read.current.clear();
      const target = initialSeveral
        ? (initialHasPdf ? "les originaux lus" : "les photos")
        : (initialHasPdf ? "ce document" : "la photo");
      const message = [`Aucun article lu sur ${target} : saisissez les lignes à la main.`, ...sideNotes].join(" ");
      if (skipped.length > 0) setError({ message, profile: false });
      else setNotice(message);
      return;
    }

    const room = mode === "replace" ? MATERIAL_REQUEST_MAX_LINES : MATERIAL_REQUEST_MAX_LINES - shown.current;
    const created = drafts.slice(0, Math.max(room, 0));
    if (created.length === 0) {
      setRun(null);
      setError({ message: `La demande compte déjà ${MATERIAL_REQUEST_MAX_LINES} lignes, le plus qu’elle accepte : aucune ligne lue n’a été ajoutée. ${keptText}`, profile: false });
      return;
    }
    setRun({ step: "writing" });
    // A replacement holds for the drafts as the office saw them when it chose: a line added, removed, corrected or
    // linked during the reading, or a correction not saved, refuses it (the editor checks at the write's own turn,
    // the server the ids), and nothing the office did meanwhile is thrown away.
    const result = mode === "replace"
      ? await editor.replaceLines(created, { ids: expected, content: seen })
      : await editor.addLines(created);
    setRun(null);
    if (!result.ok) {
      setError({ message: `${result.message} ${keptText}`, profile: false });
      return;
    }
    read.current.clear();
    const doubtful = created.filter((line) => line.quantity_doubtful).length;
    const summary = mode === "replace"
      ? `${plural(created.length, "ligne", "lignes")} en brouillon, à la place ${expected.length > 1 ? `des ${expected.length} précédentes` : "de la précédente"}.`
      : `${plural(created.length, "ligne créée", "lignes créées")} en brouillon.`;
    const remarks = [summary, `Relisez chaque ligne face à ${initialHasPdf ? "l’original" : "la photo"} avant de valider.`];
    if (doubtful > 0) {
      remarks.push(`${plural(doubtful, "quantité est", "quantités sont")} à vérifier sur l’original.`);
    }
    if (drafts.length > created.length) {
      remarks.push(`${drafts.length} lignes lues sur les ${initialHasPdf ? "originaux" : "photos"}, ${created.length} créées : une demande en compte ${MATERIAL_REQUEST_MAX_LINES} au plus. Les suivantes sont à reprendre à la main.`);
    }
    if (empty.length > 0) {
      const noun = initialHasPdf ? "l’original" : "la photo";
      const pluralNoun = initialHasPdf ? "les originaux" : "les photos";
      remarks.push(empty.length > 1 ? `Aucun article lu sur ${pluralNoun} ${empty.join(", ")}.` : `Aucun article lu sur ${noun} ${empty[0]}.`);
    }
    remarks.push(...sideNotes);
    setNotice(remarks.join(" "));
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      {ready ? (
        settingsError ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="text-sm text-muted-foreground">Impossible de charger les modèles disponibles.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => {
              setSettingsError(false);
              setSettingsAttempt((attempt) => attempt + 1);
            }}>Réessayer</Button>
          </div>
        ) : !settings ? (
          <p role="status" className="text-sm text-muted-foreground">Chargement des modèles…</p>
        ) : preferences ? (
          <AiRequestSettings id={hintId} defaultSource={settings.billingSource}
            sources={{ [settings.billingSource]: { available: true, models: settings.models, message: "Abonnement ChatGPT" } }}
            value={{ source: settings.billingSource, preferences }}
            locked={run !== null || choosing} onChange={(value) => { if (value.preferences) changePreferences(value.preferences); }}
            modelLabel="Modèle d’analyse" fieldsClassName="grid gap-3 sm:grid-cols-2" effortFallback="automatic"
            keyCeiling={{
              nanoUsd: MATERIAL_REQUEST_PHOTO_API_CEILING_NANO_USD * Math.max(readableCount, 1),
              message: (ceiling) => `Clé API OpenAI · jusqu’à ${ceiling} pour cette lecture (${formatUsdCeiling(MATERIAL_REQUEST_PHOTO_API_CEILING_NANO_USD)} par original).`,
            }} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">Aucun modèle disponible pour cette source.</p>
        )
      ) : null}
      {!choosing ? (
        // Kept while the originals are read, so that the focus has somewhere to stay.
        <Button
          ref={trigger}
          type="button"
          variant="outline"
          size="sm"
          loading={run !== null}
          disabled={!ready || !preferences}
          aria-describedby={run === null ? hintId : undefined}
          onClick={() => {
            // Adding is never a loss; replacing drafts is the office's choice.
            if (replaceable) setChoosing(true);
            else void start("add");
          }}
        >
          <Sparkles aria-hidden="true" />
          {analyzeLabel}
        </Button>
      ) : null}
      {run !== null ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-sm text-foreground">
            {run.step === "writing"
              ? "Création des lignes…"
              : run.total > 1
                ? `Lecture ${run.isPdf ? "du PDF" : "de la photo"} ${run.position} sur ${run.total}… Un original demande jusqu’à trois minutes.`
                : run.isPdf
                  ? "Lecture du PDF… Elle demande jusqu’à trois minutes."
                  : "Lecture de la photo… Elle demande jusqu’à trois minutes."}
          </p>
          {run.step === "reading" ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => reading.current?.abort()}>
              Arrêter
            </Button>
          ) : null}
        </div>
      ) : null}
      {run === null && !choosing ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {ready ? (
            <>
              {`L’IA lit ${several ? (hasPdf ? "chaque original" : "chaque photo") : (allPdf ? "le PDF" : "la photo")} et propose des lignes en brouillon${lines.length > 0 && !replaceable ? ", ajoutées à la suite des lignes existantes" : ""}. Elle ne valide rien : chaque ligne se relit face à l’original.`}
              {heavyFiles.length > 0
                ? ` ${plural(heavyFiles.length, "original dépasse", "originaux dépassent")} ${MAX_ANALYSIS_MB} Mo et ${heavyFiles.length > 1 ? "seront ignorés" : "sera ignoré"}.`
                : ""}
            </>
          ) : (
            <>
              {availability.message}{" "}
              <Link href={PROFILE_HREF} className="underline underline-offset-2">
                Ouvrir Mon profil
              </Link>
            </>
          )}
        </p>
      ) : null}
      {choosing ? (
        <Alert variant="warning">
          <AlertDescription>
            <p>
              {lines.length > 1
                ? `La demande compte ${lines.length} lignes en brouillon. Les lignes lues sur ${several ? (hasPdf ? "les originaux" : "les photos") : (allPdf ? "le PDF" : "la photo")} peuvent s’ajouter à la suite, ou les remplacer avec ce qui y a été saisi : articles, fournisseurs, corrections.`
                : `La demande compte une ligne en brouillon. Les lignes lues sur ${several ? (hasPdf ? "les originaux" : "les photos") : (allPdf ? "le PDF" : "la photo")} peuvent s’ajouter à la suite, ou la remplacer avec ce qui y a été saisi : article, fournisseur, corrections.`}
            </p>
            {heavyFiles.length > 0 ? (
              <p className="mt-1">
                {`${plural(heavyFiles.length, "original dépasse", "originaux dépassent")} ${MAX_ANALYSIS_MB} Mo et ${heavyFiles.length > 1 ? "seront ignorés" : "sera ignoré"} pendant cette lecture.`}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" autoFocus onClick={() => void start("add")}>
                Ajouter à la suite
              </Button>
              {/* A change still on its way, or refused, would be refused again after the whole reading. */}
              <Button type="button" variant="danger" size="sm" disabled={editor.lineChanges.size > 0} onClick={() => void start("replace")}>
                {lines.length > 1 ? `Remplacer les ${lines.length} lignes` : "Remplacer la ligne"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setChoosing(false);
                  setRefocus(true);
                }}
              >
                Annuler
              </Button>
            </div>
            {editor.lineChanges.size > 0 ? (
              <p className="mt-2">
                Une modification de ligne n’est pas enregistrée : le remplacement attend qu’elle le soit, ou qu’elle soit
                abandonnée.
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-foreground">
          {notice}
        </p>
      ) : null}
      {error ? (
        <Alert variant="danger">
          <AlertDescription>
            <p>{error.message}</p>
            {error.profile ? (
              <Link href={PROFILE_HREF} className="mt-1 inline-block underline underline-offset-2">
                Ouvrir Mon profil
              </Link>
            ) : null}
          </AlertDescription>
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
  const isPdf = isMaterialRequestPdf(file);
  const photo = usePhotoUrl(projectId, requestId, file.id);
  const downloadUrl = materialRequestFileUrl(projectId, requestId, file.id);
  const alt = `${isPdf ? "PDF" : "Photo"} ${position} de la demande : ${file.file_name}`;

  const rotate = async (direction: 1 | -1) => {
    const result = await editor.rotateFile(file.id, quarterTurn(file.rotation, direction));
    onError(result.ok ? null : result.message);
  };

  return (
    <div className="space-y-2">
      {photo.url ? (
        isPdf ? (
          <MaterialRequestPdfViewer url={photo.url} name={file.file_name} downloadUrl={downloadUrl} />
        ) : (
          <PhotoFrame url={photo.url} alt={alt} rotation={file.rotation} />
        )
      ) : photo.error ? (
        <div role="alert" className="rounded-lg border border-danger-border bg-danger-subtle px-4 py-6 text-center text-sm text-danger">
          <p>{photo.error}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={photo.retry}>
            Réessayer
          </Button>
        </div>
      ) : (
        <p role="status" className="aspect-square w-full rounded-lg border border-border bg-surface-subtle p-4 text-sm text-muted-foreground">
          {isPdf ? `Ouverture du PDF ${count > 1 ? `${position} ` : ""}…` : `Ouverture de la photo ${count > 1 ? `${position} ` : ""}…`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canWrite && !isPdf ? (
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
        {isPdf ? (
          <a
            href={downloadUrl}
            download={file.file_name}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Download aria-hidden="true" className="size-3.5" />
            Télécharger
          </a>
        ) : null}
        {canWrite ? (
          <ConfirmButton
            label={isPdf ? "Retirer le document" : "Retirer la photo"}
            confirmLabel={isPdf ? "Confirmer le retrait du document" : "Confirmer le retrait de la photo"}
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
              {isPdf ? `PDF ${position} sur ${count}, tel que reçu.` : `Photo ${position} sur ${count}, telle que reçue.`}
            </DialogDescription>
          </DialogHeader>
          {photo.url ? (
            isPdf ? (
              <MaterialRequestPdfViewer url={photo.url} name={file.file_name} downloadUrl={downloadUrl} className="h-[78dvh] w-full" />
            ) : (
              <PhotoFrame url={photo.url} alt={alt} rotation={file.rotation} className="w-[min(78dvh,100%)]" />
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Where the splitting cuts the message, said where the office reads or corrects it. */
const SPLIT_RULE =
  "Le découpage suit les retours à la ligne, les tirets espacés et les virgules ou points-virgules suivis d’une quantité. Une référence ou une note comme « quantité à confirmer » après un tiret reste avec son article.";

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
    <div className="min-w-0 space-y-2">
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

export function MaterialRequestOriginalDialog({ editor }: Readonly<{ editor: MaterialRequestEditorApi }>) {
  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>
        Voir l’original
      </DialogTrigger>
      <DialogContent size="xl" keepMounted>
        <DialogHeader>
          <DialogTitle>Original de la demande</DialogTitle>
          <DialogDescription className="sr-only">Message et photos reçus du technicien.</DialogDescription>
        </DialogHeader>
        <div className={editor.data.files.length ? "grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]" : "grid gap-5"}>
          <SourceText editor={editor} />
          <Photos editor={editor} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
