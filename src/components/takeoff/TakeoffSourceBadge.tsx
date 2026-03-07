"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useState, type FocusEvent, type KeyboardEvent } from "react";
import Link from "next/link";

import { EstimateExplanationPanel } from "@/components/estimates/EstimateExplanationPanel";
import { usePopover } from "@/hooks/usePopover";

const TakeoffLineEvidencePanel = dynamic(
  () => import("@/components/takeoff/TakeoffLineEvidencePanel"),
  {
    ssr: false,
    loading: () => null,
  }
);

const NOT_AVAILABLE_LABEL = "Non disponible";
const SUPPORTED_BADGE_PROVIDERS = new Set([
  "takeoff",
  "takeoff_gemini",
  "ai_structure",
  "generated_ouvrage",
]);

type TakeoffSourceBadgeProps = {
  versionId: string;
  estimateItemId?: string | null;
  lineLabel?: string | null;
  sourceProvider?: string | null;
  sourceJobId?: string | null;
  sourceFileName?: string | null;
  sourcePage?: number | null;
  sourceLevel?: string | null;
  extractedAt?: string | null;
  sourceVersionNumber?: number | null;
  sourceMetadata?: unknown;
  cacheToken?: string | null;
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

type GeneratedOuvrageSnapshot = {
  draftId: string | null;
  candidateId: string | null;
  assemblyId: string | null;
  summary: {
    dsCents: number | null;
    indicativeTargetPriceCents: number | null;
    confidence: number | null;
    assemblyName: string | null;
    assemblyReferenceCode: string | null;
    riskSignals: string[];
    facts: string[];
    hypotheses: string[];
    inferences: string[];
  };
  components: Array<{
    designation: string;
    costType: string | null;
    quantity: number | null;
    unit: string | null;
    unitCostHtCents: number | null;
    dsCents: number | null;
    sourceLabel: string | null;
  }>;
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

function formatMoneyFromCents(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return NOT_AVAILABLE_LABEL;
  }

  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value / 100);
}

function parseGeneratedOuvrageSnapshot(value: unknown): GeneratedOuvrageSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const summaryRecord = isRecord(value.subdetail_summary)
    ? value.subdetail_summary
    : isRecord(value.summary)
      ? value.summary
      : {};
  const components = Array.isArray(value.components) ? value.components : [];
  const readStringList = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0)
      : [];
  const readRiskSignalList = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate
          .map((entry) => {
            if (typeof entry === "string") {
              return entry.trim();
            }
            if (isRecord(entry) && typeof entry.label === "string") {
              return entry.label.trim();
            }
            return "";
          })
          .filter((entry) => entry.length > 0)
      : [];

  return {
    draftId: toNonEmptyString(
      typeof value.draft_id === "string" ? value.draft_id : null
    ),
    candidateId: toNonEmptyString(
      typeof value.candidate_id === "string" ? value.candidate_id : null
    ),
    assemblyId: toNonEmptyString(
      typeof value.assembly_id === "string" ? value.assembly_id : null
    ),
    summary: {
      dsCents:
        typeof summaryRecord.ds_cents === "number" ? summaryRecord.ds_cents : null,
      indicativeTargetPriceCents:
        typeof summaryRecord.indicative_target_price_cents === "number"
          ? summaryRecord.indicative_target_price_cents
          : null,
      confidence:
        typeof summaryRecord.confidence === "number"
          ? summaryRecord.confidence
          : typeof value.confidence === "number"
            ? value.confidence
            : null,
      assemblyName: toNonEmptyString(
        typeof summaryRecord.assembly_name === "string"
          ? summaryRecord.assembly_name
          : null
      ),
      assemblyReferenceCode: toNonEmptyString(
        typeof summaryRecord.assembly_reference_code === "string"
          ? summaryRecord.assembly_reference_code
          : null
      ),
      riskSignals: readRiskSignalList(
        Array.isArray(value.risk_signals)
          ? value.risk_signals
          : summaryRecord.risk_signals
      ),
      facts: readStringList(value.facts ?? summaryRecord.facts),
      hypotheses: readStringList(value.hypotheses ?? summaryRecord.hypotheses),
      inferences: readStringList(value.inferences ?? summaryRecord.inferences),
    },
    components: components
      .map((component) => {
        if (!isRecord(component)) return null;
        const designation = toNonEmptyString(
          typeof component.designation === "string" ? component.designation : null
        );
        if (!designation) return null;
        return {
          designation,
          costType: toNonEmptyString(
            typeof component.costType === "string"
              ? component.costType
              : typeof component.cost_type === "string"
                ? component.cost_type
                : null
          ),
          quantity:
            typeof component.quantity === "number" ? component.quantity : null,
          unit: toNonEmptyString(
            typeof component.unit === "string" ? component.unit : null
          ),
          unitCostHtCents:
            typeof component.unitCostHtCents === "number"
              ? component.unitCostHtCents
              : typeof component.unit_cost_ht_cents === "number"
                ? component.unit_cost_ht_cents
                : null,
          dsCents:
            typeof component.dsCents === "number"
              ? component.dsCents
              : typeof component.ds_cents === "number"
                ? component.ds_cents
                : null,
          sourceLabel: toNonEmptyString(
            typeof component.sourceLabel === "string"
              ? component.sourceLabel
              : typeof component.source_label === "string"
                ? component.source_label
                : null
          ),
        };
      })
      .filter(
        (
          component
        ): component is GeneratedOuvrageSnapshot["components"][number] =>
          component !== null
      ),
  };
}

export function TakeoffSourceBadge({
  versionId,
  estimateItemId,
  lineLabel,
  sourceProvider,
  sourceJobId,
  sourceFileName,
  sourcePage,
  sourceLevel,
  extractedAt,
  sourceVersionNumber,
  sourceMetadata,
  cacheToken,
}: TakeoffSourceBadgeProps) {
  const {
    isOpen: isPinnedOpen,
    toggle,
    close,
    setContainerRef,
  } = usePopover();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [isEvidencePanelOpen, setIsEvidencePanelOpen] = useState(false);
  const [isExplanationPanelOpen, setIsExplanationPanelOpen] = useState(false);
  const tooltipId = useId();
  const isOpen = isPinnedOpen || isHovered || isFocusWithin;
  const normalizedSourceProvider = toNonEmptyString(sourceProvider)?.toLowerCase();

  const closePopover = () => {
    close();
    setIsHovered(false);
    setIsFocusWithin(false);
  };

  useEffect(() => {
    if (!isExplanationPanelOpen) {
      return;
    }

    closePopover();
  }, [closePopover, isExplanationPanelOpen]);

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
  const isGeneratedOuvrage = normalizedSourceProvider === "generated_ouvrage";
  const aiApplications = parseAiStructureApplications(sourceMetadata);
  const generatedOuvrageSnapshot = parseGeneratedOuvrageSnapshot(sourceMetadata);

  if (
    !normalizedSourceProvider ||
    !SUPPORTED_BADGE_PROVIDERS.has(normalizedSourceProvider)
  ) {
    return null;
  }

  if (isAiStructure && aiApplications.length === 0) {
    return null;
  }

  if (isGeneratedOuvrage && !generatedOuvrageSnapshot) {
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
  const canOpenEvidence =
    normalizedSourceJobId !== null &&
    toNonEmptyString(estimateItemId ?? null) !== null;
  const openExplanationPanel = () => {
    setIsExplanationPanelOpen(true);
  };

  const triggerText = isAiStructure
    ? "IA structure"
    : isGeneratedOuvrage
      ? "IA ouvrage"
      : `IA${triggerLabelSuffix}`;

  return (
    <div
      ref={setContainerRef}
      className="takeoff-source-badge"
      role="presentation"
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

      {!isAiStructure && estimateItemId ? (
        <button
          type="button"
          className="takeoff-source-badge__job-link takeoff-source-badge__inline-action"
          onMouseDown={(event) => {
            event.preventDefault();
            openExplanationPanel();
          }}
          onClick={openExplanationPanel}
        >
          Expliquer ce prix
        </button>
      ) : null}

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
          ) : isGeneratedOuvrage && generatedOuvrageSnapshot ? (
            <>
              <p className="takeoff-source-badge__title">Ouvrage compose IA</p>
              <div className="space-y-3 text-sm text-[var(--slate-700)]">
                <div className="rounded-lg border border-[var(--slate-200)] bg-white p-3">
                  <p className="font-medium text-[var(--slate-900)]">
                    {generatedOuvrageSnapshot.summary.assemblyName ?? "Snapshot applique"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--slate-500)]">
                    Reference:{" "}
                    {generatedOuvrageSnapshot.summary.assemblyReferenceCode ??
                      NOT_AVAILABLE_LABEL}
                  </p>
                  <p className="mt-1 text-xs text-[var(--slate-500)]">
                    DS: {formatMoneyFromCents(generatedOuvrageSnapshot.summary.dsCents)} · Prix
                    cible:{" "}
                    {formatMoneyFromCents(
                      generatedOuvrageSnapshot.summary.indicativeTargetPriceCents
                    )}
                  </p>
                  <p className="mt-1 text-xs text-[var(--slate-500)]">
                    Confiance:{" "}
                    {generatedOuvrageSnapshot.summary.confidence !== null
                      ? `${Math.round(generatedOuvrageSnapshot.summary.confidence * 100)}%`
                      : NOT_AVAILABLE_LABEL}
                  </p>
                  {generatedOuvrageSnapshot.summary.riskSignals.length > 0 ? (
                    <p className="mt-2 text-xs text-[var(--slate-600)]">
                      Risques: {generatedOuvrageSnapshot.summary.riskSignals.join(" · ")}
                    </p>
                  ) : null}
                  {generatedOuvrageSnapshot.summary.facts.length > 0 ? (
                    <p className="mt-2 text-xs text-[var(--slate-600)]">
                      Faits: {generatedOuvrageSnapshot.summary.facts.join(" · ")}
                    </p>
                  ) : null}
                  {generatedOuvrageSnapshot.summary.hypotheses.length > 0 ? (
                    <p className="mt-1 text-xs text-[var(--slate-600)]">
                      Hypotheses:{" "}
                      {generatedOuvrageSnapshot.summary.hypotheses.join(" · ")}
                    </p>
                  ) : null}
                  {generatedOuvrageSnapshot.summary.inferences.length > 0 ? (
                    <p className="mt-1 text-xs text-[var(--slate-600)]">
                      Inferences:{" "}
                      {generatedOuvrageSnapshot.summary.inferences.join(" · ")}
                    </p>
                  ) : null}
                </div>

                {generatedOuvrageSnapshot.components.slice(0, 4).map((component) => (
                  <div
                    key={`${component.designation}-${component.costType}`}
                    className="rounded-lg border border-[var(--slate-200)] bg-white p-3"
                  >
                    <p className="font-medium text-[var(--slate-900)]">
                      {component.designation}
                    </p>
                    <p className="mt-1 text-xs text-[var(--slate-500)]">
                      {component.costType ?? "composant"} ·{" "}
                      {component.quantity ?? NOT_AVAILABLE_LABEL}{" "}
                      {component.unit ?? ""}
                    </p>
                    <p className="mt-1 text-xs text-[var(--slate-500)]">
                      PU HT: {formatMoneyFromCents(component.unitCostHtCents)} · DS:{" "}
                      {formatMoneyFromCents(component.dsCents)}
                    </p>
                    {component.sourceLabel ? (
                      <p className="mt-1 text-xs text-[var(--slate-600)]">
                        Provenance: {component.sourceLabel}
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
                <div className="takeoff-source-badge__meta-row">
                  <dt>Preuves</dt>
                  <dd>
                    {canOpenEvidence ? (
                      <button
                        type="button"
                        className="takeoff-source-badge__job-link"
                        onClick={() => {
                          closePopover();
                          setIsEvidencePanelOpen(true);
                        }}
                        data-testid="takeoff-source-badge-view-evidence-button"
                      >
                        Voir les preuves
                      </button>
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

      {normalizedSourceJobId && estimateItemId ? (
        <TakeoffLineEvidencePanel
          open={isEvidencePanelOpen}
          onOpenChange={setIsEvidencePanelOpen}
          jobId={normalizedSourceJobId}
          versionId={versionId}
          lineId={estimateItemId}
          lineLabel={lineLabel?.trim() ? lineLabel : "Ligne du devis"}
          sourceFileName={sourceFileName}
          sourcePage={sourcePage}
          surfaceLabel="Preuves ligne devis"
        />
      ) : null}

      {estimateItemId ? (
        <EstimateExplanationPanel
          open={isExplanationPanelOpen}
          onOpenChange={setIsExplanationPanelOpen}
          kind="price"
          versionId={versionId}
          lineId={estimateItemId}
          lineLabel={lineLabel}
          surfaceLabel="Explication prix ligne devis"
          cacheToken={cacheToken}
        />
      ) : null}
    </div>
  );
}
