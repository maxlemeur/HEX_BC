"use client";

import { useEffect, useRef, useState } from "react";

import { coverageCanonicalRequestSchema, coverageMutationResultSchema, coveragePreviewSchema, coverageWorkspaceSchema, type CoverageCitation, type CoverageMutationResult, type CoveragePreview, type CoverageWorkspace } from "@/lib/estimates/source-coverage-contracts";
import { sourceReferenceReviewSchema } from "@/lib/estimates/source-reference-contracts";
import { readSourceReferencePdf, sourceReferenceJson, SourceReferenceRequestError } from "@/components/estimates/source-reference/source-reference-client";
import type { SourceReferenceScope } from "@/components/estimates/source-reference/source-reference-state";

import { commandPath, coverageJson, readCoverageIntent, saveCoverageIntent, type CoverageCommand } from "./source-coverage-client";

type Viewer = { url: string; copyId: string; sha256: string; fileName: string; page: number; citationId: string; requirementRevision: number };

export function useSourceCoverage(scope: SourceReferenceScope, initialWorkspace: CoverageWorkspace) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [busy, setBusy] = useState<string | null>("initializing");
  const [failure, setFailure] = useState<{ message: string; code: string | null } | null>(null);
  const [workspaceUnavailable, setWorkspaceUnavailable] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [pending, setPending] = useState<CoverageCommand | null>(null);
  const [receipt, setReceipt] = useState<Pick<CoverageMutationResult, "receipt" | "replayed"> | null>(null);
  const [preview, setPreview] = useState<CoveragePreview | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [humanVerified, setHumanVerified] = useState(false);
  const workspaceRef = useRef(workspace);
  const pendingRef = useRef(pending);
  const operation = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const endpoint = `/api/estimates/${scope.versionId}/source-review/requirements`;

  function closeViewer() {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setViewer(null);
    setHumanVerified(false);
  }
  function invalidatePreview() { setPreview(null); setHumanVerified(false); }
  function persist(command: CoverageCommand | null) {
    try { saveCoverageIntent(scope, command); pendingRef.current = command; setPending(command); setStorageError(null); return true; }
    catch { setStorageError("La reprise ne peut pas être conservée dans cet onglet. Réactivez le stockage de session puis réessayez. Aucune nouvelle demande ne sera envoyée sans conservation de son intention."); return false; }
  }
  function accept(next: CoverageWorkspace, mode: "replace" | "list" | "history" = "replace") {
    if (next.versionId !== scope.versionId || next.projectId !== workspaceRef.current.projectId) throw new Error("La réponse concerne un autre chiffrage.");
    const previous = workspaceRef.current;
    const sameReference = previous.referenceRevision === next.referenceRevision;
    setPreview(null);
    if (!sameReference || previous.selectedRequirement?.revision !== next.selectedRequirement?.revision || previous.selectedRequirement?.id !== next.selectedRequirement?.id) { setPreview(null); closeViewer(); }
    const merged = mode === "list" && sameReference ? { ...next, requirements: [...previous.requirements, ...next.requirements.filter((item) => !previous.requirements.some((old) => old.id === item.id))] }
      : mode === "history" && sameReference ? { ...next, history: [...previous.history, ...next.history.filter((item) => !previous.history.some((old) => old.id === item.id))] } : next;
    workspaceRef.current = merged;
    setWorkspace(merged);
    setWorkspaceUnavailable(false);
  }
  async function run(kind: string, work: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPreview(null);
    setBusy(kind); setFailure(null);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 75_000);
    const current = () => operation.current === controller && !controller.signal.aborted;
    try { await work(controller.signal, current); }
    catch (error) {
      if (current()) {
        setPreview(null); setHumanVerified(false);
        setWorkspaceUnavailable(true);
        setFailure({ message: error instanceof Error ? error.message : "La lecture est indisponible. Réessayez.", code: error instanceof SourceReferenceRequestError ? error.code : null });
      }
    } finally {
      clearTimeout(timer);
      if (operation.current === controller) {
        if (timedOut) { setPreview(null); setHumanVerified(false); setWorkspaceUnavailable(true); setFailure({ message: "Le délai de réponse est dépassé. Si un enregistrement était en cours, reprenez la même intention pour vérifier son résultat.", code: null }); }
        operation.current = null; setBusy(null);
      }
    }
  }
  async function read(signal: AbortSignal, current: () => boolean, params: URLSearchParams, mode: "replace" | "list" | "history" = "replace") {
    const next = await coverageJson(`${endpoint}?${params}`, coverageWorkspaceSchema, signal);
    if (current()) accept(next, mode);
  }
  function refresh(requirementId = workspaceRef.current.selectedRequirement?.id) {
    return run("read", async (signal, current) => {
      const query = new URLSearchParams({ limit: "20" });
      if (requirementId) query.set("requirementId", requirementId);
      await read(signal, current, query);
    });
  }
  function more(kind: "list" | "history") {
    return run(kind, async (signal, current) => {
      const value = workspaceRef.current;
      const query = new URLSearchParams({ limit: "20" });
      if (value.selectedRequirement) query.set("requirementId", value.selectedRequirement.id);
      if (kind === "list" && value.nextAfterId) query.set("afterId", value.nextAfterId);
      else if (kind === "history" && value.nextBeforeEvent) query.set("beforeEvent", String(value.nextBeforeEvent));
      else return;
      await read(signal, current, query, kind);
    });
  }
  function mutate(command?: CoverageCommand) {
    return run("mutation", async (signal, current) => {
      const candidate = command ?? pendingRef.current;
      if (!candidate) return;
      const next = coverageCanonicalRequestSchema.parse(candidate);
      if (command && pendingRef.current) throw new Error("Une intention attend son résultat. Reprenez-la ou abandonnez-la explicitement avant une autre action.");
      if (!persist(next)) return;
      setPreview(null);
      const result = await coverageJson(commandPath(endpoint, next), coverageMutationResultSchema, signal, next.request);
      if (!current()) return;
      if (JSON.stringify(result.receipt.canonicalRequest) !== JSON.stringify(next)) throw new Error("Le reçu ne correspond pas à la demande conservée. Reprenez la même intention.");
      setReceipt(result);
      persist(null);
      const query = new URLSearchParams({ limit: "20" });
      const selected = next.kind === "dimension" ? workspaceRef.current.selectedRequirement?.id : next.request.requirementId;
      if (selected) query.set("requirementId", selected);
      await read(signal, current, query);
    });
  }
  function abandon() {
    return run("read", async (signal, current) => {
      const query = new URLSearchParams({ limit: "20" });
      const saved = pendingRef.current;
      if (saved) query.set("operationKey", saved.request.operationKey);
      const unknownCreate = saved?.kind === "requirement" && saved.request.operation === "create";
      const selected = saved && saved.kind !== "dimension" ? saved.request.requirementId : workspaceRef.current.selectedRequirement?.id;
      if (selected && !unknownCreate) query.set("requirementId", selected);
      const next = await coverageJson(`${endpoint}?${query}`, coverageWorkspaceSchema, signal);
      if (!current()) return;
      if (next.receipt && (!saved || JSON.stringify(next.receipt.canonicalRequest) !== JSON.stringify(saved))) throw new Error("Le reçu retrouvé ne correspond pas à la demande conservée. La reprise n’a pas été effacée.");
      accept(next);
      setReceipt(next.receipt ? { receipt: next.receipt, replayed: true } : null);
      persist(null);
      setPreview(null);
    });
  }
  function prepareDecision(requirementId: string) {
    return run("preview", async (signal, current) => {
      setPreview(null);
      const value = await coverageJson(`${endpoint}/${requirementId}/preview`, coveragePreviewSchema, signal);
      if (!current()) return;
      if (value.requirementId !== requirementId || value.requirementRevision !== workspaceRef.current.selectedRequirement?.revision || value.referenceRevision !== workspaceRef.current.referenceRevision) throw new Error("L’exigence ou la référence a changé. Actualisez avant de préparer une décision.");
      setPreview(value);
    });
  }
  function consult(citation: CoverageCitation, requirementRevision: number) {
    return run("pdf", async (signal, current) => {
      closeViewer();
      const review = await sourceReferenceJson(`/api/estimates/${scope.versionId}/source-review?copyId=${citation.copyId}&limit=1`, sourceReferenceReviewSchema, signal);
      const copy = review.selectedCopy;
      if (review.versionId !== scope.versionId || copy?.state !== "verified" || copy.copyId !== citation.copyId || citation.page > copy.pageCount) throw new Error("Cette citation ne correspond pas à une page consultable de la copie conservée.");
      const blob = await readSourceReferencePdf(scope.versionId, copy, signal);
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      setViewer({ url, copyId: copy.copyId, sha256: copy.sha256, fileName: copy.fileName, page: citation.page, citationId: citation.id, requirementRevision });
    });
  }
  function verify(citation: CoverageCitation) {
    const selected = workspaceRef.current.selectedRequirement;
    if (!selected || !viewer || !humanVerified || viewer.citationId !== citation.id || viewer.copyId !== workspaceRef.current.activeCopyId || viewer.requirementRevision !== selected.revision) return;
    return mutate({ kind: "citation", actorId: scope.actorId, versionId: scope.versionId, request: { requirementId: selected.id, citationId: citation.id,
      expectedRequirementRevision: selected.revision, expectedReferenceRevision: workspaceRef.current.referenceRevision, reviewedSha256: viewer.sha256, operationKey: crypto.randomUUID() } });
  }
  function retryStorage() {
    try { const value = readCoverageIntent(scope); pendingRef.current = value; setPending(value); setStorageError(null); }
    catch { setStorageError("La reprise conservée est illisible ou le stockage est indisponible. Aucun POST n’a été envoyé."); }
  }
  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(() => { if (!disposed) { retryStorage(); setBusy(null); } });
    return () => { disposed = true; operation.current?.abort(); operation.current = null; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); };
    // The server remounts the island whenever actor, tenant or version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { workspace, busy, failure, workspaceUnavailable, storageError, pending, receipt, preview, viewer, humanVerified, setHumanVerified,
    refresh, more, mutate, abandon, prepareDecision, consult, verify, closeViewer, invalidatePreview, retryStorage };
}
