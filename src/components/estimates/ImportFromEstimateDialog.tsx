"use client";

import { useEffect, useMemo, useState } from "react";

import { LoadingState } from "@/components/layout/loading-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
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
      return "Envoyé";
    case "accepted":
      return "Accepté";
    case "archived":
      return "Archivé";
    default:
      return status;
  }
}

const IMPORT_MODE_OPTIONS: Array<{
  value: ImportEstimateSectionsMode;
  label: string;
  description: string;
}> = [
  {
    value: "append",
    label: "Ajouter à la suite",
    description:
      "Crée toujours une nouvelle section (suffixe « (import) » en cas de conflit de titre).",
  },
  {
    value: "merge",
    label: "Fusionner",
    description:
      "Ajoute les lignes dans la section existante de même titre, ou crée la section si elle est absente.",
  },
];

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

  return (
    <Dialog
      open={isOpen}
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <DialogContent size="xl" className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importer depuis un autre devis</DialogTitle>
          <DialogDescription>Étape {step} / 3</DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <DialogBody>
            {isLoadingSources ? (
              <LoadingState label="Chargement des devis sources…" className="py-6" />
            ) : null}
            {sourcesError ? <Alert variant="danger">{sourcesError}</Alert> : null}
            {!isLoadingSources && !sourcesError && sources.length === 0 ? (
              <Alert variant="info">
                Aucun devis source disponible pour cette organisation.
              </Alert>
            ) : null}
            {!isLoadingSources && !sourcesError && sources.length > 0 ? (
              <div className="grid gap-2">
                <FieldLabel htmlFor="import-estimate-source">Devis source</FieldLabel>
                <NativeSelect
                  id="import-estimate-source"
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
                </NativeSelect>
              </div>
            ) : null}
            {selectedSource ? (
              <div className="rounded-lg border border-border bg-surface-subtle p-4 text-sm text-foreground-secondary">
                <p className="font-medium text-foreground">
                  {formatSourceLabel(selectedSource)}
                </p>
                <p className="mt-1">
                  Statut : {statusLabel(selectedSource.status)} · Total HT :{" "}
                  {formatEUR(selectedSource.totalHtCents)}
                </p>
              </div>
            ) : null}
          </DialogBody>
        ) : null}

        {step === 2 ? (
          <DialogBody>
            {isLoadingSections ? (
              <LoadingState label="Chargement des sections…" className="py-6" />
            ) : null}
            {sectionsError ? <Alert variant="danger">{sectionsError}</Alert> : null}
            {!isLoadingSections && !sectionsError && sections.length === 0 ? (
              <Alert variant="info">
                Ce devis source ne contient aucune section importable.
              </Alert>
            ) : null}
            {!isLoadingSections && !sectionsError && sections.length > 0 ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p id="import-estimate-sections-hint" className="text-sm text-foreground-secondary">
                    Sélectionnez une ou plusieurs sections à importer.
                  </p>
                  <label className="inline-flex items-center gap-2 text-sm text-foreground-secondary">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={selectedSectionIds.length === sections.length}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedSectionIds(sections.map((section) => section.id));
                          return;
                        }
                        setSelectedSectionIds([]);
                      }}
                    />
                    Tout sélectionner
                  </label>
                </div>
                <div
                  className="max-h-72 overflow-y-auto rounded-lg border border-border"
                  role="group"
                  aria-labelledby="import-estimate-sections-hint"
                >
                  {sections.map((section) => (
                    <label
                      key={section.id}
                      className="flex cursor-pointer items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 text-sm last:border-b-0 hover:bg-surface-subtle"
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-primary"
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
                        <span className="font-medium text-foreground">
                          {section.title}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-foreground-secondary">
                        {section.lineCount} ligne(s) · {formatEUR(section.totalHtCents)}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="rounded-lg border border-border bg-surface-subtle p-4 text-sm text-foreground-secondary">
                  Sélection : {selectedSummary.sectionCount} section(s),{" "}
                  {selectedSummary.lineCount} ligne(s), total HT{" "}
                  {formatEUR(selectedSummary.totalHtCents)}.
                </div>
              </>
            ) : null}
          </DialogBody>
        ) : null}

        {step === 3 ? (
          <DialogBody>
            <div className="rounded-lg border border-border bg-surface-subtle p-4 text-sm text-foreground-secondary">
              <p className="font-medium text-foreground">
                Récapitulatif
              </p>
              <p className="mt-1">
                Source : {selectedSource ? formatSourceLabel(selectedSource) : "-"}
              </p>
              <p className="mt-1">
                Sections : {selectedSummary.sectionCount} · Lignes :{" "}
                {selectedSummary.lineCount} · Total HT :{" "}
                {formatEUR(selectedSummary.totalHtCents)}
              </p>
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-foreground">
                Gestion des conflits de titre
              </legend>
              {IMPORT_MODE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-surface-subtle"
                >
                  <input
                    type="radio"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    name="import-mode"
                    value={option.value}
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                  />
                  <span>
                    <span className="font-medium text-foreground">{option.label}</span>
                    <span className="block text-foreground-secondary">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {submitError ? <Alert variant="danger">{submitError}</Alert> : null}
          </DialogBody>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            size="lg"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Annuler
          </Button>
          {step > 1 ? (
            <Button
              variant="outline"
              size="lg"
              onClick={() => setStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3) : current))}
              disabled={isSubmitting}
            >
              Retour
            </Button>
          ) : null}
          {step < 3 ? (
            <Button
              size="lg"
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
            </Button>
          ) : (
            <Button
              size="lg"
              loading={isSubmitting}
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
              Importer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
