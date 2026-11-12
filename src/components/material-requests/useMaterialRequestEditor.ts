"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  materialRequestLineAlerts,
  type AlertContext,
  type MaterialRequestLineAlert,
} from "@/lib/material-requests/alerts";
import {
  bulkUpdateMaterialRequestLines,
  createMaterialRequestLineArticle,
  createMaterialRequestLines,
  deleteMaterialRequestFile,
  deleteMaterialRequestLine,
  fetchMaterialRequest,
  fetchMaterialRequestCandidates,
  isLineChanged,
  isPresumptionChanged,
  linkMaterialRequestLineArticle,
  materialRequestErrorMessage,
  readBlockedLines,
  reopenMaterialRequestLines,
  rotateMaterialRequestFile,
  unlinkMaterialRequestLineArticle,
  updateMaterialRequest,
  updateMaterialRequestLine,
  validateMaterialRequestLines,
  type MaterialRequestBlockedLine,
  type MaterialRequestEditorData,
} from "@/lib/material-requests/client";
import type {
  BulkUpdateMaterialRequestLinesInput,
  CreateMaterialRequestLineArticleInput,
  LinkMaterialRequestLineArticleInput,
  MaterialRequestArticleCandidate,
  MaterialRequestArticleSummary,
  MaterialRequestFileRotation,
  MaterialRequestLine,
  MaterialRequestLineArticleResult,
  MaterialRequestLineInput,
  UpdateMaterialRequestInput,
} from "@/lib/material-requests/contracts";

import { uploadMaterialRequestPhotos, type PhotoUploadStep } from "./photo-upload";

/**
 * `validated`: how many lines a validation really validated (lines held back are not counted).
 * `blocked`: nothing was done and the editor state already says why (lines refused by the server, or
 * held back because their last change is not saved); the caller adds no message of its own.
 */
export type SaveResult = { ok: true; validated?: number } | { ok: false; message: string; blocked?: true };

/** A line whose last change is on its way to the server, or was refused by it and is still on screen. */
export type LineChangeState = "saving" | "failed";

/** Lines an action left out because a change typed on them is not saved. */
export type WithheldLines = { action: "validate" | "apply"; lineIds: string[] };

/**
 * The article proposals of one line, as the screen may use them. `stale`: the line, or what its
 * proposals depend on, changed since they were read; fresh ones are on their way.
 */
export type LineProposals =
  | { status: "loading" | "error" | "stale" }
  | { status: "ready"; candidates: MaterialRequestArticleCandidate[] };

/**
 * What the last link of a line taught or changed, said beside it until it is unlinked: the usual name
 * learned, a validated line returned to draft, a unit replaced by the article's (the quantity was
 * counted in the technician's unit, so the server marks it to check).
 */
export type ArticleNotice = { aliasLearned: string | null; reopened: boolean; quantityToCheck: boolean };

function noticeOf(before: MaterialRequestLine | undefined, after: MaterialRequestLine, aliasLearned: string | null): ArticleNotice {
  return {
    aliasLearned,
    reopened: before?.status === "validated" && after.status === "draft",
    quantityToCheck: before?.quantity_doubtful !== true && after.quantity_doubtful,
  };
}

export type ArticleLinkEntry = { lineId: string; input: LinkMaterialRequestLineArticleInput };

/** `left`: lines of the request still without an article once the bulk link is done. */
export type BulkLinkResult = { linked: number; left: number; failures: string[] };

/** The columns the matcher reads: a change of one of them makes the line's proposals stale. */
const MATCHED_COLUMNS: ReadonlySet<string> = new Set([
  "reference",
  "product_type",
  "material",
  "material_precision",
  "dimension",
  "unit",
]);

/** The link fills the line's columns from the article: a change still on screen would be overwritten. */
export const ARTICLE_LINK_HELD =
  "Une modification de cette ligne n’est pas enregistrée : elle ne peut pas être rattachée à un article en l’état.";

function touchesMatchedColumns(patch: object): boolean {
  return Object.keys(patch).some((key) => MATCHED_COLUMNS.has(key));
}

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
  /** Lines with a change that is not saved yet, or that could not be saved: they cannot be validated. */
  lineChanges: ReadonlyMap<string, LineChangeState>;
  /** The operator dropped a change that could not be saved: these columns of the line are clean again. */
  forgetLineFailure: (lineId: string, fields: readonly string[]) => void;
  /** Lines the last validation or bulk change left out, until the operator has read it. */
  withheld: WithheldLines | null;
  dismissWithheld: () => void;
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
  /** Every article linked to a line of the request, by id. */
  articles: Readonly<Record<string, MaterialRequestArticleSummary>>;
  /** Read once for the page, then again after a change that makes them stale; never per line. */
  proposalsOf: (lineId: string) => LineProposals;
  retryProposals: () => void;
  articleNotices: ReadonlyMap<string, ArticleNotice>;
  /**
   * Lines whose link or unlink the server refused because they changed since they were read: its
   * sentence, kept beside the line after the request was read again, until the next link or unlink.
   */
  articleConflicts: ReadonlyMap<string, string>;
  /** Refused, with ARTICLE_LINK_HELD, while a change of the line is on its way or was refused. */
  linkArticle: (lineId: string, input: LinkMaterialRequestLineArticleInput) => Promise<SaveResult>;
  /** One gesture, one request per line, in order; a line holding an unsaved change is left out. */
  linkArticles: (entries: readonly ArticleLinkEntry[]) => Promise<BulkLinkResult>;
  unlinkArticle: (lineId: string) => Promise<SaveResult>;
  createArticle: (lineId: string, input: CreateMaterialRequestLineArticleInput) => Promise<SaveResult>;
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

/** The line as linked by the server, and its article among the request's. */
function applyArticleLink(
  data: MaterialRequestEditorData,
  result: MaterialRequestLineArticleResult,
): MaterialRequestEditorData {
  return {
    ...mergeLines(data, [result.line]),
    articles: { ...(data.articles ?? {}), [result.article.id]: result.article },
  };
}

type ProposalsRead = { status: "loading" | "ready" | "error"; lines: Record<string, MaterialRequestArticleCandidate[]> };

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
  /**
   * Per line: the saves not answered yet and the columns whose last save failed. Kept in a ref because a
   * validation queued behind a save must read that save's outcome the moment its own turn comes, before
   * any render; `lineChanges` is the same thing for the screen.
   */
  const lineWrites = useRef(new Map<string, { pending: number; failed: Set<string> }>());
  const [lineChanges, setLineChanges] = useState<ReadonlyMap<string, LineChangeState>>(new Map());
  const [withheld, setWithheld] = useState<WithheldLines | null>(null);
  const leaving = useRef<AbortController | null>(null);
  const [proposals, setProposals] = useState<ProposalsRead>({ status: "loading", lines: {} });
  /** Bumped by every change that makes proposals stale: the page reads them all again, once. */
  const [proposalsVersion, setProposalsVersion] = useState(0);
  const [staleProposals, setStaleProposals] = useState<ReadonlySet<string> | "all">(new Set<string>());
  const [articleNotices, setArticleNotices] = useState<ReadonlyMap<string, ArticleNotice>>(new Map());
  const [articleConflicts, setArticleConflicts] = useState<ReadonlyMap<string, string>>(new Map());
  /** The lines as last rendered: a link compares the line's status before and after. */
  const latest = useRef<MaterialRequestEditorData | null>(null);
  useEffect(() => {
    latest.current = data;
  }, [data]);

  const loaded = data !== null;
  const writable = data?.canWrite === true;
  // Proposals are for the office: a reader has nothing to link, and is never sent for them.
  useEffect(() => {
    if (!loaded || !writable) return;
    const abort = new AbortController();
    fetchMaterialRequestCandidates(projectId, requestId, abort.signal)
      .then((lines) => {
        if (abort.signal.aborted) return;
        setProposals({ status: "ready", lines });
        setStaleProposals(new Set<string>());
      })
      .catch(() => {
        if (!abort.signal.aborted) setProposals((current) => ({ ...current, status: "error" }));
      });
    return () => abort.abort();
  }, [loaded, writable, proposalsVersion, projectId, requestId]);

  const markProposalsStale = useCallback((lineIds: readonly string[] | "all") => {
    setStaleProposals((current) =>
      lineIds === "all" || current === "all" ? "all" : new Set([...current, ...lineIds]),
    );
    setProposalsVersion((current) => current + 1);
  }, []);

  const retryProposals = useCallback(() => {
    setProposals((current) => ({ ...current, status: "loading" }));
    setProposalsVersion((current) => current + 1);
  }, []);

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

  const publishLineChanges = useCallback(() => {
    const next = new Map<string, LineChangeState>();
    for (const [lineId, record] of lineWrites.current) {
      if (record.failed.size > 0) next.set(lineId, "failed");
      else if (record.pending > 0) next.set(lineId, "saving");
    }
    setLineChanges(next);
  }, []);

  const forgetLineFailure = useCallback(
    (lineId: string, fields: readonly string[]) => {
      const record = lineWrites.current.get(lineId);
      if (!record) return;
      for (const field of fields) record.failed.delete(field);
      publishLineChanges();
    },
    [publishLineChanges],
  );

  /** A change of the line is on its way, or was refused and is still on screen. */
  const holdsUnsavedChange = useCallback((lineId: string) => {
    const record = lineWrites.current.get(lineId);
    return record !== undefined && (record.pending > 0 || record.failed.size > 0);
  }, []);

  const setConflict = useCallback((lineId: string, message: string | null) => {
    setArticleConflicts((current) => {
      if (message === null && !current.has(lineId)) return current;
      const next = new Map(current);
      if (message === null) next.delete(lineId);
      else next.set(lineId, message);
      return next;
    });
  }, []);

  /**
   * The line changed since it was read (another session, another tab): nothing was written. The request
   * is read again, as for a confirmation of a presumption that changed, so the operator decides on the
   * line as it now is; the server's sentence stays beside it.
   */
  const reportLineChanged = useCallback(
    async (lineId: string, error: unknown, fallback: string): Promise<SaveResult> => {
      const message = materialRequestErrorMessage(error, fallback);
      setConflict(lineId, message);
      await resync();
      markProposalsStale([lineId]);
      return { ok: false, blocked: true, message };
    },
    [markProposalsStale, resync, setConflict],
  );

  /**
   * A link (to a proposal, or to an article created from the line): the server fills the line's columns
   * from the article, so a line holding a change that is not saved is never linked, neither when the
   * gesture is made nor when its turn in the queue comes.
   */
  const settleArticleLink = useCallback(
    async (
      lineId: string,
      call: () => Promise<MaterialRequestLineArticleResult>,
      fallback: string,
    ): Promise<SaveResult> => {
      if (holdsUnsavedChange(lineId)) return { ok: false, message: ARTICLE_LINK_HELD };
      const before = latest.current?.lines.find((line) => line.id === lineId);
      setConflict(lineId, null);
      try {
        const result = await enqueue(async () => (holdsUnsavedChange(lineId) ? null : call()));
        if (result === null) return { ok: false, message: ARTICLE_LINK_HELD };
        setData((current) => (current ? applyArticleLink(current, result) : current));
        setArticleNotices((current) => new Map(current).set(lineId, noticeOf(before, result.line, result.alias_learned)));
        // The usual name just learned can change what other lines are proposed.
        markProposalsStale([]);
        return { ok: true };
      } catch (error) {
        if (isLineChanged(error)) return reportLineChanged(lineId, error, fallback);
        return { ok: false, message: materialRequestErrorMessage(error, fallback) };
      }
    },
    [enqueue, holdsUnsavedChange, markProposalsStale, reportLineChanged, setConflict],
  );

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
          // A line that names no material is matched with the request's presumed one.
          if ("presumed_material" in patch || "material_confirmed" in patch) markProposalsStale("all");
          return { ok: true };
        } catch (error) {
          // The value about to be confirmed is no longer the one stored: nothing was written. The request
          // is read again first, so the operator sees what is stored now beside the server's sentence.
          if (isPresumptionChanged(error)) await resync();
          return { ok: false, message: materialRequestErrorMessage(error, "La demande n’a pas pu être enregistrée.") };
        }
      },
      saveLine: (lineId: string, patch: MaterialRequestLineInput) => {
        const fields = Object.keys(patch);
        const record = lineWrites.current.get(lineId) ?? { pending: 0, failed: new Set<string>() };
        lineWrites.current.set(lineId, record);
        record.pending += 1;
        publishLineChanges();
        const saved = run(
          async () => {
            // The outcome is recorded inside the queued call itself: whatever was queued behind this
            // save (a validation, a bulk change) reads it before it is sent.
            try {
              const line = await updateMaterialRequestLine(projectId, requestId, lineId, patch);
              for (const field of fields) record.failed.delete(field);
              return line;
            } catch (error) {
              for (const field of fields) record.failed.add(field);
              throw error;
            } finally {
              record.pending -= 1;
              publishLineChanges();
            }
          },
          (current, line) => mergeLines(current, [line]),
          "La ligne n’a pas pu être enregistrée.",
        );
        return touchesMatchedColumns(patch)
          ? saved.then((result) => {
              if (result.ok) markProposalsStale([lineId]);
              return result;
            })
          : saved;
      },
      addLines: async (lines: MaterialRequestLineInput[]): Promise<SaveResult> => {
        try {
          const created = await enqueue(() => createMaterialRequestLines(projectId, requestId, lines));
          setData((current) => (current ? mergeLines(current, created) : current));
          markProposalsStale(created.map((line) => line.id));
          return { ok: true };
        } catch (error) {
          return { ok: false, message: materialRequestErrorMessage(error, "Les lignes n’ont pas pu être ajoutées.") };
        }
      },
      removeLine: async (lineId: string) => {
        const result = await run(
          () => deleteMaterialRequestLine(projectId, requestId, lineId),
          (current) => ({ ...current, lines: current.lines.filter((line) => line.id !== lineId) }),
          "La ligne n’a pas pu être supprimée.",
        );
        if (result.ok) {
          lineWrites.current.delete(lineId);
          publishLineChanges();
          void resync();
        }
        return result;
      },
      applyToLines: async (ids: string[], patch: BulkUpdateMaterialRequestLinesInput["patch"]): Promise<SaveResult> => {
        setWithheld(null);
        const fields = Object.keys(patch);
        try {
          const outcome = await enqueue(async () => {
            // A value typed in one of these columns and not saved is still on screen with its message:
            // the bulk change leaves that line alone instead of slipping another value under it.
            const held = ids.filter((id) => {
              const record = lineWrites.current.get(id);
              return record !== undefined && fields.some((field) => record.failed.has(field));
            });
            const ready = ids.filter((id) => !held.includes(id));
            const lines =
              ready.length > 0 ? await bulkUpdateMaterialRequestLines(projectId, requestId, { ids: ready, patch }) : [];
            return { held, ready, lines };
          });
          setData((current) => (current ? mergeLines(current, outcome.lines) : current));
          if (outcome.ready.length > 0 && touchesMatchedColumns(patch)) markProposalsStale(outcome.ready);
          if (outcome.held.length > 0) setWithheld({ action: "apply", lineIds: outcome.held });
          return outcome.ready.length > 0
            ? { ok: true }
            : { ok: false, blocked: true, message: "Aucune ligne n’a été modifiée." };
        } catch (error) {
          return {
            ok: false,
            message: materialRequestErrorMessage(error, "La modification n’a pas pu être appliquée à la sélection."),
          };
        }
      },
      validateLines: async (ids: string[]): Promise<SaveResult> => {
        setBlocked(null);
        setWithheld(null);
        // Lines left out are reported even when the server then refuses the others.
        let held: string[] = [];
        try {
          const lines = await enqueue(async () => {
            // Every save made before this validation has answered by now. A line whose change was
            // refused, or is still to be sent, is not validated: the server would validate the values it
            // holds, not the ones on screen, and the settled row would hide the typed value and its error.
            held = ids.filter((id) => {
              const record = lineWrites.current.get(id);
              return record !== undefined && (record.pending > 0 || record.failed.size > 0);
            });
            const ready = ids.filter((id) => !held.includes(id));
            return ready.length > 0 ? validateMaterialRequestLines(projectId, requestId, ready) : [];
          });
          setData((current) => (current ? mergeLines(current, lines) : current));
          if (held.length > 0) setWithheld({ action: "validate", lineIds: held });
          return lines.length > 0 || held.length === 0
            ? { ok: true, validated: lines.length }
            : { ok: false, blocked: true, message: "Rien n’a été validé." };
        } catch (error) {
          if (held.length > 0) setWithheld({ action: "validate", lineIds: held });
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
      linkArticle: (lineId: string, input: LinkMaterialRequestLineArticleInput) =>
        settleArticleLink(
          lineId,
          () => linkMaterialRequestLineArticle(projectId, requestId, lineId, input),
          "L’article n’a pas pu être rattaché.",
        ),
      createArticle: (lineId: string, input: CreateMaterialRequestLineArticleInput) =>
        settleArticleLink(
          lineId,
          () => createMaterialRequestLineArticle(projectId, requestId, lineId, input),
          "L’article n’a pas pu être créé.",
        ),
      linkArticles: async (entries: readonly ArticleLinkEntry[]): Promise<BulkLinkResult> => {
        const before = new Map((latest.current?.lines ?? []).map((line) => [line.id, line]));
        for (const entry of entries) setConflict(entry.lineId, null);
        const outcome = await enqueue(async () => {
          const results: MaterialRequestLineArticleResult[] = [];
          const failures: string[] = [];
          const changed = new Map<string, string>();
          for (const entry of entries) {
            // Read at each line's turn: a save queued before the gesture has answered by now.
            if (holdsUnsavedChange(entry.lineId)) {
              failures.push(ARTICLE_LINK_HELD);
              continue;
            }
            try {
              results.push(await linkMaterialRequestLineArticle(projectId, requestId, entry.lineId, entry.input));
            } catch (error) {
              const message = materialRequestErrorMessage(error, "L’article n’a pas pu être rattaché.");
              if (isLineChanged(error)) changed.set(entry.lineId, message);
              failures.push(message);
            }
          }
          return { results, failures, changed };
        });
        if (outcome.results.length > 0) {
          setData((current) => (current ? outcome.results.reduce(applyArticleLink, current) : current));
          setArticleNotices((current) => {
            const next = new Map(current);
            for (const result of outcome.results) {
              next.set(result.line.id, noticeOf(before.get(result.line.id), result.line, result.alias_learned));
            }
            return next;
          });
          markProposalsStale([]);
        }
        if (outcome.changed.size > 0) {
          for (const [lineId, message] of outcome.changed) setConflict(lineId, message);
          // Read again after the queued task: inside it, a read would wait behind itself.
          await resync();
          markProposalsStale([...outcome.changed.keys()]);
        }
        const linkedIds = new Set(outcome.results.map((result) => result.line.id));
        const left = (latest.current?.lines ?? []).filter((line) => !line.product_id && !linkedIds.has(line.id)).length;
        return { linked: outcome.results.length, left, failures: outcome.failures };
      },
      unlinkArticle: async (lineId: string): Promise<SaveResult> => {
        setConflict(lineId, null);
        try {
          // The server gives the line back its technician's words: its answer replaces the line whole.
          const line = await enqueue(() => unlinkMaterialRequestLineArticle(projectId, requestId, lineId));
          setData((current) => (current ? mergeLines(current, [line]) : current));
          setArticleNotices((current) => {
            const next = new Map(current);
            next.delete(lineId);
            return next;
          });
          markProposalsStale([lineId]);
          return { ok: true };
        } catch (error) {
          if (isLineChanged(error)) return reportLineChanged(lineId, error, "L’article n’a pas pu être délié.");
          return { ok: false, message: materialRequestErrorMessage(error, "L’article n’a pas pu être délié.") };
        }
      },
    }),
    [
      enqueue,
      holdsUnsavedChange,
      markProposalsStale,
      projectId,
      publishLineChanges,
      reportLineChanged,
      requestId,
      resync,
      run,
      setConflict,
      settleArticleLink,
    ],
  );

  const proposalsOf = useCallback(
    (lineId: string): LineProposals => {
      if (proposals.status === "error") return { status: "error" };
      if (staleProposals === "all" || staleProposals.has(lineId)) return { status: "stale" };
      if (proposals.status === "loading") return { status: "loading" };
      return { status: "ready", candidates: proposals.lines[lineId] ?? [] };
    },
    [proposals, staleProposals],
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
  const dismissWithheld = useCallback(() => setWithheld(null), []);

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
      lineChanges,
      forgetLineFailure,
      withheld,
      dismissWithheld,
      articles: data.articles ?? {},
      proposalsOf,
      retryProposals,
      articleNotices,
      articleConflicts,
      ...actions,
    },
  };
}
