"use client";

import { useId, useState, type FocusEvent, type KeyboardEvent } from "react";
import Link from "next/link";

import { usePopover } from "@/hooks/usePopover";

const NOT_AVAILABLE_LABEL = "Non disponible";
const SUPPORTED_BADGE_PROVIDERS = new Set([
  "takeoff",
  "takeoff_gemini",
  "ai_structure",
]);

type TakeoffSourceBadgeProps = {
  versionId: string;
  sourceProvider?: string | null;
  sourceJobId?: string | null;
  sourceFileName?: string | null;
  sourcePage?: number | null;
  sourceLevel?: string | null;
  extractedAt?: string | null;
  sourceVersionNumber?: number | null;
  sourceMetadata?: unknown;
};

type AiStructureApplication = {
  draftId: string;
  label: string;
  hierarchyLevel: number | null;
  confidence: number | null;
  confidenceLabel: string | null;
  generatedAt: string | null;
  appliedAction: string | null;
  provenance: string[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
};

function toNonEmptyString(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTakeoffLevel(value: string | null | undefined) {
  const normalized = toNonEmptyString(value)?.toUpperCase() ?? null;
  if (!normalized) return null;
  if (normalized === "A" || normalized === "B" || normalized === "C") {
    return normalized;
  }

  const matched = normalized.match(/(?:NIVEAU|LEVEL)[\s:_-]*([ABC])\b/);
  if (!matched) return null;

  const level = matched[1];
  return level === "A" || level === "B" || level === "C" ? level : null;
}

function formatExtractionDate(value: string | null | undefined) {
  const normalized = toNonEmptyString(value);
  if (!normalized) return NOT_AVAILABLE_LABEL;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatSourcePage(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return NOT_AVAILABLE_LABEL;
  }

  const page = Math.trunc(value ?? 0);
  return page > 0 ? String(page) : NOT_AVAILABLE_LABEL;
}

function normalizeSourceVersionNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }

  return value > 0 ? value : null;
}

function parseAiStructureApplications(value: unknown): AiStructureApplication[] {
  if (!isRecord(value) || !Array.isArray(value.applications)) {
    return [];
  }

  return value.applications
    .map((application) => {
      if (!isRecord(application)) return null;

      const draftId = toNonEmptyString(
        typeof application.draft_id === "string"
          ? application.draft_id
          : typeof application.draftId === "string"
            ? application.draftId
            : null
      );
      const label = toNonEmptyString(
        typeof application.label === "string" ? application.label : null
      );

      if (!draftId || !label) {
        return null;
      }

      const toStringList = (candidate: unknown) =>
        Array.isArray(candidate)
          ? candidate
              .map((entry) =>
                typeof entry === "string" ? entry.trim() : ""
              )
              .filter((entry) => entry.length > 0)
          : [];

      const provenance = Array.isArray(application.provenance)
        ? application.provenance
            .map((entry) => {
              if (!isRecord(entry)) return null;
              const labelValue =
                toNonEmptyString(
                  typeof entry.label === "string" ? entry.label : null
                ) ?? NOT_AVAILABLE_LABEL;
              const excerpt = toNonEmptyString(
                typeof entry.excerpt === "string" ? entry.excerpt : null
              );
              return excerpt ? `${labelValue}: ${excerpt}` : labelValue;
            })
            .filter((entry): entry is string => entry !== null)
        : [];

      return {
        draftId,
        label,
        hierarchyLevel:
          typeof application.hierarchy_level === "number"
            ? application.hierarchy_level
            : typeof application.hierarchyLevel === "number"
              ? application.hierarchyLevel
              : null,
        confidence:
          typeof application.confidence === "number"
            ? application.confidence
            : null,
        confidenceLabel:
          toNonEmptyString(
            typeof application.confidence_label === "string"
              ? application.confidence_label
              : typeof application.confidenceLabel === "string"
                ? application.confidenceLabel
                : null
          ) ?? null,
        generatedAt:
          toNonEmptyString(
            typeof application.generated_at === "string"
              ? application.generated_at
              : typeof application.generatedAt === "string"
                ? application.generatedAt
                : null
          ) ?? null,
        appliedAction:
          toNonEmptyString(
            typeof application.applied_action === "string"
              ? application.applied_action
              : typeof application.appliedAction === "string"
                ? application.appliedAction
                : null
          ) ?? null,
        provenance,
        facts: toStringList(application.facts),
        hypotheses: toStringList(application.hypotheses),
        inferences: toStringList(application.inferences),
      } satisfies AiStructureApplication;
    })
    .filter((application): application is AiStructureApplication => application !== null);
}

function formatAiConfidence(application: AiStructureApplication) {
  const score =
    typeof application.confidence === "number"
      ? Math.round(application.confidence * 100)
      : null;
  const label = application.confidenceLabel ?? "non renseignee";
  return score !== null ? `${label} (${score}%)` : label;
}

export function TakeoffSourceBadge({
  versionId,
  sourceProvider,
  sourceJobId,
  sourceFileName,
  sourcePage,
  sourceLevel,
  extractedAt,
  sourceVersionNumber,
  sourceMetadata,
}: TakeoffSourceBadgeProps) {
  const {
    isOpen: isPinnedOpen,
    toggle,
    close,
    setContainerRef,
  } = usePopover();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const tooltipId = useId();
  const isOpen = isPinnedOpen || isHovered || isFocusWithin;
  const normalizedSourceProvider = toNonEmptyString(sourceProvider)?.toLowerCase();

  if (
    !normalizedSourceProvider ||
    !SUPPORTED_BADGE_PROVIDERS.has(normalizedSourceProvider)
  ) {
    return null;
  }

  const closePopover = () => {
    close();
    setIsHovered(false);
    setIsFocusWithin(false);
  };

  const handleBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusedNode = event.relatedTarget as Node | null;
    if (nextFocusedNode && event.currentTarget.contains(nextFocusedNode)) {
      return;
    }
    setIsFocusWithin(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closePopover();

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  };

  const isAiStructure = normalizedSourceProvider === "ai_structure";
  const aiApplications = parseAiStructureApplications(sourceMetadata);

  if (isAiStructure && aiApplications.length === 0) {
    return null;
  }

  const sourceFileLabel = toNonEmptyString(sourceFileName) ?? NOT_AVAILABLE_LABEL;
  const sourcePageLabel = formatSourcePage(sourcePage);
  const extractedAtLabel = formatExtractionDate(extractedAt);
  const sourceLevelLabel = normalizeTakeoffLevel(sourceLevel) ?? NOT_AVAILABLE_LABEL;
  const normalizedSourceVersionNumber = normalizeSourceVersionNumber(
    sourceVersionNumber
  );
  const sourceVersionLabel = normalizedSourceVersionNumber
    ? `V${normalizedSourceVersionNumber}`
    : NOT_AVAILABLE_LABEL;
  const triggerLabelSuffix = normalizedSourceVersionNumber
    ? ` (from V${normalizedSourceVersionNumber})`
    : "";
  const normalizedSourceJobId = toNonEmptyString(sourceJobId);
  const jobLink = normalizedSourceJobId
    ? `/dashboard/estimates/${versionId}/takeoff/${normalizedSourceJobId}`
    : null;

  const triggerText = isAiStructure ? "IA structure" : `IA${triggerLabelSuffix}`;

  return (
    <div
      ref={setContainerRef}
      className="takeoff-source-badge"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setIsFocusWithin(true)}
      onBlurCapture={handleBlurCapture}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className={`takeoff-source-badge__trigger${isOpen ? " is-open" : ""}`}
        onClick={toggle}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-label="Afficher la provenance IA"
      >
        <span aria-hidden="true">{triggerText}</span>
        <span className="sr-only">Provenance IA disponible pour cette ligne</span>
      </button>

      {isOpen ? (
        <div
          id={tooltipId}
          className="takeoff-source-badge__popover"
          role="tooltip"
        >
          {isAiStructure ? (
            <>
              <p className="takeoff-source-badge__title">Structure IA</p>
              <div className="space-y-3 text-sm text-[var(--slate-700)]">
                {aiApplications.slice(0, 3).map((application) => (
                  <div
                    key={`${application.draftId}-${application.label}`}
                    className="rounded-lg border border-[var(--slate-200)] bg-white p-3"
                  >
                    <p className="font-medium text-[var(--slate-900)]">
                      {application.label}
                    </p>
                    <p className="mt-1 text-xs text-[var(--slate-500)]">
                      {application.hierarchyLevel
                        ? `Niveau ${application.hierarchyLevel}`
                        : "Niveau non renseigne"}{" "}
                      · {formatAiConfidence(application)} ·{" "}
                      {application.appliedAction ?? "action non renseignee"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--slate-500)]">
                      Genere le {formatExtractionDate(application.generatedAt)}
                    </p>
                    {application.provenance.length > 0 ? (
                      <p className="mt-2 text-xs text-[var(--slate-600)]">
                        Provenance: {application.provenance.join(" · ")}
                      </p>
                    ) : null}
                    {application.facts.length > 0 ? (
                      <p className="mt-2 text-xs text-[var(--slate-600)]">
                        Faits: {application.facts.join(" · ")}
                      </p>
                    ) : null}
                    {application.hypotheses.length > 0 ? (
                      <p className="mt-1 text-xs text-[var(--slate-600)]">
                        Hypotheses: {application.hypotheses.join(" · ")}
                      </p>
                    ) : null}
                    {application.inferences.length > 0 ? (
                      <p className="mt-1 text-xs text-[var(--slate-600)]">
                        Inferences: {application.inferences.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="takeoff-source-badge__title">Provenance IA</p>
              <dl className="takeoff-source-badge__meta-list">
                <div className="takeoff-source-badge__meta-row">
                  <dt>Fichier source</dt>
                  <dd>{sourceFileLabel}</dd>
                </div>
                <div className="takeoff-source-badge__meta-row">
                  <dt>Page</dt>
                  <dd>{sourcePageLabel}</dd>
                </div>
                <div className="takeoff-source-badge__meta-row">
                  <dt>Date extraction</dt>
                  <dd>{extractedAtLabel}</dd>
                </div>
                <div className="takeoff-source-badge__meta-row">
                  <dt>Niveau</dt>
                  <dd>{sourceLevelLabel}</dd>
                </div>
                <div className="takeoff-source-badge__meta-row">
                  <dt>Version source</dt>
                  <dd>{sourceVersionLabel}</dd>
                </div>
                <div className="takeoff-source-badge__meta-row">
                  <dt>Extraction</dt>
                  <dd>
                    {jobLink ? (
                      <Link className="takeoff-source-badge__job-link" href={jobLink}>
                        Ouvrir l&apos;extraction
                      </Link>
                    ) : (
                      <span
                        className="takeoff-source-badge__job-link takeoff-source-badge__job-link--disabled"
                        aria-disabled="true"
                      >
                        Non disponible
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
