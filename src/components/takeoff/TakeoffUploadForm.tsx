"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { TakeoffProviderSelect } from "@/components/takeoff/TakeoffProviderSelect";
import type { TakeoffProvider } from "@/lib/takeoff/types";
import { useIsHydrated } from "@/hooks/useIsHydrated";

import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  validateFileForUpload,
} from "@/lib/file-validation";
import {
  TAKEOFF_LEVEL_BUSINESS_LABELS,
  classifyTakeoffUploadSource,
  getTakeoffSelectionWarning,
  isTakeoffLevelCompatible,
  type TakeoffDocumentRecommendation,
} from "@/lib/takeoff/document-classifier";
import {
  createTakeoffJob,
  isTakeoffApiError,
  type TakeoffLevel,
} from "@/lib/takeoff/client";
import { validateTakeoffPdfUploadMetadata } from "@/lib/takeoff/pdf-validation";
import { LoaderCircleIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";

const TAKEOFF_LEVEL_OPTIONS = [
  {
    level: "A" as const,
    label: "Niveau A",
    description: "Import de metrage structure",
  },
  {
    level: "B" as const,
    label: "Niveau B",
    description: "Extraction de tableaux PDF",
  },
  {
    level: "C" as const,
    label: "Niveau C",
    description: "Pre-estimation sur plans PDF",
  },
];

const TAKEOFF_UPLOAD_RULES: Record<
  TakeoffLevel,
  {
    allowedExtensions: string[];
    allowedMimeTypes: string[];
    accept: string;
    helperLabel: string;
    intro: string;
  }
> = {
  A: {
    allowedExtensions: ["csv", "xlsx", "xls"],
    allowedMimeTypes: [
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    accept: [
      ".csv",
      ".xlsx",
      ".xls",
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].join(","),
    helperLabel: `Formats supportes: CSV, XLSX, XLS - Max ${MAX_FILE_SIZE_LABEL}`,
    intro: "Importez un fichier metrage structure pour lancer une extraction Niveau A.",
  },
  B: {
    allowedExtensions: ["pdf"],
    allowedMimeTypes: ["application/pdf"],
    accept: [".pdf", "application/pdf"].join(","),
    helperLabel: `Formats supportes: PDF - Max ${MAX_FILE_SIZE_LABEL}`,
    intro: "Importez un PDF pour extraire automatiquement les tableaux et quantités.",
  },
  C: {
    allowedExtensions: ["pdf"],
    allowedMimeTypes: ["application/pdf"],
    accept: [".pdf", "application/pdf"].join(","),
    helperLabel: `Formats supportes: PDF - Max ${MAX_FILE_SIZE_LABEL}`,
    intro: "Importez un plan PDF pour générer une première pre-estimation exploitable.",
  },
};

const TAKEOFF_ALL_LEVELS: TakeoffLevel[] = ["A", "B", "C"];
const TAKEOFF_SUPPORTED_EXTENSIONS = ["csv", "xlsx", "xls", "pdf"];
const TAKEOFF_SUPPORTED_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const TAKEOFF_DOCUMENT_CLASS_LABELS: Record<string, string> = {
  structured: "Metrage structure",
  tabular_pdf: "PDF tabulaire",
  complex_plan: "Plan complexe",
  unsupported: "Document non reconnu",
};

type SubmitState = "idle" | "loading" | "success" | "error";

type TakeoffJobCreateResponse = Awaited<ReturnType<typeof createTakeoffJob>>;

type TakeoffUploadFormProps = {
  versionId: string;
  level?: TakeoffLevel;
  allowedLevels?: TakeoffLevel[];
  onSuccess?: (job: TakeoffJobCreateResponse) => void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
  onClassificationChange?: (
    classification: TakeoffDocumentRecommendation | null,
    context: { fileFingerprint: string }
  ) => void;
  compact?: boolean;
};

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} o`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} Ko`;
  }

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} Mo`;
}

function resolveApiErrorMessage(error: unknown) {
  if (!isTakeoffApiError(error)) {
    return "Une erreur inattendue est survenue pendant le lancement.";
  }

  if (error.status === 400) {
    return "Requête invalide. Vérifiez le fichier puis recommencez.";
  }

  if (error.status === 403) {
    return "Accès refusé. Le module d'extraction est peut-être désactivé pour cette organisation.";
  }

  if (error.status === 409) {
    return "Conflit détecté : cette extraction existe déjà ou la clé d'idempotence est déjà utilisée.";
  }

  if (error.status === 413) {
    return `Le fichier depasse ${MAX_FILE_SIZE_LABEL}.`;
  }

  if (error.status === 422) {
    return error.message || "Le fichier ou le niveau transmis est invalide.";
  }

  if (error.status === 0) {
    return "Erreur réseau pendant l'envoi du fichier.";
  }

  return error.message || "Impossible de lancer l'extraction.";
}

function resolveAllowedLevelOptions(allowedLevels: TakeoffLevel[]) {
  const normalizedAllowedLevels =
    allowedLevels.length > 0 ? allowedLevels : TAKEOFF_ALL_LEVELS;

  if (normalizedAllowedLevels.length === 1 && normalizedAllowedLevels[0] === "A") {
    return TAKEOFF_UPLOAD_RULES.A;
  }

  const supportsStructured = normalizedAllowedLevels.includes("A");
  const supportsPdf =
    normalizedAllowedLevels.includes("B") || normalizedAllowedLevels.includes("C");

  if (supportsStructured && supportsPdf) {
    return {
      allowedExtensions: TAKEOFF_SUPPORTED_EXTENSIONS,
      allowedMimeTypes: TAKEOFF_SUPPORTED_MIME_TYPES,
      accept: [
        ".csv",
        ".xlsx",
        ".xls",
        ".pdf",
        "text/csv",
        "application/csv",
        "application/pdf",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ].join(","),
      helperLabel: `Formats supportes: CSV, XLSX, XLS, PDF - Max ${MAX_FILE_SIZE_LABEL}`,
      intro:
        "Importez un metrage structure ou un PDF pour obtenir une recommandation de niveau avant lancement.",
    };
  }

  return TAKEOFF_UPLOAD_RULES.B;
}

function validateTakeoffFileSupport(
  file: File | null,
  allowedLevels: TakeoffLevel[]
): string | null {
  if (!file) {
    return "Aucun fichier sélectionné.";
  }

  if (file.size <= 0) {
    return "Le fichier est vide.";
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `Le fichier depasse ${MAX_FILE_SIZE_LABEL}.`;
  }

  const supportsPdf =
    allowedLevels.includes("B") || allowedLevels.includes("C");
  if (supportsPdf && file.name.trim().toLowerCase().endsWith(".pdf")) {
    const pdfValidation = validateTakeoffPdfUploadMetadata({
      fileName: file.name,
      mimeType: file.type,
      fileSizeBytes: file.size,
      maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
      maxFileSizeLabel: MAX_FILE_SIZE_LABEL,
    });

    if (!pdfValidation.valid) {
      return pdfValidation.message;
    }

    return null;
  }

  const uploadRules = resolveAllowedLevelOptions(allowedLevels);
  const validation = validateFileForUpload(file, {
    allowedExtensions: uploadRules.allowedExtensions,
    allowedMimeTypes: uploadRules.allowedMimeTypes,
    allowEmptyMimeType: true,
  });

  if (validation.valid) {
    return null;
  }

  return validation.error;
}

function resolvePreferredLevel(input: {
  recommendation: TakeoffDocumentRecommendation | null;
  allowedLevels: TakeoffLevel[];
  currentLevel: TakeoffLevel;
  preserveManualSelection: boolean;
}): TakeoffLevel {
  const allowedLevels = input.allowedLevels.length > 0 ? input.allowedLevels : TAKEOFF_ALL_LEVELS;
  const compatibleLevels =
    input.recommendation?.compatibleLevels.filter((level) =>
      allowedLevels.includes(level)
    ) ?? allowedLevels;
  const recommendedLevel = input.recommendation?.recommendedLevel;

  if (!compatibleLevels.includes(input.currentLevel)) {
    if (recommendedLevel && compatibleLevels.includes(recommendedLevel)) {
      return recommendedLevel;
    }

    return compatibleLevels[0] ?? allowedLevels[0] ?? "A";
  }

  if (!input.preserveManualSelection && recommendedLevel && compatibleLevels.includes(recommendedLevel)) {
    return recommendedLevel;
  }

  return input.currentLevel;
}

export function TakeoffUploadForm({
  versionId,
  level,
  allowedLevels,
  onSuccess,
  onSubmittingChange,
  onClassificationChange,
  compact,
}: TakeoffUploadFormProps) {
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isSubmittingRef = useRef(false);
  const normalizedAllowedLevels =
    allowedLevels && allowedLevels.length > 0 ? allowedLevels : TAKEOFF_ALL_LEVELS;
  const initialLevel =
    level && normalizedAllowedLevels.includes(level)
      ? level
      : normalizedAllowedLevels[0] ?? "A";

  const [provider, setProvider] = useState<TakeoffProvider>("auto");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileFingerprint, setSelectedFileFingerprint] = useState("");
  const [stableIdempotencyKey, setStableIdempotencyKey] = useState<string | null>(
    null
  );
  const [selectedLevel, setSelectedLevel] = useState<TakeoffLevel>(initialLevel);
  const [manuallySelectedLevel, setManuallySelectedLevel] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [queuedForRecovery, setQueuedForRecovery] = useState(false);
  const [recoveryUnconfirmed, setRecoveryUnconfirmed] = useState(false);
  const controlsDisabled = !isHydrated || submitState === "loading";
  const uploadRules = resolveAllowedLevelOptions(normalizedAllowedLevels);
  const recommendation = useMemo(
    () =>
      selectedFile
        ? classifyTakeoffUploadSource({
            fileName: selectedFile.name,
            mimeType: selectedFile.type,
            sizeBytes: selectedFile.size,
          })
        : null,
    [selectedFile]
  );
  const compatibleLevels = useMemo(
    () =>
      recommendation?.compatibleLevels.filter((optionLevel) =>
        normalizedAllowedLevels.includes(optionLevel)
      ) ?? normalizedAllowedLevels,
    [normalizedAllowedLevels, recommendation]
  );
  const selectionWarning = useMemo(
    () =>
      getTakeoffSelectionWarning({
        recommendation,
        selectedLevel,
      }),
    [recommendation, selectedLevel]
  );
  const canSubmit =
    !controlsDisabled &&
    selectedFile !== null &&
    isTakeoffLevelCompatible(recommendation, selectedLevel);

  const buttonLabel = (() => {
    if (submitState === "loading") {
      return `Envoi en cours (${uploadProgress}%)`;
    }

    if (submitState === "success") {
      if (recoveryUnconfirmed) {
        return "Reprise à vérifier";
      }
      return queuedForRecovery
        ? "Extraction en attente"
        : "Extraction lancée";
    }

    if (submitState === "error") {
      return "Réessayer l'extraction";
    }

    return "Lancer l'extraction";
  })();

  const notifySubmittingChange = useCallback(
    (isSubmitting: boolean) => {
      if (isSubmittingRef.current === isSubmitting) {
        return;
      }

      isSubmittingRef.current = isSubmitting;
      onSubmittingChange?.(isSubmitting);
    },
    [onSubmittingChange]
  );

  useEffect(() => {
    return () => {
      notifySubmittingChange(false);
    };
  }, [notifySubmittingChange]);

  useEffect(() => {
    if (!level || !normalizedAllowedLevels.includes(level)) return;
    setSelectedLevel(level);
  }, [level, normalizedAllowedLevels]);

  useEffect(() => {
    onClassificationChange?.(recommendation, {
      fileFingerprint: selectedFileFingerprint,
    });
  }, [onClassificationChange, recommendation, selectedFileFingerprint]);

  useEffect(() => {
    if (!recommendation) {
      return;
    }

    const nextLevel = resolvePreferredLevel({
      recommendation,
      allowedLevels: normalizedAllowedLevels,
      currentLevel: selectedLevel,
      preserveManualSelection: Boolean(level) || manuallySelectedLevel,
    });

    if (nextLevel !== selectedLevel) {
      setSelectedLevel(nextLevel);
    }
  }, [
    level,
    manuallySelectedLevel,
    normalizedAllowedLevels,
    recommendation,
    selectedLevel,
  ]);

  function resetTransientState() {
    setSubmitState("idle");
    setUploadProgress(0);
    setErrorMessage(null);
    setQueuedForRecovery(false);
    setRecoveryUnconfirmed(false);
  }

  function generateIdempotencyKey(file: File) {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }

    return `${Date.now()}-${file.name}-${file.size}-${file.lastModified}`;
  }

  function toFileFingerprint(file: File) {
    return `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
  }

  function handleFileSelection(file: File | null) {
    if (controlsDisabled) return;
    resetTransientState();

    const nextFingerprint = file ? toFileFingerprint(file) : "";
    const isSameFileSelection =
      nextFingerprint.length > 0 && nextFingerprint === selectedFileFingerprint;

    if (!isSameFileSelection) {
      setManuallySelectedLevel(false);
    }

    const validationMessage = validateTakeoffFileSupport(
      file,
      normalizedAllowedLevels
    );
    if (validationMessage) {
      setSelectedFile(null);
      setSelectedFileFingerprint("");
      setStableIdempotencyKey(null);
      setErrorMessage(validationMessage);
      setAnnouncement(validationMessage);
      return;
    }

    if (!file) {
      setSelectedFile(null);
      setSelectedFileFingerprint("");
      setStableIdempotencyKey(null);
      return;
    }

    const shouldKeepExistingKey =
      nextFingerprint === selectedFileFingerprint && stableIdempotencyKey;

    setSelectedFile(file);
    setSelectedFileFingerprint(nextFingerprint);
    setStableIdempotencyKey(
      shouldKeepExistingKey ? stableIdempotencyKey : generateIdempotencyKey(file)
    );
    setAnnouncement(file ? `Fichier ${file.name} sélectionné.` : "");
  }

  function handleLevelChange(nextLevel: TakeoffLevel) {
    if (controlsDisabled || nextLevel === selectedLevel) {
      return;
    }

    setManuallySelectedLevel(true);
    setSelectedLevel(nextLevel);
    resetTransientState();
    setAnnouncement(`Niveau ${nextLevel} sélectionné.`);
  }

  function openFilePicker() {
    if (controlsDisabled) return;
    fileInputRef.current?.click();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controlsDisabled) return;

    const validationMessage = validateTakeoffFileSupport(
      selectedFile,
      normalizedAllowedLevels
    );
    if (validationMessage) {
      notifySubmittingChange(false);
      setSubmitState("error");
      setErrorMessage(validationMessage);
      setAnnouncement(validationMessage);
      return;
    }

    if (!isTakeoffLevelCompatible(recommendation, selectedLevel)) {
      const message =
        selectionWarning?.message ??
        "Le niveau choisi n'est pas compatible avec le document détecté.";
      notifySubmittingChange(false);
      setSubmitState("error");
      setErrorMessage(message);
      setAnnouncement(message);
      return;
    }

    if (!selectedFile) {
      notifySubmittingChange(false);
      setSubmitState("error");
      setErrorMessage("Aucun fichier sélectionné.");
      return;
    }

    notifySubmittingChange(true);
    setSubmitState("loading");
    setUploadProgress(0);
    setErrorMessage(null);
    setAnnouncement("Envoi du fichier en cours.");

    const idempotencyKey =
      stableIdempotencyKey ?? generateIdempotencyKey(selectedFile);
    if (!stableIdempotencyKey) {
      setStableIdempotencyKey(idempotencyKey);
      setSelectedFileFingerprint(toFileFingerprint(selectedFile));
    }

    try {
      const job = await createTakeoffJob({
        estimateVersionId: versionId,
        level: selectedLevel,
        ...(provider !== "auto" ? { provider } : {}),
        file: selectedFile,
        idempotencyKey,
        onUploadProgress: (progress) => setUploadProgress(progress),
      });

      setSubmitState("success");
      setUploadProgress(100);
      const isQueuedForRecovery =
        job.dispatch?.status === "queued_for_recovery";
      const isRecoveryUnconfirmed =
        job.dispatch?.status === "persistence_unconfirmed";
      setQueuedForRecovery(isQueuedForRecovery);
      setRecoveryUnconfirmed(isRecoveryUnconfirmed);
      setAnnouncement(
        isRecoveryUnconfirmed
          ? "Analyse créée, mais ni son démarrage immédiat ni sa reprise automatique n'ont pu être confirmés. Ouvrez le suivi pour réessayer."
          : isQueuedForRecovery
            ? "Analyse enregistrée. Son démarrage est en attente et sera relancé automatiquement. Redirection en cours."
            : "Extraction lancée avec succès. Redirection en cours."
      );
      if (onSuccess) {
        onSuccess(job);
      } else {
        router.push(`/dashboard/estimates/${versionId}/takeoff/${job.id}`);
      }
    } catch (error) {
      const message = resolveApiErrorMessage(error);
      setSubmitState("error");
      setErrorMessage(message);
      setAnnouncement(message);
    } finally {
      notifySubmittingChange(false);
    }
  }

  const Wrapper = compact ? "div" : "section";
  const wrapperClassName = compact
    ? "space-y-6"
    : "min-w-0 rounded-lg border border-border bg-surface p-4 text-foreground shadow-card sm:p-8";

  return (
    <Wrapper className={wrapperClassName}>
      {!compact && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-foreground">
            Nouvelle extraction
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {uploadRules.intro}
          </p>
        </div>
      )}

      <form className="space-y-6" onSubmit={handleSubmit}>
        <input
          id={fileInputId}
          ref={fileInputRef}
          type="file"
          className="sr-only"
          accept={uploadRules.accept}
          onChange={(event) => {
            handleFileSelection(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
          disabled={controlsDisabled}
          aria-describedby={errorMessage ? "takeoff-upload-error" : undefined}
        />

        <div>
          <FieldLabel htmlFor={fileInputId} className="mb-1.5">
            Fichier source
          </FieldLabel>
          <div
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              dragActive
                ? "border-primary bg-primary/5"
                : "border-border-strong bg-surface-subtle hover:border-subtle-foreground"
            }`}
            role="button"
            tabIndex={controlsDisabled ? -1 : 0}
            aria-label="Zone de dépôt pour l'extraction. Glissez un fichier ou appuyez pour sélectionner."
            aria-disabled={controlsDisabled}
            onClick={openFilePicker}
            onKeyDown={(event) => {
              if (controlsDisabled) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openFilePicker();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!controlsDisabled) setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragActive(false);
              if (controlsDisabled) return;
              handleFileSelection(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <p className="text-sm font-medium text-foreground-secondary">
              {dragActive
                ? "Déposez le fichier ici"
                : "Glissez-déposez un fichier ou cliquez pour parcourir"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {uploadRules.helperLabel}
            </p>
          </div>
        </div>

        {selectedFile ? (
          <div className="rounded-xl border border-border bg-surface-subtle p-4">
            <h3 className="text-sm font-semibold text-foreground-secondary">
              Recap fichier
            </h3>
            <dl className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Nom
                </dt>
                <dd className="mt-1 break-all">{selectedFile.name}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Taille
                </dt>
                <dd className="mt-1">{formatFileSize(selectedFile.size)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Type
                </dt>
                <dd className="mt-1">{selectedFile.type || "Type MIME inconnu"}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        {selectedFile && recommendation ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Detection document
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {TAKEOFF_DOCUMENT_CLASS_LABELS[recommendation.documentClass]}
            </p>
            <p className="mt-2 text-sm text-foreground-secondary">
              Niveau recommande :{" "}
              {recommendation.recommendedLevel ? (
                <span className="font-semibold text-primary">
                  {TAKEOFF_LEVEL_BUSINESS_LABELS[recommendation.recommendedLevel]}
                </span>
              ) : (
                <span className="font-semibold text-warning">
                  Choix manuel requis
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Niveaux compatibles :{" "}
              {compatibleLevels.map((levelOption) => TAKEOFF_LEVEL_BUSINESS_LABELS[levelOption]).join(", ")}
            </p>
            {selectionWarning ? (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                  selectionWarning.severity === "critical"
                    ? "border-warning-border bg-warning-subtle text-warning"
                    : "border-primary/20 bg-surface/70 text-foreground-secondary"
                }`}
                role={selectionWarning.severity === "critical" ? "alert" : "status"}
              >
                {selectionWarning.message}
              </div>
            ) : null}
          </div>
        ) : null}

        {!compact && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">Niveau d&apos;extraction</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {TAKEOFF_LEVEL_OPTIONS.filter((option) =>
                normalizedAllowedLevels.includes(option.level)
              ).map((option) => {
                const isSelected = selectedLevel === option.level;
                const isCompatible = compatibleLevels.includes(option.level);
                const isDisabled = controlsDisabled || !isCompatible;

                return (
                  <label
                    key={option.level}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-surface"
                    } ${isDisabled ? "cursor-not-allowed opacity-50" : ""}`}
                    aria-disabled={isDisabled}
                  >
                    <input
                      type="radio"
                      name="takeoff-level"
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={() => handleLevelChange(option.level)}
                    />
                    <span className="text-sm text-foreground">
                      <span className="font-medium">{option.label}</span>
                      <span className="ml-2 text-muted-foreground">
                        {option.description}
                      </span>
                      {!isCompatible ? (
                        <span className="ml-2 text-warning">
                          indisponible pour ce document
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <TakeoffProviderSelect value={provider} disabled={controlsDisabled} onChange={(next) => {
          setProvider(next);
          setStableIdempotencyKey(null);
          resetTransientState();
        }} />

        {(submitState === "loading" || uploadProgress > 0) && (
          <div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-border"
              aria-label={`Progression upload ${uploadProgress}%`}
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-200"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload: {uploadProgress}%
            </p>
          </div>
        )}

        {errorMessage ? (
          <Alert id="takeoff-upload-error" variant="danger" aria-live="assertive">
            {errorMessage}
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className={buttonVariants({ variant: "primary", size: "lg" })}
            disabled={!canSubmit}
          >
            {submitState === "loading" ? (
              <>
                <LoaderCircleIcon aria-hidden="true" className="h-4 w-4 animate-spin" />
                {buttonLabel}
              </>
            ) : (
              buttonLabel
            )}
          </button>
        </div>
      </form>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </Wrapper>
  );
}
