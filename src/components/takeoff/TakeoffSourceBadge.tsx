"use client";

import { useId, useState, type FocusEvent, type KeyboardEvent } from "react";
import Link from "next/link";

import { usePopover } from "@/hooks/usePopover";

const NOT_AVAILABLE_LABEL = "Non disponible";
const TAKEOFF_BADGE_PROVIDERS = new Set(["takeoff", "takeoff_gemini"]);

type TakeoffSourceBadgeProps = {
  versionId: string;
  sourceProvider?: string | null;
  sourceJobId?: string | null;
  sourceFileName?: string | null;
  sourcePage?: number | null;
  sourceLevel?: string | null;
  extractedAt?: string | null;
  sourceVersionNumber?: number | null;
};

function toNonEmptyString(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

export function TakeoffSourceBadge({
  versionId,
  sourceProvider,
  sourceJobId,
  sourceFileName,
  sourcePage,
  sourceLevel,
  extractedAt,
  sourceVersionNumber,
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
    !TAKEOFF_BADGE_PROVIDERS.has(normalizedSourceProvider)
  ) {
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
        <span aria-hidden="true">{`IA${triggerLabelSuffix}`}</span>
        <span className="sr-only">Provenance IA disponible pour cette ligne</span>
      </button>

      {isOpen ? (
        <div
          id={tooltipId}
          className="takeoff-source-badge__popover"
          role="tooltip"
        >
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
        </div>
      ) : null}
    </div>
  );
}
