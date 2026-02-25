"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { fetchEstimateItemsForVersion } from "@/lib/estimates/client";
import {
  previewTakeoffConversion,
  type TakeoffMappingOverride,
  type TakeoffPreviewConversionResponse,
} from "@/lib/takeoff/client";
import {
  checkApplyGuard,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  type ApplyGuardResult,
} from "@/lib/takeoff/guards";
import type { TakeoffJobItem } from "@/lib/takeoff/types";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

type WizardStep = 1 | 2 | 3 | 4;

type SectionOption = {
  id: string;
  label: string;
  summaryLabel: string;
};

export type TakeoffApplyStrategy = "append" | "replace" | "merge";

export type TakeoffApplyWizardSubmitPayload = {
  targetSectionId: string | null;
  targetSectionLabel: string;
  strategy: TakeoffApplyStrategy;
  overrides: TakeoffMappingOverride[];
  override?: boolean;
  overrideJustification?: string;
};

type TakeoffApplyWizardProps = {
  open: boolean;
  jobId: string;
  versionId: string;
  includedCount: number;
  excludedCount: number;
  isSubmitting: boolean;
  submitError: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: TakeoffApplyWizardSubmitPayload) => Promise<void>;
  items?: TakeoffJobItem[];
  jobLevel?: string | null;
  confidenceThreshold?: number;
  isAdmin?: boolean;
  onVerifyItems?: (itemIds: string[]) => Promise<void>;
  onReturnToReview?: () => void;
};

const ROOT_SECTION_VALUE = "__takeoff_root_section__";
const ROOT_SECTION_LABEL = "Racine du devis";
const AUTO_OVERRIDE_VALUE = "__takeoff_override_auto__";

const STRATEGY_OPTIONS: Array<{
  value: TakeoffApplyStrategy;
  label: string;
  description: string;
}> = [
  {
    value: "append",
    label: "Append",
    description: "Ajoute les lignes takeoff a la fin de la section cible.",
  },
  {
    value: "replace",
    label: "Replace",
    description: "Remplace le contenu existant de la section cible.",
  },
  {
    value: "merge",
    label: "Merge",
    description: "Fusionne avec les lignes existantes selon les regles serveur.",
  },
];

const OVERRIDE_ACTION_OPTIONS: Array<{
  value: TakeoffMappingOverride["action"];
  label: string;
}> = [
  { value: "none", label: "Aucune transformation" },
  { value: "rename", label: "rename" },
  { value: "set_price", label: "set_price" },
  { value: "set_category", label: "set_category" },
  { value: "apply_assembly", label: "apply_assembly" },
  { value: "skip", label: "skip" },
];

function toPosition(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Number.MAX_SAFE_INTEGER;
}

function normalizeSectionTitle(title: string | null): string {
  const normalized = title?.trim();
  if (!normalized) return "Section sans titre";
  return normalized;
}

function compareSections(left: EstimateItem, right: EstimateItem): number {
  const positionDiff = toPosition(left.position) - toPosition(right.position);
  if (positionDiff !== 0) return positionDiff;

  const titleDiff = normalizeSectionTitle(left.title).localeCompare(
    normalizeSectionTitle(right.title),
    "fr-FR"
  );
  if (titleDiff !== 0) return titleDiff;

  return left.id.localeCompare(right.id);
}

function buildSectionOptions(items: EstimateItem[]): SectionOption[] {
  const sections = items.filter((item) => item.item_type === "section");
  const sectionIds = new Set(sections.map((section) => section.id));
  const childrenByParent = new Map<string | null, EstimateItem[]>();

  for (const section of sections) {
    const parentId =
      section.parent_id && sectionIds.has(section.parent_id)
        ? section.parent_id
        : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(section);
    childrenByParent.set(parentId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareSections);
  }

  const visited = new Set<string>();
  const ordered: SectionOption[] = [];

  const visit = (parentId: string | null, depth: number) => {
    const children = childrenByParent.get(parentId) ?? [];

    for (const section of children) {
      if (visited.has(section.id)) continue;
      visited.add(section.id);
      const summaryLabel = normalizeSectionTitle(section.title);
      const indent = depth > 0 ? `${"  ".repeat(depth)}- ` : "";
      ordered.push({
        id: section.id,
        label: `${indent}${summaryLabel}`,
        summaryLabel,
      });
      visit(section.id, depth + 1);
    }
  };

  visit(null, 0);

  for (const section of sections) {
    if (visited.has(section.id)) continue;
    ordered.push({
      id: section.id,
      label: normalizeSectionTitle(section.title),
      summaryLabel: normalizeSectionTitle(section.title),
    });
  }

  return ordered;
}

function strategyDescription(strategy: TakeoffApplyStrategy) {
  return STRATEGY_OPTIONS.find((option) => option.value === strategy)?.description ?? "-";
}

function toOverrideList(overridesByItemId: Record<string, TakeoffMappingOverride>) {
  return Object.values(overridesByItemId);
}

function summarizeAction(item: TakeoffPreviewConversionResponse["items"][number]) {
  if (item.action === "none") {
    return "Aucune";
  }

  if (item.rule_name) {
    return `${item.action} (${item.rule_name})`;
  }

  return item.action;
}

function buildOverrideFromAction(input: {
  item: TakeoffPreviewConversionResponse["items"][number];
  action: TakeoffMappingOverride["action"];
}): TakeoffMappingOverride {
  if (input.action === "rename") {
    return {
      item_id: input.item.item_id,
      action: "rename",
      action_params: {
        designation: input.item.transformed.designation,
      },
    };
  }

  if (input.action === "set_price") {
    return {
      item_id: input.item.item_id,
      action: "set_price",
      action_params: {
        unit_price_cents: input.item.transformed.unit_price_cents ?? 0,
      },
    };
  }

  if (input.action === "set_category") {
    return {
      item_id: input.item.item_id,
      action: "set_category",
      action_params: {
        category_id: input.item.transformed.category_id ?? "",
      },
    };
  }

  if (input.action === "apply_assembly") {
    return {
      item_id: input.item.item_id,
      action: "apply_assembly",
      action_params: {
        assembly_id: input.item.transformed.assembly_id ?? "",
      },
    };
  }

  if (input.action === "skip") {
    return {
      item_id: input.item.item_id,
      action: "skip",
      action_params: {},
    };
  }

  return {
    item_id: input.item.item_id,
    action: "none",
    action_params: {},
  };
}

function confidenceColor(confidence: number | null): string {
  if (confidence === null) return "text-[var(--danger)]";
  if (confidence < 0.3) return "text-[var(--danger)]";
  if (confidence < 0.5) return "text-[var(--warning)]";
  if (confidence < 0.8) return "text-[var(--info)]";
  return "text-[var(--success)]";
}

function formatConfidencePercent(confidence: number | null): string {
  if (confidence === null) return "N/A";
  return `${Math.round(confidence * 100)}%`;
}

// ---------------------------------------------------------------------------
// Guard Panel sub-component
// ---------------------------------------------------------------------------

function GuardPanel({
  guardResult,
  items,
  isAdmin,
  isVerifying,
  overrideJustification,
  onVerifyAll,
  onVerifyItem,
  onReturnToReview,
  onOverrideJustificationChange,
  onOverrideConfirm,
}: {
  guardResult: ApplyGuardResult;
  items: TakeoffJobItem[];
  isAdmin: boolean;
  isVerifying: boolean;
  overrideJustification: string;
  onVerifyAll: () => void;
  onVerifyItem: (itemId: string) => void;
  onReturnToReview?: () => void;
  onOverrideJustificationChange: (value: string) => void;
  onOverrideConfirm: () => void;
}) {
  const totalIncluded = items.filter((i) => !i.is_excluded).length;
  const verifiedCount = items.filter((i) => !i.is_excluded && i.is_verified).length;
  const progressPercent =
    totalIncluded > 0 ? Math.round((verifiedCount / totalIncluded) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="rounded-xl border border-[var(--warning)] bg-amber-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--warning)]">
          <span aria-hidden="true">&#9888;</span> Verification requise
        </p>
        <p className="mt-2 text-sm text-[var(--slate-700)]">
          {guardResult.blocked_items.length} item(s) ont une confiance faible
          (&lt;{Math.round(guardResult.threshold * 100)}%) et n&apos;ont pas encore
          ete verifies. L&apos;IA n&apos;est pas certaine de ces donnees — une
          verification humaine est obligatoire avant application.
        </p>
        {onReturnToReview && (
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-3"
            onClick={onReturnToReview}
            disabled={isVerifying}
          >
            Retour a la revue
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] p-3">
        <div className="flex items-center justify-between text-xs text-[var(--slate-700)]">
          <span>Progression des verifications</span>
          <span className="font-semibold">
            {verifiedCount}/{totalIncluded} verifies
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--slate-200)]">
          <div
            className="h-full rounded-full bg-[var(--success)] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Batch verify button */}
      <button
        type="button"
        className="btn btn-secondary btn-sm w-full"
        onClick={onVerifyAll}
        disabled={isVerifying || guardResult.blocked_items.length === 0}
      >
        {isVerifying
          ? "Verification en cours..."
          : `Tout verifier (${guardResult.blocked_items.length} item(s))`}
      </button>

      {/* Blocked items table */}
      <div className="max-h-[200px] overflow-auto rounded-xl border border-[var(--slate-200)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-600)]">
            <tr>
              <th className="px-3 py-2">Designation</th>
              <th className="px-3 py-2 text-center">Confiance</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {guardResult.blocked_items.map((blocked) => (
              <tr
                key={blocked.item_id}
                className="border-t border-[var(--slate-200)]"
              >
                <td className="px-3 py-2 text-[var(--slate-800)]">
                  {blocked.designation}
                </td>
                <td
                  className={`px-3 py-2 text-center font-semibold ${confidenceColor(blocked.confidence)}`}
                >
                  {formatConfidencePercent(blocked.confidence)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onVerifyItem(blocked.item_id)}
                    disabled={isVerifying}
                  >
                    Verifier
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Medium confidence warning */}
      {guardResult.medium_items.length > 0 && (
        <div className="rounded-xl border border-[var(--info)] bg-blue-50 p-3">
          <p className="text-xs font-semibold text-[var(--info)]">
            Items confiance moyenne (non bloquants)
          </p>
          <p className="mt-1 text-xs text-[var(--slate-600)]">
            {guardResult.medium_items.length} item(s) ont une confiance moyenne
            (50-80%). Verification recommandee mais non obligatoire.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-[var(--info)]">
              Voir les items ({guardResult.medium_items.length})
            </summary>
            <ul className="mt-1 space-y-1 text-xs text-[var(--slate-600)]">
              {guardResult.medium_items.map((medium) => (
                <li key={medium.item_id} className="flex items-center justify-between">
                  <span>{medium.designation}</span>
                  <span className={`font-semibold ${confidenceColor(medium.confidence)}`}>
                    {formatConfidencePercent(medium.confidence)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {/* Admin override section */}
      {isAdmin && (
        <div className="rounded-xl border border-[var(--danger)] bg-red-50 p-4">
          <p className="text-xs font-semibold text-[var(--danger)]">
            Override administrateur
          </p>
          <p className="mt-1 text-xs text-[var(--slate-600)]">
            Appliquer malgre les items non verifies. Une justification est obligatoire
            et sera enregistree dans le journal d&apos;audit.
          </p>
          <textarea
            className="form-input mt-2 w-full text-sm"
            rows={2}
            placeholder="Justification (min 10 caracteres)..."
            value={overrideJustification}
            onChange={(e) => onOverrideJustificationChange(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-sm mt-2 border-[var(--danger)] bg-[var(--danger)] text-white hover:opacity-90"
            onClick={onOverrideConfirm}
            disabled={isVerifying || overrideJustification.trim().length < 10}
          >
            Appliquer malgre les items non verifies
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard component
// ---------------------------------------------------------------------------

export function TakeoffApplyWizard({
  open,
  jobId,
  versionId,
  includedCount,
  excludedCount,
  isSubmitting,
  submitError,
  onOpenChange,
  onConfirm,
  items: externalItems,
  jobLevel,
  confidenceThreshold,
  isAdmin = false,
  onVerifyItems,
  onReturnToReview,
}: TakeoffApplyWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<TakeoffApplyStrategy>("append");
  const [sectionOptions, setSectionOptions] = useState<SectionOption[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [previewData, setPreviewData] =
    useState<TakeoffPreviewConversionResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [overridesByItemId, setOverridesByItemId] =
    useState<Record<string, TakeoffMappingOverride>>({});
  const overridesRef = useRef<Record<string, TakeoffMappingOverride>>({});

  // Guard state
  const [guardResult, setGuardResult] = useState<ApplyGuardResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [overrideJustification, setOverrideJustification] = useState("");

  const threshold = confidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  const isLevelC = jobLevel === "C";
  const hasGuardItems = !!externalItems && externalItems.length > 0;

  useEffect(() => {
    overridesRef.current = overridesByItemId;
  }, [overridesByItemId]);

  // Re-run guard whenever items change (e.g. after batch verify)
  useEffect(() => {
    if (!isLevelC || !hasGuardItems || step !== 4) {
      setGuardResult(null);
      return;
    }
    const result = checkApplyGuard(externalItems!, threshold);
    setGuardResult(result);
  }, [isLevelC, hasGuardItems, externalItems, threshold, step]);

  const guardBlocking =
    isLevelC && guardResult !== null && !guardResult.passed;

  const refreshPreview = useCallback(
    async (overridesSnapshot: Record<string, TakeoffMappingOverride>) => {
      setIsLoadingPreview(true);
      setPreviewError(null);

      try {
        const response = await previewTakeoffConversion(jobId, {
          strategy,
          target_section_id: targetSectionId,
          overrides:
            toOverrideList(overridesSnapshot).length > 0
              ? toOverrideList(overridesSnapshot)
              : undefined,
        });
        setPreviewData(response);
      } catch (error) {
        setPreviewData(null);
        setPreviewError(
          error instanceof Error
            ? error.message
            : "Impossible de calculer la preview de conversion."
        );
      } finally {
        setIsLoadingPreview(false);
      }
    },
    [jobId, strategy, targetSectionId]
  );

  useEffect(() => {
    if (!open) return;

    let active = true;

    const loadSections = async () => {
      setStep(1);
      setTargetSectionId(null);
      setStrategy("append");
      setSectionOptions([]);
      setSectionsError(null);
      setIsLoadingSections(true);
      setPreviewData(null);
      setPreviewError(null);
      setOverridesByItemId({});
      setGuardResult(null);
      setOverrideJustification("");

      try {
        const estimateItems = await fetchEstimateItemsForVersion(versionId);
        if (!active) return;
        setSectionOptions(buildSectionOptions(estimateItems));
      } catch (error) {
        if (!active) return;
        setSectionsError(
          error instanceof Error
            ? error.message
            : "Impossible de charger les sections du devis."
        );
      } finally {
        if (!active) return;
        setIsLoadingSections(false);
      }
    };

    void loadSections();

    return () => {
      active = false;
    };
  }, [open, versionId]);

  useEffect(() => {
    if (!open || step !== 3) {
      return;
    }

    void refreshPreview(overridesRef.current);
  }, [open, step, strategy, targetSectionId, refreshPreview]);

  const selectedSectionLabel = useMemo(() => {
    if (!targetSectionId) return ROOT_SECTION_LABEL;
    return (
      sectionOptions.find((option) => option.id === targetSectionId)?.summaryLabel ??
      "Section cible"
    );
  }, [sectionOptions, targetSectionId]);

  const serializedOverrides = useMemo(
    () => toOverrideList(overridesByItemId),
    [overridesByItemId]
  );

  const hasPreviewReady =
    previewData !== null && previewError === null && isLoadingPreview === false;
  const canProceed = step < 4;
  const canGoBack = step > 1;
  const canConfirm =
    includedCount > 0 &&
    !isSubmitting &&
    hasPreviewReady &&
    step === 4 &&
    !guardBlocking;

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const handleClose = () => {
    handleOpenChange(false);
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;

    await onConfirm({
      targetSectionId,
      targetSectionLabel: selectedSectionLabel,
      strategy,
      overrides: serializedOverrides,
    });
  };

  const handleOverrideConfirm = async () => {
    if (!isAdmin || overrideJustification.trim().length < 10) return;

    await onConfirm({
      targetSectionId,
      targetSectionLabel: selectedSectionLabel,
      strategy,
      overrides: serializedOverrides,
      override: true,
      overrideJustification: overrideJustification.trim(),
    });
  };

  const handleVerifyAll = useCallback(async () => {
    if (!onVerifyItems || !guardResult) return;
    setIsVerifying(true);
    try {
      await onVerifyItems(guardResult.blocked_items.map((i) => i.item_id));
    } finally {
      setIsVerifying(false);
    }
  }, [onVerifyItems, guardResult]);

  const handleVerifyItem = useCallback(
    async (itemId: string) => {
      if (!onVerifyItems) return;
      setIsVerifying(true);
      try {
        await onVerifyItems([itemId]);
      } finally {
        setIsVerifying(false);
      }
    },
    [onVerifyItems]
  );

  const handleOverrideActionChange = (
    item: TakeoffPreviewConversionResponse["items"][number],
    value: string
  ) => {
    if (value === AUTO_OVERRIDE_VALUE) {
      setOverridesByItemId((previous) => {
        const next = { ...previous };
        delete next[item.item_id];
        return next;
      });
      return;
    }

    const action = value as TakeoffMappingOverride["action"];
    setOverridesByItemId((previous) => ({
      ...previous,
      [item.item_id]: buildOverrideFromAction({
        item,
        action,
      }),
    }));
  };

  const handleOverrideParamChange = (
    itemId: string,
    nextOverride: TakeoffMappingOverride
  ) => {
    setOverridesByItemId((previous) => ({
      ...previous,
      [itemId]: nextOverride,
    }));
  };

  return (
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content className="max-w-4xl" closeOnOverlayClick={!isSubmitting}>
        <Modal.Header>
          <div>
            <Modal.Title>Appliquer au devis</Modal.Title>
            <p className="mt-1 text-sm text-[var(--slate-500)]">Etape {step} / 4</p>
          </div>
          <Modal.Close disabled={isSubmitting} />
        </Modal.Header>

        <Modal.Body>
          <div className="mb-2 flex items-center gap-2">
            {[1, 2, 3, 4].map((value) => {
              const active = step === value;
              const done = step > value;
              return (
                <span
                  key={value}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                    active
                      ? "bg-[var(--info)] text-white"
                      : done
                        ? "bg-[var(--success)] text-white"
                        : "bg-[var(--slate-100)] text-[var(--slate-500)]"
                  }`}
                >
                  {value}
                </span>
              );
            })}
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <label className="block text-xs font-semibold text-[var(--slate-700)]">
                Version cible
                <input
                  className="form-input mt-1 w-full bg-[var(--slate-50)]"
                  value={versionId}
                  readOnly
                />
              </label>

              <div>
                <label className="block text-xs font-semibold text-[var(--slate-700)]">
                  Section cible
                </label>
                <select
                  className="form-input form-select mt-1 w-full"
                  value={targetSectionId ?? ROOT_SECTION_VALUE}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTargetSectionId(value === ROOT_SECTION_VALUE ? null : value);
                    setPreviewData(null);
                    setPreviewError(null);
                  }}
                  disabled={isLoadingSections || isSubmitting}
                >
                  <option value={ROOT_SECTION_VALUE}>{ROOT_SECTION_LABEL}</option>
                  {sectionOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {isLoadingSections && (
                <div className="alert alert-info">Chargement des sections...</div>
              )}
              {sectionsError && <div className="alert alert-error">{sectionsError}</div>}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              {STRATEGY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--slate-200)] p-3"
                >
                  <input
                    type="radio"
                    name="takeoff-apply-strategy"
                    value={option.value}
                    checked={strategy === option.value}
                    onChange={() => {
                      setStrategy(option.value);
                      setPreviewData(null);
                      setPreviewError(null);
                    }}
                    disabled={isSubmitting}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-[var(--slate-800)]">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-sm text-[var(--slate-600)]">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-3 text-xs text-[var(--slate-700)]">
                <div className="flex flex-wrap items-center gap-4">
                  <span>
                    Items total: <strong>{previewData?.summary.total_count ?? 0}</strong>
                  </span>
                  <span>
                    Transformes: <strong>{previewData?.summary.transformed_count ?? 0}</strong>
                  </span>
                  <span>
                    Overrides: <strong>{serializedOverrides.length}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void refreshPreview(overridesByItemId)}
                  disabled={isLoadingPreview || isSubmitting}
                >
                  {isLoadingPreview ? "Calcul..." : "Recalculer preview"}
                </button>
              </div>

              {isLoadingPreview && (
                <div className="alert alert-info">Calcul de la preview de conversion...</div>
              )}

              {previewError && (
                <div className="alert alert-error">{previewError}</div>
              )}

              {previewData && (
                <div className="max-h-[380px] overflow-auto rounded-xl border border-[var(--slate-200)]">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-600)]">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2">Regle</th>
                        <th className="px-3 py-2">Override</th>
                        <th className="px-3 py-2">Parametre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.items.map((item) => {
                        const override = overridesByItemId[item.item_id];
                        const selectedAction = override?.action ?? AUTO_OVERRIDE_VALUE;

                        return (
                          <tr key={item.item_id} className="border-t border-[var(--slate-200)] align-top">
                            <td className="px-3 py-2">
                              <p className="font-medium text-[var(--slate-800)]">{item.original.designation}</p>
                              <p className="text-xs text-[var(--slate-500)]">
                                Apres: {item.transformed.designation}
                              </p>
                            </td>
                            <td className="px-3 py-2 text-xs text-[var(--slate-700)]">
                              {summarizeAction(item)}
                            </td>
                            <td className="px-3 py-2">
                              <select
                                className="form-input form-select w-full"
                                value={selectedAction}
                                onChange={(event) =>
                                  handleOverrideActionChange(item, event.target.value)
                                }
                                disabled={isSubmitting}
                              >
                                <option value={AUTO_OVERRIDE_VALUE}>Regle auto</option>
                                {OVERRIDE_ACTION_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              {override?.action === "rename" && (
                                <input
                                  className="form-input w-full"
                                  value={override.action_params.designation}
                                  onChange={(event) =>
                                    handleOverrideParamChange(item.item_id, {
                                      ...override,
                                      action_params: {
                                        designation: event.target.value,
                                      },
                                    })
                                  }
                                />
                              )}
                              {override?.action === "set_price" && (
                                <input
                                  type="number"
                                  min={0}
                                  className="form-input w-full"
                                  value={override.action_params.unit_price_cents}
                                  onChange={(event) =>
                                    handleOverrideParamChange(item.item_id, {
                                      ...override,
                                      action_params: {
                                        unit_price_cents: Number(event.target.value),
                                      },
                                    })
                                  }
                                />
                              )}
                              {override?.action === "set_category" && (
                                <input
                                  className="form-input w-full"
                                  placeholder="UUID category"
                                  value={override.action_params.category_id}
                                  onChange={(event) =>
                                    handleOverrideParamChange(item.item_id, {
                                      ...override,
                                      action_params: {
                                        category_id: event.target.value,
                                      },
                                    })
                                  }
                                />
                              )}
                              {override?.action === "apply_assembly" && (
                                <input
                                  className="form-input w-full"
                                  placeholder="UUID assembly"
                                  value={override.action_params.assembly_id}
                                  onChange={(event) =>
                                    handleOverrideParamChange(item.item_id, {
                                      ...override,
                                      action_params: {
                                        assembly_id: event.target.value,
                                      },
                                    })
                                  }
                                />
                              )}
                              {(override?.action === "skip" || override?.action === "none") && (
                                <span className="text-xs text-[var(--slate-500)]">Aucun parametre</span>
                              )}
                              {!override && (
                                <span className="text-xs text-[var(--slate-500)]">
                                  Utiliser la regle proposee
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              {/* Guard panel — shown when Level C has blocked items */}
              {guardBlocking && guardResult && externalItems && (
                <GuardPanel
                  guardResult={guardResult}
                  items={externalItems}
                  isAdmin={isAdmin}
                  isVerifying={isVerifying}
                  overrideJustification={overrideJustification}
                  onVerifyAll={() => void handleVerifyAll()}
                  onVerifyItem={(id) => void handleVerifyItem(id)}
                  onReturnToReview={onReturnToReview}
                  onOverrideJustificationChange={setOverrideJustification}
                  onOverrideConfirm={() => void handleOverrideConfirm()}
                />
              )}

              {/* Medium-only warning when guard passed but medium items exist */}
              {isLevelC &&
                guardResult &&
                guardResult.passed &&
                guardResult.medium_items.length > 0 && (
                  <div className="rounded-xl border border-[var(--info)] bg-blue-50 p-3">
                    <p className="text-xs font-semibold text-[var(--info)]">
                      Items confiance moyenne (non bloquants)
                    </p>
                    <p className="mt-1 text-xs text-[var(--slate-600)]">
                      {guardResult.medium_items.length} item(s) ont une confiance
                      moyenne (50-80%). Verification recommandee mais non obligatoire.
                    </p>
                  </div>
                )}

              {/* Standard recap — shown when no guard blocking */}
              {!guardBlocking && (
                <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4 text-sm">
                  <p className="font-semibold text-[var(--slate-800)]">Recapitulatif</p>
                  <p className="mt-2 text-[var(--slate-700)]">Version: {versionId}</p>
                  <p className="mt-1 text-[var(--slate-700)]">Section: {selectedSectionLabel}</p>
                  <p className="mt-1 text-[var(--slate-700)]">
                    Strategie: {strategy} - {strategyDescription(strategy)}
                  </p>
                  <p className="mt-1 text-[var(--slate-700)]">
                    Items inclus: <strong>{includedCount}</strong>
                  </p>
                  <p className="mt-1 text-[var(--slate-700)]">
                    Items exclus: <strong>{excludedCount}</strong>
                  </p>
                  <p className="mt-1 text-[var(--slate-700)]">
                    Overrides envoyes: <strong>{serializedOverrides.length}</strong>
                  </p>
                </div>
              )}

              {includedCount === 0 && (
                <div className="alert alert-info">
                  Aucun item inclus n&apos;est disponible pour application.
                </div>
              )}

              {!hasPreviewReady && !guardBlocking && (
                <div className="alert alert-error">
                  Une preview valide est requise avant confirmation.
                </div>
              )}
            </div>
          )}

          {submitError && <div className="alert alert-error">{submitError}</div>}
        </Modal.Body>

        <Modal.Footer>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Annuler
          </button>

          {canGoBack && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setStep((previous) => (previous - 1) as WizardStep)}
              disabled={isSubmitting}
            >
              Retour
            </button>
          )}

          {canProceed ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setStep((previous) => (previous + 1) as WizardStep)}
              disabled={
                isSubmitting ||
                (step === 3 && (!hasPreviewReady || isLoadingPreview))
              }
            >
              Suivant
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleConfirm()}
              disabled={!canConfirm}
            >
              {isSubmitting ? "Application..." : "Confirmer l'application"}
            </button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
