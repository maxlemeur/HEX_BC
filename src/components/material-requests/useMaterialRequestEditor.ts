"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  materialRequestLineAlerts,
  type AlertContext,
  type MaterialRequestLineAlert,
} from "@/lib/material-requests/alerts";
import {
  bulkUpdateMaterialRequestLines,
  createMaterialRequestLines,
  deleteMaterialRequestFile,
  deleteMaterialRequestLine,
  fetchMaterialRequest,
  materialRequestErrorMessage,
  readBlockedLines,
  reopenMaterialRequestLines,
  rotateMaterialRequestFile,
  updateMaterialRequest,
  updateMaterialRequestLine,
  validateMaterialRequestLines,
  type MaterialRequestBlockedLine,
  type MaterialRequestEditorData,
} from "@/lib/material-requests/client";
import type {
  BulkUpdateMaterialRequestLinesInput,
  MaterialRequestFileRotation,
  MaterialRequestLine,
  MaterialRequestLineInput,
  UpdateMaterialRequestInput,
} from "@/lib/material-requests/contracts";

import { uploadMaterialRequestPhotos, type PhotoUploadStep } from "./photo-upload";

/** `blocked`: the server held lines back and validated nothing; the report is in the editor state. */
export type SaveResult = { ok: true } | { ok: false; message: string; blocked?: true };

export type MaterialRequestEditorApi = {
  projectId: string;
  requestId: string;
  data: MaterialRequestEditorData;
  canWrite: boolean;
  alertContext: AlertContext;
  alertsByLine: ReadonlyMap<string, MaterialRequestLineAlert[]>;
  /** Answer of the last refused validation, until the operator closes it or validates again. */
  blocked: MaterialRequestBlockedLine[] | null;
  dismissBlocked: () => void;
  /**
   * How many validated lines the last change of the request returned to draft, because they relied on
   * the presumed material; null once the operator has read it.
   */
  reopenedByRequestChange: number | null;
  dismissReopened: () => void;
  updateRequest: (patch: UpdateMaterialRequestInput) => Promise<SaveResult>;
  saveLine: (lineId: string, patch: MaterialRequestLineInput) => Promise<SaveResult>;
  addLines: (lines: MaterialRequestLineInput[]) => Promise<SaveResult>;
  removeLine: (lineId: string) => Promise<SaveResult>;
  applyToLines: (ids: string[], patch: BulkUpdateMaterialRequestLinesInput["patch"]) => Promise<SaveResult>;
  validateLines: (ids: string[]) => Promise<SaveResult>;
  reopenLines: (ids: string[]) => Promise<SaveResult>;
  /** The photos are listed only once the server has checked them; until then `onStep` says where it is. */
  addFiles: (files: readonly File[], onStep?: (progress: PhotoUploadStep) => void) => Promise<SaveResult>;
  rotateFile: (fileId: string, rotation: MaterialRequestFileRotation) => Promise<SaveResult>;
  removeFile: (fileId: string) => Promise<SaveResult>;
};

export type MaterialRequestEditorState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "ready"; editor: MaterialRequestEditorApi };

function byPosition(lines: MaterialRequestLine[]): MaterialRequestLine[] {
  return [...lines].sort((left, right) => left.position - right.position);
}

/** The server's lines replace ours one by one; lines it created are added. */
function mergeLines(data: MaterialRequestEditorData, lines: MaterialRequestLine[]): MaterialRequestEditorData {
  const incoming = new Map(lines.map((line) => [line.id, line]));
  const known = new Set(data.lines.map((line) => line.id));
  return {
    ...data,
    lines: byPosition([
      ...data.lines.map((line) => incoming.get(line.id) ?? line),
      ...lines.filter((line) => !known.has(line.id)),
    ]),
  };
}

/**
 * State of one request on screen. Every write goes to the server one after the other, in the order the
 * operator made them, and the screen then shows what the server answered.
 */
export function useMaterialRequestEditor(projectId: string, requestId: string): MaterialRequestEditorState {
  const [data, setData] = useState<MaterialRequestEditorData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [blocked, setBlocked] = useState<MaterialRequestBlockedLine[] | null>(null);
  const [reopenedByRequestChange, setReopenedByRequestChange] = useState<number | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const leaving = useRef<AbortController | null>(null);

  // Leaving the request while photos are on their way drops what was prepared for them.
  useEffect(() => {
    const controller = new AbortController();
    leaving.current = controller;
    return () => controller.abort();
  }, [projectId, requestId]);

  useEffect(() => {
    const abort = new AbortController();
    fetchMaterialRequest(projectId, requestId, abort.signal)
      .then((next) => {
        if (!abort.signal.aborted) setData({ ...next, lines: byPosition(next.lines) });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          setLoadError(materialRequestErrorMessage(error, "La demande n’a pas pu être chargée."));
        }
      });
    return () => abort.abort();
  }, [projectId, requestId, attempt]);

  const retry = useCallback(() => {
    setLoadError(null);
    setAttempt((current) => current + 1);
  }, []);

  const enqueue = useCallback(<T,>(call: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(call, call);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const run = useCallback(
    async <T,>(
      call: () => Promise<T>,
      apply: (current: MaterialRequestEditorData, result: T) => MaterialRequestEditorData,
      fallback: string,
    ): Promise<SaveResult> => {
      try {
        const result = await enqueue(call);
        setData((current) => (current ? apply(current, result) : current));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: materialRequestErrorMessage(error, fallback) };
      }
    },
    [enqueue],
  );

  /** Positions and counts are the server's: after a removal, read them again without a loading state. */
  const resync = useCallback(async () => {
    try {
      const next = await enqueue(() => fetchMaterialRequest(projectId, requestId));
      setData({ ...next, lines: byPosition(next.lines) });
    } catch {
      // The screen keeps what it has; the next action or a reload will say what is wrong.
    }
  }, [enqueue, projectId, requestId]);

  const actions = useMemo(
    () => ({
      updateRequest: async (patch: UpdateMaterialRequestInput): Promise<SaveResult> => {
        try {
          const { request, reopened_line_ids } = await enqueue(() => updateMaterialRequest(projectId, requestId, patch));
          const reopened = new Set(reopened_line_ids);
          // The lines and the sentence about them change in the same render.
          setData((current) =>
            current
              ? {
                  ...current,
                  request,
                  lines: current.lines.map((line) =>
                    reopened.has(line.id) ? { ...line, status: "draft" as const, validated_at: null } : line,
                  ),
                }
              : current,
          );
          if (reopened.size > 0) setReopenedByRequestChange(reopened.size);
          return { ok: true };
        } catch (error) {
          return { ok: false, message: materialRequestErrorMessage(error, "La demande n’a pas pu être enregistrée.") };
        }
      },
      saveLine: (lineId: string, patch: MaterialRequestLineInput) =>
        run(
          () => updateMaterialRequestLine(projectId, requestId, lineId, patch),
          (current, line) => mergeLines(current, [line]),
          "La ligne n’a pas pu être enregistrée.",
        ),
      addLines: (lines: MaterialRequestLineInput[]) =>
        run(() => createMaterialRequestLines(projectId, requestId, lines), mergeLines, "Les lignes n’ont pas pu être ajoutées."),
      removeLine: async (lineId: string) => {
        const result = await run(
          () => deleteMaterialRequestLine(projectId, requestId, lineId),
          (current) => ({ ...current, lines: current.lines.filter((line) => line.id !== lineId) }),
          "La ligne n’a pas pu être supprimée.",
        );
        if (result.ok) void resync();
        return result;
      },
      applyToLines: (ids: string[], patch: BulkUpdateMaterialRequestLinesInput["patch"]) =>
        run(
          () => bulkUpdateMaterialRequestLines(projectId, requestId, { ids, patch }),
          mergeLines,
          "La modification n’a pas pu être appliquée à la sélection.",
        ),
      validateLines: async (ids: string[]): Promise<SaveResult> => {
        setBlocked(null);
        try {
          const lines = await enqueue(() => validateMaterialRequestLines(projectId, requestId, ids));
          setData((current) => (current ? mergeLines(current, lines) : current));
          return { ok: true };
        } catch (error) {
          const refused = readBlockedLines(error);
          if (refused) {
            setBlocked(refused);
            return { ok: false, blocked: true, message: "Rien n’a été validé." };
          }
          return { ok: false, message: materialRequestErrorMessage(error, "Les lignes n’ont pas pu être validées.") };
        }
      },
      reopenLines: (ids: string[]) =>
        run(() => reopenMaterialRequestLines(projectId, requestId, ids), mergeLines, "Les lignes n’ont pas pu être rouvertes."),
      // Outside the queue of writes: the lines stay editable while the photos travel.
      addFiles: async (files: readonly File[], onStep?: (progress: PhotoUploadStep) => void): Promise<SaveResult> => {
        const result = await uploadMaterialRequestPhotos({
          projectId,
          requestId,
          files,
          onStep,
          signal: leaving.current?.signal,
        });
        if (!result.ok) return { ok: false, message: result.message };
        setData((current) => {
          if (!current) return current;
          const known = new Set(current.files.map((file) => file.id));
          return { ...current, files: [...current.files, ...result.files.filter((file) => !known.has(file.id))] };
        });
        return { ok: true };
      },
      rotateFile: async (fileId: string, rotation: MaterialRequestFileRotation) => {
        // The photo turns at once; the server's answer, or a fresh read after a failure, has the last word.
        setData((current) =>
          current
            ? { ...current, files: current.files.map((file) => (file.id === fileId ? { ...file, rotation } : file)) }
            : current,
        );
        const result = await run(
          () => rotateMaterialRequestFile(projectId, requestId, fileId, rotation),
          (current, saved) => ({
            ...current,
            files: current.files.map((file) => (file.id === saved.id ? { ...file, ...saved, rotation: file.rotation } : file)),
          }),
          "La rotation n’a pas pu être enregistrée.",
        );
        if (!result.ok) void resync();
        return result;
      },
      removeFile: (fileId: string) =>
        run(
          () => deleteMaterialRequestFile(projectId, requestId, fileId),
          (current) => ({ ...current, files: current.files.filter((file) => file.id !== fileId) }),
          "La photo n’a pas pu être retirée.",
        ),
    }),
    [enqueue, projectId, requestId, resync, run],
  );

  const alertContext = useMemo<AlertContext | null>(
    () => (data ? { request: data.request, lines: data.lines } : null),
    [data],
  );
  const alertsByLine = useMemo(() => {
    const alerts = new Map<string, MaterialRequestLineAlert[]>();
    if (alertContext) {
      for (const line of alertContext.lines) alerts.set(line.id, materialRequestLineAlerts(line, alertContext));
    }
    return alerts;
  }, [alertContext]);
  const dismissBlocked = useCallback(() => setBlocked(null), []);
  const dismissReopened = useCallback(() => setReopenedByRequestChange(null), []);

  if (loadError && !data) return { status: "error", message: loadError, retry };
  if (!data || !alertContext) return { status: "loading" };
  return {
    status: "ready",
    editor: {
      projectId,
      requestId,
      data,
      canWrite: data.canWrite,
      alertContext,
      alertsByLine,
      blocked,
      dismissBlocked,
      reopenedByRequestChange,
      dismissReopened,
      ...actions,
    },
  };
}
