"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { AffaireIntakeWorkspace as WorkspaceData } from "@/lib/affaires/intake-server";
import { Badge } from "@/components/ui/Badge";
import { IntakeDropzone } from "./IntakeDropzone";
import { IntakeDocumentCard } from "./IntakeDocumentCard";
import { IntakeMissingPieces } from "./IntakeMissingPieces";

type IntakeWorkspaceProps = {
  projectId: string;
  workspace: WorkspaceData | null;
};

const FILTER_PARAM = "intakeFilter";
const FILTER_A_REVOIR = "a_revoir";
const AUTO_REFRESH_INTERVAL_MS = 4_000;
const AUTO_REFRESH_MAX_MS = 60_000;
const UPLOAD_REFRESH_INTERVAL_MS = 2_000;
const UPLOAD_REFRESH_MAX_ATTEMPTS = 15;

function isDocumentProcessing(doc: WorkspaceData["documents"][number]) {
  return doc.confidence === 0 && doc.detectedCategory === "a_classer" && doc.issues.length === 0;
}

function isDocumentNeedsReview(doc: WorkspaceData["documents"][number]) {
  return (
    (doc.detectedCategory === "a_classer" || doc.confidence < 0.65) &&
    !isDocumentProcessing(doc)
  );
}

export function IntakeWorkspace({ projectId, workspace }: IntakeWorkspaceProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showDropzone, setShowDropzone] = useState(!workspace?.uploadId);
  const [announcement, setAnnouncement] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(
    searchParams.get(FILTER_PARAM)
  );
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null);
  const [classifiedExpanded, setClassifiedExpanded] = useState(false);

  const isFilterActive = activeFilter === FILTER_A_REVOIR;

  const handleUploadComplete = useCallback((uploadId: string) => {
    setShowDropzone(false);
    setPendingUploadId(uploadId);
    setAnnouncement("Upload termine. Actualisation du workspace...");
    router.refresh();
  }, [router]);

  const handleReclassified = useCallback(() => {
    router.refresh();
  }, [router]);

  // Auto-refresh while documents are still being classified
  const autoRefreshStartRef = useRef<number | null>(null);
  const hasProcessingDocs = workspace?.documents.some(isDocumentProcessing) ?? false;

  useEffect(() => {
    setActiveFilter(searchParams.get(FILTER_PARAM));
  }, [searchParams]);

  useEffect(() => {
    if (!hasProcessingDocs) {
      autoRefreshStartRef.current = null;
      return;
    }

    if (autoRefreshStartRef.current === null) {
      autoRefreshStartRef.current = Date.now();
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - (autoRefreshStartRef.current ?? Date.now());
      if (elapsed > AUTO_REFRESH_MAX_MS) {
        clearInterval(interval);
        setAnnouncement("La classification prend plus de temps que prevu. Rafraichissez la page manuellement.");
        return;
      }
      router.refresh();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [hasProcessingDocs, router]);

  useEffect(() => {
    if (!pendingUploadId) {
      return;
    }

    if (workspace?.uploadId === pendingUploadId) {
      setPendingUploadId(null);
      setAnnouncement("");
      return;
    }

    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      router.refresh();

      if (attempts >= UPLOAD_REFRESH_MAX_ATTEMPTS) {
        clearInterval(interval);
        setPendingUploadId(null);
        setAnnouncement(
          "L'upload est termine mais le workspace n'est pas encore a jour. Rafraichissez la page si necessaire."
        );
      }
    }, UPLOAD_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [pendingUploadId, router, workspace?.uploadId]);

  const documents = useMemo(() => workspace?.documents ?? [], [workspace?.documents]);
  const needsReviewCount = documents.filter(isDocumentNeedsReview).length;
  const processingCount = documents.filter(isDocumentProcessing).length;
  const hasDocuments = documents.length > 0;

  // Grouped document lists
  const processingDocs = useMemo(() => documents.filter(isDocumentProcessing), [documents]);
  const reviewDocs = useMemo(() => documents.filter(isDocumentNeedsReview), [documents]);
  const classifiedDocs = useMemo(
    () => documents.filter((d) => !isDocumentProcessing(d) && !isDocumentNeedsReview(d)),
    [documents]
  );
  const classifiedCount = classifiedDocs.length;

  // For filter mode, only show reviewDocs (same behaviour as before)
  const filteredDocuments = isFilterActive ? reviewDocs : documents;

  // Missing pieces: check if any critical
  const hasCriticalMissing = workspace?.missingPieces.some((p) => p.severity === "critical") ?? false;

  // Progress bar segments
  const { classifiedPct, reviewPct, processingPct } = useMemo(() => {
    const total = documents.length;
    if (total === 0) return { classifiedPct: 0, reviewPct: 0, processingPct: 0 };
    return {
      classifiedPct: (classifiedCount / total) * 100,
      reviewPct: (needsReviewCount / total) * 100,
      processingPct: (processingCount / total) * 100,
    };
  }, [documents.length, classifiedCount, needsReviewCount, processingCount]);

  // Triage complete?
  const triageComplete = hasDocuments && processingCount === 0 && needsReviewCount === 0 && !hasCriticalMissing;

  const toggleFilter = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (activeFilter === FILTER_A_REVOIR) {
      params.delete(FILTER_PARAM);
      setActiveFilter(null);
    } else {
      params.set(FILTER_PARAM, FILTER_A_REVOIR);
      setActiveFilter(FILTER_A_REVOIR);
    }

    const query = params.toString();
    const nextUrl = query ? `${pathname}?${query}` : pathname;

    window.history.replaceState(window.history.state, "", nextUrl);
  }, [activeFilter, pathname, searchParams]);

  // Legend text for progress bar
  const progressLegend = useMemo(() => {
    const parts: string[] = [];
    if (classifiedCount > 0) parts.push(`${classifiedCount} valide${classifiedCount > 1 ? "s" : ""}`);
    if (needsReviewCount > 0) parts.push(`${needsReviewCount} a confirmer`);
    if (processingCount > 0) parts.push(`${processingCount} en cours`);
    return parts.join(", ");
  }, [classifiedCount, needsReviewCount, processingCount]);

  return (
    <section className="dashboard-card p-5 animate-fade-in" aria-label="Intake dossier affaire">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Triage du dossier
          </h2>
          {hasDocuments && (
            <p className="mt-0.5 text-xs text-[var(--slate-500)]">
              {documents.length} document{documents.length > 1 ? "s" : ""}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* "A revoir" filter toggle */}
          {needsReviewCount > 0 && (
            <button
              type="button"
              onClick={toggleFilter}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                isFilterActive
                  ? "bg-[var(--warning)]/10 text-[var(--warning)] ring-1 ring-[var(--warning)]/30"
                  : "text-[var(--slate-600)] hover:bg-[var(--slate-100)]"
              }`}
              aria-pressed={isFilterActive}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              A revoir ({needsReviewCount})
            </button>
          )}

          {/* Add files button */}
          {hasDocuments && (
            <button
              type="button"
              onClick={() => setShowDropzone((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--brand-blue)] transition-colors hover:bg-[var(--brand-blue)]/5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" x2="12" y1="5" y2="19" />
                <line x1="5" x2="19" y1="12" y2="12" />
              </svg>
              {showDropzone ? "Masquer" : "Ajouter des fichiers"}
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {hasDocuments && (
        <div className="mb-4">
          <div
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--slate-100)]"
            role="progressbar"
            aria-valuenow={classifiedCount}
            aria-valuemin={0}
            aria-valuemax={documents.length}
            aria-label={`Triage : ${progressLegend}`}
          >
            {classifiedPct > 0 && (
              <div
                className="h-full bg-[var(--success)] transition-all duration-500"
                style={{ width: `${classifiedPct}%` }}
              />
            )}
            {reviewPct > 0 && (
              <div
                className="h-full bg-[var(--warning)] transition-all duration-500"
                style={{ width: `${reviewPct}%` }}
              />
            )}
            {processingPct > 0 && (
              <div
                className="h-full bg-[var(--brand-blue)] transition-all duration-500"
                style={{ width: `${processingPct}%` }}
              />
            )}
          </div>
          <p className="mt-1.5 text-xs text-[var(--slate-500)]">{progressLegend}</p>
        </div>
      )}

      {/* Dropzone */}
      {(showDropzone || !hasDocuments) && (
        <div className={hasDocuments ? "mb-4" : ""}>
          <IntakeDropzone
            projectId={projectId}
            onUploadComplete={handleUploadComplete}
            compact={hasDocuments}
          />
        </div>
      )}

      {/* Missing pieces */}
      {workspace && workspace.missingPieces.length > 0 && (
        <div className="mb-4">
          <IntakeMissingPieces pieces={workspace.missingPieces} onAddFile={() => setShowDropzone(true)} />
        </div>
      )}

      {/* Grouped document sections */}
      {!isFilterActive && hasDocuments && (
        <>
          {/* En cours d'analyse */}
          {processingDocs.length > 0 && (
            <section aria-label="Documents en cours d'analyse" className="mt-4">
              <div className="flex items-center gap-2 rounded-lg bg-blue-100 border border-blue-300 px-3 py-2 mb-2">
                <svg className="h-4 w-4 animate-spin shrink-0 text-blue-700" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                </svg>
                <h3 className="text-xs font-semibold text-blue-900">En cours d&apos;analyse</h3>
                <Badge variant="info" size="sm">{processingDocs.length}</Badge>
              </div>
              <div className="space-y-2">
                {processingDocs.map((doc) => (
                  <IntakeDocumentCard
                    key={doc.documentId}
                    document={doc}
                    projectId={projectId}
                    onReclassified={handleReclassified}
                  />
                ))}
              </div>
            </section>
          )}

          {/* A confirmer */}
          {reviewDocs.length > 0 && (
            <section aria-label="Documents a confirmer" className="mt-4">
              <div className="flex items-center gap-2 rounded-lg bg-amber-100 border border-amber-400 px-3 py-2 mb-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-700" aria-hidden="true">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" x2="12" y1="9" y2="13" />
                  <line x1="12" x2="12.01" y1="17" y2="17" />
                </svg>
                <h3 className="text-xs font-semibold text-amber-900">A confirmer</h3>
                <Badge variant="warning" size="sm">{reviewDocs.length}</Badge>
              </div>
              <div className="space-y-2">
                {reviewDocs.map((doc) => (
                  <IntakeDocumentCard
                    key={doc.documentId}
                    document={doc}
                    projectId={projectId}
                    onReclassified={handleReclassified}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Classes — collapsible, compact by default */}
          {classifiedDocs.length > 0 && (
            <section aria-label="Documents valides" className="mt-4">
              <button
                type="button"
                onClick={() => setClassifiedExpanded((v) => !v)}
                className="flex w-full items-center gap-2 rounded-lg bg-emerald-100 border border-emerald-400 px-3 py-2 mb-2 text-left"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-700" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <h3 className="flex-1 text-xs font-semibold text-emerald-900">Valides</h3>
                <Badge variant="success" size="sm">{classifiedDocs.length}</Badge>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`shrink-0 text-emerald-700 transition-transform ${classifiedExpanded ? "rotate-180" : ""}`}
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <div className={classifiedExpanded ? "space-y-2" : "space-y-1"}>
                {classifiedDocs.map((doc) => (
                  <IntakeDocumentCard
                    key={doc.documentId}
                    document={doc}
                    projectId={projectId}
                    onReclassified={handleReclassified}
                    compact={!classifiedExpanded}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Filtered mode: show only review docs (same as before) */}
      {isFilterActive && filteredDocuments.length > 0 && (
        <div className="space-y-2">
          {filteredDocuments.map((doc) => (
            <IntakeDocumentCard
              key={doc.documentId}
              document={doc}
              projectId={projectId}
              onReclassified={handleReclassified}
            />
          ))}
        </div>
      )}

      {/* Empty filter state */}
      {isFilterActive && filteredDocuments.length === 0 && hasDocuments && (
        <div className="py-6 text-center">
          <p className="text-sm text-[var(--slate-500)]">
            Tous les documents sont correctement valides.
          </p>
          <button
            type="button"
            onClick={toggleFilter}
            className="mt-2 text-xs font-medium text-[var(--brand-blue)] hover:underline"
          >
            Voir tous les documents
          </button>
        </div>
      )}

      {/* CTA: Triage status */}
      {hasDocuments && triageComplete && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--success)]/20 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          Triage termine — Tous les documents sont valides.
        </div>
      )}
      {hasDocuments && !triageComplete && (needsReviewCount > 0 || processingCount > 0) && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-2 text-sm text-[var(--slate-600)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" x2="12" y1="8" y2="12" />
            <line x1="12" x2="12.01" y1="16" y2="16" />
          </svg>
          <span>
            Triage en cours — {needsReviewCount + processingCount} document{(needsReviewCount + processingCount) > 1 ? "s" : ""} restent a confirmer.
            {!isFilterActive && needsReviewCount > 0 && (
              <button
                type="button"
                onClick={toggleFilter}
                className="ml-1 font-medium text-[var(--brand-blue)] hover:underline"
              >
                Filtrer
              </button>
            )}
          </span>
        </div>
      )}

      {/* Live announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </section>
  );
}
