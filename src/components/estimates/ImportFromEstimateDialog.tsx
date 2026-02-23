"use client";

import { useEffect, useMemo, useState } from "react";

import { formatEUR } from "@/lib/money";
import {
  fetchEstimateImportableSections,
  fetchEstimateImportSources,
  type EstimateImportSectionPreview,
  type EstimateImportSourceVersion,
  type ImportEstimateSectionsMode,
  type ImportEstimateSectionsPayload,
} from "@/lib/estimates/client";

type ImportFromEstimateDialogProps = {
  isOpen: boolean;
  targetVersionId: string;
  onClose: () => void;
  onConfirm: (input: ImportEstimateSectionsPayload) => Promise<void>;
};

function formatSourceLabel(source: EstimateImportSourceVersion) {
  const title = source.title?.trim();
  const base = `V${source.versionNumber} - ${source.projectName}`;
  if (title && title.length > 0) {
    return `${base} - ${title}`;
  }
  return `${base} - Sans titre`;
}

function statusLabel(status: EstimateImportSourceVersion["status"]) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoye";
    case "accepted":
      return "Accepte";
    case "archived":
      return "Archive";
    default:
      return status;
  }
}

export function ImportFromEstimateDialog({
  isOpen,
  targetVersionId,
  onClose,
  onConfirm,
}: ImportFromEstimateDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sources, setSources] = useState<EstimateImportSourceVersion[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [selectedSourceVersionId, setSelectedSourceVersionId] = useState("");
  const [sections, setSections] = useState<EstimateImportSectionPreview[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [mode, setMode] = useState<ImportEstimateSectionsMode>("append");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let active = true;
    async function loadSources() {
      setIsLoadingSources(true);
      setSourcesError(null);
      setSubmitError(null);

      try {
        const items = await fetchEstimateImportSources({
          excludeVersionId: targetVersionId,
        });
        if (!active) return;
        setSources(items);
        setSelectedSourceVersionId(items[0]?.id ?? "");
      } catch (error) {
        if (!active) return;
        setSourcesError(
          error instanceof Error
            ? error.message
            : "Impossible de charger les devis sources."
        );
        setSources([]);
        setSelectedSourceVersionId("");
      } finally {
        if (!active) return;
        setIsLoadingSources(false);
      }
    }

    void loadSources();

    return () => {
      active = false;
    };
  }, [isOpen, targetVersionId]);

  useEffect(() => {
    if (!isOpen || !selectedSourceVersionId) {
      return;
    }

    let active = true;
    async function loadSections() {
      setIsLoadingSections(true);
      setSectionsError(null);
      setSubmitError(null);

      try {
        const items = await fetchEstimateImportableSections(selectedSourceVersionId);
        if (!active) return;
        setSections(items);
        setSelectedSectionIds(items.map((item) => item.id));
      } catch (error) {
        if (!active) return;
        setSectionsError(
          error instanceof Error
            ? error.message
            : "Impossible de charger les sections importables."
        );
        setSections([]);
        setSelectedSectionIds([]);
      } finally {
        if (!active) return;
        setIsLoadingSections(false);
      }
    }

    void loadSections();

    return () => {
      active = false;
    };
  }, [isOpen, selectedSourceVersionId]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceVersionId) ?? null,
    [selectedSourceVersionId, sources]
  );

  const selectedSectionSet = useMemo(
    () => new Set(selectedSectionIds),
    [selectedSectionIds]
  );

  const selectedSections = useMemo(
    () => sections.filter((section) => selectedSectionSet.has(section.id)),
    [sections, selectedSectionSet]
  );

  const selectedSummary = useMemo(() => {
    return selectedSections.reduce(
      (acc, section) => ({
        sectionCount: acc.sectionCount + 1,
        lineCount: acc.lineCount + section.lineCount,
        totalHtCents: acc.totalHtCents + section.totalHtCents,
      }),
      {
        sectionCount: 0,
        lineCount: 0,
        totalHtCents: 0,
      }
    );
  }, [selectedSections]);

  const canGoNextFromStep1 =
    !isLoadingSources &&
    !sourcesError &&
    sources.length > 0 &&
    selectedSourceVersionId.length > 0;
  const canGoNextFromStep2 =
    !isLoadingSections &&
    !sectionsError &&
    sections.length > 0 &&
    selectedSectionIds.length > 0;
  const canSubmit = selectedSectionIds.length > 0 && !isSubmitting;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4">
      <div
        className="dashboard-card w-full max-w-3xl p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-estimate-dialog-title"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2
              id="import-estimate-dialog-title"
              className="text-lg font-semibold text-[var(--slate-800)]"
            >
              Importer depuis un autre devis
            </h2>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Etape {step} / 3
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Fermer
          </button>
        </div>

        {step === 1 ? (
          <div className="space-y-4">
            {isLoadingSources ? (
              <div className="alert alert-info">Chargement des devis sources...</div>
            ) : null}
            {sourcesError ? <div className="alert alert-error">{sourcesError}</div> : null}
            {!isLoadingSources && !sourcesError && sources.length === 0 ? (
              <div className="alert alert-info">
                Aucun devis source disponible pour ce tenant.
              </div>
            ) : null}
            {!isLoadingSources && !sourcesError && sources.length > 0 ? (
              <label className="form-label block">
                Devis source
                <select
                  className="input mt-2 w-full"
                  value={selectedSourceVersionId}
                  onChange={(event) =>
                    setSelectedSourceVersionId(event.target.value)
                  }
                >
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {formatSourceLabel(source)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {selectedSource ? (
              <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4 text-sm text-[var(--slate-700)]">
                <p className="font-medium text-[var(--slate-800)]">
                  {formatSourceLabel(selectedSource)}
                </p>
                <p className="mt-1">
                  Statut: {statusLabel(selectedSource.status)} · Total HT:{" "}
                  {formatEUR(selectedSource.totalHtCents)}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            {isLoadingSections ? (
              <div className="alert alert-info">Chargement des sections...</div>
            ) : null}
            {sectionsError ? <div className="alert alert-error">{sectionsError}</div> : null}
            {!isLoadingSections && !sectionsError && sections.length === 0 ? (
              <div className="alert alert-info">
                Ce devis source ne contient aucune section importable.
              </div>
            ) : null}
            {!isLoadingSections && !sectionsError && sections.length > 0 ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-[var(--slate-600)]">
                    Selectionnez une ou plusieurs sections a importer.
                  </p>
                  <label className="inline-flex items-center gap-2 text-sm text-[var(--slate-700)]">
                    <input
                      type="checkbox"
                      checked={selectedSectionIds.length === sections.length}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedSectionIds(sections.map((section) => section.id));
                          return;
                        }
                        setSelectedSectionIds([]);
                      }}
                    />
                    Tout selectionner
                  </label>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--slate-200)]">
                  {sections.map((section) => (
                    <label
                      key={section.id}
                      className="flex items-center justify-between gap-3 border-b border-[var(--slate-100)] px-4 py-3 text-sm last:border-b-0"
                    >
                      <span className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedSectionSet.has(section.id)}
                          onChange={(event) => {
                            setSelectedSectionIds((previous) => {
                              if (event.target.checked) {
                                if (previous.includes(section.id)) return previous;
                                return [...previous, section.id];
                              }
                              return previous.filter((id) => id !== section.id);
                            });
                          }}
                        />
                        <span className="font-medium text-[var(--slate-800)]">
                          {section.title}
                        </span>
                      </span>
                      <span className="text-[var(--slate-600)]">
                        {section.lineCount} ligne(s) · {formatEUR(section.totalHtCents)}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4 text-sm text-[var(--slate-700)]">
                  Selection: {selectedSummary.sectionCount} section(s),{" "}
                  {selectedSummary.lineCount} ligne(s), total HT{" "}
                  {formatEUR(selectedSummary.totalHtCents)}.
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4 text-sm text-[var(--slate-700)]">
              <p className="font-medium text-[var(--slate-800)]">
                Recapitulatif
              </p>
              <p className="mt-1">
                Source: {selectedSource ? formatSourceLabel(selectedSource) : "-"}
              </p>
              <p className="mt-1">
                Sections: {selectedSummary.sectionCount} · Lignes:{" "}
                {selectedSummary.lineCount} · Total HT:{" "}
                {formatEUR(selectedSummary.totalHtCents)}
              </p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-[var(--slate-800)]">
                Gestion des conflits de titre
              </legend>
              <label className="flex items-start gap-2 rounded-lg border border-[var(--slate-200)] p-3 text-sm">
                <input
                  type="radio"
                  name="import-mode"
                  value="append"
                  checked={mode === "append"}
                  onChange={() => setMode("append")}
                />
                <span>
                  <span className="font-medium text-[var(--slate-800)]">Append</span>
                  <span className="block text-[var(--slate-600)]">
                    Cree toujours une nouvelle section (suffixe &quot;(import)&quot; en cas
                    de conflit de titre).
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-[var(--slate-200)] p-3 text-sm">
                <input
                  type="radio"
                  name="import-mode"
                  value="merge"
                  checked={mode === "merge"}
                  onChange={() => setMode("merge")}
                />
                <span>
                  <span className="font-medium text-[var(--slate-800)]">Merge</span>
                  <span className="block text-[var(--slate-600)]">
                    Ajoute les lignes dans la section existante de meme titre, ou
                    cree la section si absente.
                  </span>
                </span>
              </label>
            </fieldset>

            {submitError ? <div className="alert alert-error">{submitError}</div> : null}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Annuler
          </button>
          {step > 1 ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3) : current))}
              disabled={isSubmitting}
            >
              Retour
            </button>
          ) : null}
          {step < 3 ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (step === 1 && canGoNextFromStep1) {
                  setStep(2);
                  return;
                }
                if (step === 2 && canGoNextFromStep2) {
                  setStep(3);
                }
              }}
              disabled={
                (step === 1 && !canGoNextFromStep1) ||
                (step === 2 && !canGoNextFromStep2)
              }
            >
              Continuer
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSubmitError(null);
                setIsSubmitting(true);
                void onConfirm({
                  sourceVersionId: selectedSourceVersionId,
                  sectionIds: selectedSectionIds,
                  mode,
                })
                  .then(() => {
                    onClose();
                  })
                  .catch((error) => {
                    setSubmitError(
                      error instanceof Error
                        ? error.message
                        : "Impossible d'importer les sections."
                    );
                  })
                  .finally(() => {
                    setIsSubmitting(false);
                  });
              }}
              disabled={!canSubmit}
            >
              {isSubmitting ? "Import..." : "Importer"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
