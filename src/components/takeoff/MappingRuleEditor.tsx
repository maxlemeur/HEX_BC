"use client";

import { useMemo, useState } from "react";

import type { EstimateAssemblySummary } from "@/lib/estimates/client";
import type {
  CreateTakeoffMappingRuleInput,
  TakeoffMappingRule,
  TakeoffMappingRuleAction,
  TakeoffMappingRuleMatchType,
  UpdateTakeoffMappingRuleInput,
} from "@/lib/takeoff/types";

const MATCH_TYPE_OPTIONS: Array<{
  value: TakeoffMappingRuleMatchType;
  label: string;
  description: string;
}> = [
  {
    value: "contains",
    label: "Contains",
    description: "Le pattern peut apparaitre n'importe ou dans la designation.",
  },
  {
    value: "exact",
    label: "Exact",
    description: "La designation doit correspondre exactement au pattern.",
  },
  {
    value: "regex",
    label: "Regex",
    description: "Utilise une expression reguliere (mode insensible a la casse).",
  },
];

const ACTION_OPTIONS: Array<{
  value: TakeoffMappingRuleAction;
  label: string;
  description: string;
}> = [
  {
    value: "rename",
    label: "Rename",
    description: "Remplace la designation source par la designation cible.",
  },
  {
    value: "set_price",
    label: "Set price",
    description: "Force le prix unitaire en centimes.",
  },
  {
    value: "set_category",
    label: "Set category",
    description: "Assigne une categorie via son UUID.",
  },
  {
    value: "apply_assembly",
    label: "Apply assembly",
    description: "Applique un assemblage predefini.",
  },
  {
    value: "skip",
    label: "Skip",
    description: "Ignore l'item (aucune transformation).",
  },
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MappingRuleEditorMode = "create" | "edit";

type MappingRuleEditorFormState = {
  name: string;
  matchPattern: string;
  matchType: TakeoffMappingRuleMatchType;
  action: TakeoffMappingRuleAction;
  priority: string;
  isActive: boolean;
  renameDesignation: string;
  setPriceCents: string;
  setCategoryId: string;
  applyAssemblyId: string;
  previewDesignation: string;
};

type MappingRuleEditorErrors = Partial<{
  name: string;
  matchPattern: string;
  priority: string;
  renameDesignation: string;
  setPriceCents: string;
  setCategoryId: string;
  applyAssemblyId: string;
}>;

type PreviewResult = {
  state: "idle" | "match" | "no-match" | "invalid";
  message: string;
};

export type MappingRuleEditorSubmitPayload =
  | CreateTakeoffMappingRuleInput
  | UpdateTakeoffMappingRuleInput;

export type MappingRuleEditorProps = {
  mode: MappingRuleEditorMode;
  initialRule?: TakeoffMappingRule | null;
  assemblies?: EstimateAssemblySummary[];
  defaultPriority?: number;
  isSubmitting?: boolean;
  onCancel?: () => void;
  onSubmit: (payload: MappingRuleEditorSubmitPayload) => Promise<void> | void;
};

function parsePriorityOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) {
    return null;
  }

  return parsed;
}

function toInitialFormState(
  mode: MappingRuleEditorMode,
  initialRule: TakeoffMappingRule | null | undefined,
  defaultPriority: number
): MappingRuleEditorFormState {
  if (mode === "edit" && initialRule) {
    return {
      name: initialRule.name,
      matchPattern: initialRule.match_pattern,
      matchType: initialRule.match_type,
      action: initialRule.action,
      priority: String(initialRule.priority),
      isActive: initialRule.is_active,
      renameDesignation:
        initialRule.action === "rename"
          ? initialRule.action_params.designation
          : "",
      setPriceCents:
        initialRule.action === "set_price"
          ? String(initialRule.action_params.unit_price_cents)
          : "",
      setCategoryId:
        initialRule.action === "set_category"
          ? initialRule.action_params.category_id
          : "",
      applyAssemblyId:
        initialRule.action === "apply_assembly"
          ? initialRule.action_params.assembly_id
          : "",
      previewDesignation: initialRule.match_pattern,
    };
  }

  return {
    name: "",
    matchPattern: "",
    matchType: "contains",
    action: "rename",
    priority: String(defaultPriority),
    isActive: true,
    renameDesignation: "",
    setPriceCents: "",
    setCategoryId: "",
    applyAssemblyId: "",
    previewDesignation: "",
  };
}

function validateFormState(
  state: MappingRuleEditorFormState,
  assemblies: EstimateAssemblySummary[],
  options: {
    allowAssemblyIdOutsideLoadedList?: string | null;
  } = {}
): MappingRuleEditorErrors {
  const errors: MappingRuleEditorErrors = {};

  if (!state.name.trim()) {
    errors.name = "Le nom est obligatoire.";
  } else if (state.name.trim().length > 160) {
    errors.name = "Le nom doit contenir au maximum 160 caracteres.";
  }

  if (!state.matchPattern.trim()) {
    errors.matchPattern = "Le pattern est obligatoire.";
  } else if (state.matchPattern.trim().length > 500) {
    errors.matchPattern = "Le pattern doit contenir au maximum 500 caracteres.";
  } else if (state.matchType === "regex") {
    try {
      new RegExp(state.matchPattern.trim());
    } catch {
      errors.matchPattern = "Le pattern regex est invalide.";
    }
  }

  const parsedPriority = parsePriorityOrNull(state.priority);
  if (parsedPriority === null) {
    errors.priority = "La priorite doit etre un entier entre 0 et 100000.";
  }

  if (state.action === "rename") {
    if (!state.renameDesignation.trim()) {
      errors.renameDesignation = "La designation cible est obligatoire.";
    } else if (state.renameDesignation.trim().length > 500) {
      errors.renameDesignation =
        "La designation cible doit contenir au maximum 500 caracteres.";
    }
  }

  if (state.action === "set_price") {
    const parsedPrice = parsePriorityOrNull(state.setPriceCents);
    if (parsedPrice === null) {
      errors.setPriceCents = "Le prix unitaire doit etre un entier positif ou nul.";
    }
  }

  if (state.action === "set_category") {
    const normalizedCategoryId = state.setCategoryId.trim();
    if (!normalizedCategoryId) {
      errors.setCategoryId = "L'UUID de categorie est obligatoire.";
    } else if (!UUID_PATTERN.test(normalizedCategoryId)) {
      errors.setCategoryId = "UUID de categorie invalide.";
    }
  }

  if (state.action === "apply_assembly") {
    const normalizedAssemblyId = state.applyAssemblyId.trim();
    const allowedAssemblyId =
      options.allowAssemblyIdOutsideLoadedList?.trim() ?? null;
    if (!normalizedAssemblyId) {
      errors.applyAssemblyId = "Selectionnez un assemblage valide.";
    } else if (!UUID_PATTERN.test(normalizedAssemblyId)) {
      errors.applyAssemblyId = "UUID d'assemblage invalide.";
    } else if (
      assemblies.length > 0 &&
      !assemblies.some((assembly) => assembly.id === normalizedAssemblyId) &&
      normalizedAssemblyId !== allowedAssemblyId
    ) {
      errors.applyAssemblyId =
        "L'assemblage selectionne est introuvable dans la liste chargee.";
    }
  }

  return errors;
}

function evaluatePreview(
  matchType: TakeoffMappingRuleMatchType,
  matchPattern: string,
  designation: string
): PreviewResult {
  const normalizedPattern = matchPattern.trim();
  const normalizedDesignation = designation.trim();

  if (!normalizedDesignation) {
    return {
      state: "idle",
      message: "Saisissez une designation de test pour verifier la regle.",
    };
  }

  if (!normalizedPattern) {
    return {
      state: "invalid",
      message: "Le pattern est vide: impossible de calculer un match.",
    };
  }

  if (matchType === "exact") {
    const isMatch =
      normalizedDesignation.toLowerCase() === normalizedPattern.toLowerCase();
    return {
      state: isMatch ? "match" : "no-match",
      message: isMatch
        ? "Correspondance detectee (exact)."
        : "Aucune correspondance (exact).",
    };
  }

  if (matchType === "contains") {
    const isMatch = normalizedDesignation
      .toLowerCase()
      .includes(normalizedPattern.toLowerCase());
    return {
      state: isMatch ? "match" : "no-match",
      message: isMatch
        ? "Correspondance detectee (contains)."
        : "Aucune correspondance (contains).",
    };
  }

  try {
    const isMatch = new RegExp(normalizedPattern, "i").test(normalizedDesignation);
    return {
      state: isMatch ? "match" : "no-match",
      message: isMatch
        ? "Correspondance detectee (regex)."
        : "Aucune correspondance (regex).",
    };
  } catch {
    return {
      state: "invalid",
      message: "Regex invalide: corrigez le pattern pour activer la preview.",
    };
  }
}

function buildCreatePayload(
  state: MappingRuleEditorFormState
): CreateTakeoffMappingRuleInput {
  const common = {
    name: state.name.trim(),
    match_pattern: state.matchPattern.trim(),
    match_type: state.matchType,
    priority: parsePriorityOrNull(state.priority) ?? 0,
    is_active: state.isActive,
  };

  switch (state.action) {
    case "rename":
      return {
        ...common,
        action: "rename",
        action_params: {
          designation: state.renameDesignation.trim(),
        },
      };
    case "set_price":
      return {
        ...common,
        action: "set_price",
        action_params: {
          unit_price_cents: parsePriorityOrNull(state.setPriceCents) ?? 0,
        },
      };
    case "set_category":
      return {
        ...common,
        action: "set_category",
        action_params: {
          category_id: state.setCategoryId.trim(),
        },
      };
    case "apply_assembly":
      return {
        ...common,
        action: "apply_assembly",
        action_params: {
          assembly_id: state.applyAssemblyId.trim(),
        },
      };
    case "skip":
      return {
        ...common,
        action: "skip",
        action_params: {},
      };
    default: {
      const exhaustiveCheck: never = state.action;
      return exhaustiveCheck;
    }
  }
}

function buildUpdatePayload(
  state: MappingRuleEditorFormState
): UpdateTakeoffMappingRuleInput {
  const common = {
    name: state.name.trim(),
    match_pattern: state.matchPattern.trim(),
    match_type: state.matchType,
    priority: parsePriorityOrNull(state.priority) ?? 0,
    is_active: state.isActive,
  };

  switch (state.action) {
    case "rename":
      return {
        ...common,
        action: "rename",
        action_params: {
          designation: state.renameDesignation.trim(),
        },
      };
    case "set_price":
      return {
        ...common,
        action: "set_price",
        action_params: {
          unit_price_cents: parsePriorityOrNull(state.setPriceCents) ?? 0,
        },
      };
    case "set_category":
      return {
        ...common,
        action: "set_category",
        action_params: {
          category_id: state.setCategoryId.trim(),
        },
      };
    case "apply_assembly":
      return {
        ...common,
        action: "apply_assembly",
        action_params: {
          assembly_id: state.applyAssemblyId.trim(),
        },
      };
    case "skip":
      return {
        ...common,
        action: "skip",
        action_params: {},
      };
    default: {
      const exhaustiveCheck: never = state.action;
      return exhaustiveCheck;
    }
  }
}

export function MappingRuleEditor({
  mode,
  initialRule = null,
  assemblies = [],
  defaultPriority = 100,
  isSubmitting = false,
  onCancel,
  onSubmit,
}: MappingRuleEditorProps) {
  const [state, setState] = useState<MappingRuleEditorFormState>(() =>
    toInitialFormState(mode, initialRule, defaultPriority)
  );
  const [errors, setErrors] = useState<MappingRuleEditorErrors>({});

  const previewResult = useMemo(
    () => evaluatePreview(state.matchType, state.matchPattern, state.previewDesignation),
    [state.matchPattern, state.matchType, state.previewDesignation]
  );
  const selectedAssemblyMissing = useMemo(() => {
    if (state.action !== "apply_assembly") return false;
    const normalizedAssemblyId = state.applyAssemblyId.trim();
    if (!normalizedAssemblyId) return false;

    return !assemblies.some((assembly) => assembly.id === normalizedAssemblyId);
  }, [assemblies, state.action, state.applyAssemblyId]);

  const previewClassName = (() => {
    if (previewResult.state === "match") return "text-emerald-700";
    if (previewResult.state === "no-match") return "text-[var(--slate-600)]";
    if (previewResult.state === "invalid") return "text-rose-700";
    return "text-[var(--slate-500)]";
  })();

  const submitLabel =
    mode === "edit"
      ? isSubmitting
        ? "Enregistrement..."
        : "Enregistrer la regle"
      : isSubmitting
        ? "Creation..."
        : "Creer la regle";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const allowedAssemblyId =
      mode === "edit" && initialRule?.action === "apply_assembly"
        ? initialRule.action_params.assembly_id
        : null;
    const nextErrors = validateFormState(state, assemblies, {
      allowAssemblyIdOutsideLoadedList: allowedAssemblyId,
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const payload =
      mode === "edit" ? buildUpdatePayload(state) : buildCreatePayload(state);
    await Promise.resolve(onSubmit(payload));
  }

  function setField<Key extends keyof MappingRuleEditorFormState>(
    key: Key,
    value: MappingRuleEditorFormState[Key]
  ) {
    setState((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  function clearError<K extends keyof MappingRuleEditorErrors>(key: K) {
    setErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  return (
    <section className="dashboard-card p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--slate-900)]">
          {mode === "edit"
            ? "Edition d&apos;une regle de mapping"
            : "Nouvelle regle de mapping"}
        </h2>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Configurez la correspondance designation et l&apos;action d&apos;enrichissement.
        </p>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="form-label" htmlFor="mapping-rule-name">
              Nom de la regle
            </label>
            <input
              id="mapping-rule-name"
              className={`form-input ${errors.name ? "border-[var(--error)]" : ""}`}
              value={state.name}
              onChange={(event) => {
                setField("name", event.target.value);
                clearError("name");
              }}
              placeholder="Ex: Renommage tube PVC"
              disabled={isSubmitting}
            />
            {errors.name ? (
              <p className="mt-1 text-xs text-rose-700">{errors.name}</p>
            ) : null}
          </div>

          <div>
            <label className="form-label" htmlFor="mapping-rule-match-type">
              Type de match
            </label>
            <select
              id="mapping-rule-match-type"
              className="form-input form-select"
              value={state.matchType}
              onChange={(event) => {
                setField("matchType", event.target.value as TakeoffMappingRuleMatchType);
                clearError("matchPattern");
              }}
              disabled={isSubmitting}
            >
              {MATCH_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              {MATCH_TYPE_OPTIONS.find((option) => option.value === state.matchType)?.description}
            </p>
          </div>

          <div>
            <label className="form-label" htmlFor="mapping-rule-match-pattern">
              Pattern de correspondance
            </label>
            <input
              id="mapping-rule-match-pattern"
              className={`form-input ${errors.matchPattern ? "border-[var(--error)]" : ""}`}
              value={state.matchPattern}
              onChange={(event) => {
                setField("matchPattern", event.target.value);
                clearError("matchPattern");
              }}
              placeholder={
                state.matchType === "regex" ? "Ex: ^tube\\s+pvc(\\s+\\d+)?$" : "Ex: tube pvc"
              }
              disabled={isSubmitting}
            />
            {errors.matchPattern ? (
              <p className="mt-1 text-xs text-rose-700">{errors.matchPattern}</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
          <label className="form-label" htmlFor="mapping-rule-preview-designation">
            Test designation (preview)
          </label>
          <input
            id="mapping-rule-preview-designation"
            className="form-input mt-1"
            value={state.previewDesignation}
            onChange={(event) => setField("previewDesignation", event.target.value)}
            placeholder="Ex: Tube PVC DN40"
            disabled={isSubmitting}
          />
          <p className={`mt-2 text-sm ${previewClassName}`}>{previewResult.message}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="mapping-rule-action">
              Action
            </label>
            <select
              id="mapping-rule-action"
              className="form-input form-select"
              value={state.action}
              onChange={(event) =>
                setField("action", event.target.value as TakeoffMappingRuleAction)
              }
              disabled={isSubmitting}
            >
              {ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              {ACTION_OPTIONS.find((option) => option.value === state.action)?.description}
            </p>
          </div>

          <div>
            <label className="form-label" htmlFor="mapping-rule-priority">
              Priorite
            </label>
            <input
              id="mapping-rule-priority"
              type="number"
              min={0}
              max={100000}
              step={1}
              inputMode="numeric"
              className={`form-input ${errors.priority ? "border-[var(--error)]" : ""}`}
              value={state.priority}
              onChange={(event) => {
                setField("priority", event.target.value);
                clearError("priority");
              }}
              disabled={isSubmitting}
            />
            {errors.priority ? (
              <p className="mt-1 text-xs text-rose-700">{errors.priority}</p>
            ) : null}
          </div>
        </div>

        {state.action === "rename" ? (
          <div>
            <label className="form-label" htmlFor="mapping-rule-action-rename">
              Nouvelle designation
            </label>
            <input
              id="mapping-rule-action-rename"
              className={`form-input ${errors.renameDesignation ? "border-[var(--error)]" : ""}`}
              value={state.renameDesignation}
              onChange={(event) => {
                setField("renameDesignation", event.target.value);
                clearError("renameDesignation");
              }}
              placeholder="Ex: Tube PVC pression"
              disabled={isSubmitting}
            />
            {errors.renameDesignation ? (
              <p className="mt-1 text-xs text-rose-700">{errors.renameDesignation}</p>
            ) : null}
          </div>
        ) : null}

        {state.action === "set_price" ? (
          <div>
            <label className="form-label" htmlFor="mapping-rule-action-price">
              Prix unitaire (centimes)
            </label>
            <input
              id="mapping-rule-action-price"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className={`form-input ${errors.setPriceCents ? "border-[var(--error)]" : ""}`}
              value={state.setPriceCents}
              onChange={(event) => {
                setField("setPriceCents", event.target.value);
                clearError("setPriceCents");
              }}
              placeholder="Ex: 1890"
              disabled={isSubmitting}
            />
            {errors.setPriceCents ? (
              <p className="mt-1 text-xs text-rose-700">{errors.setPriceCents}</p>
            ) : (
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                1890 = 18,90 dans la devise du devis.
              </p>
            )}
          </div>
        ) : null}

        {state.action === "set_category" ? (
          <div>
            <label className="form-label" htmlFor="mapping-rule-action-category">
              UUID categorie
            </label>
            <input
              id="mapping-rule-action-category"
              className={`form-input ${errors.setCategoryId ? "border-[var(--error)]" : ""}`}
              value={state.setCategoryId}
              onChange={(event) => {
                setField("setCategoryId", event.target.value);
                clearError("setCategoryId");
              }}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              disabled={isSubmitting}
            />
            {errors.setCategoryId ? (
              <p className="mt-1 text-xs text-rose-700">{errors.setCategoryId}</p>
            ) : null}
          </div>
        ) : null}

        {state.action === "apply_assembly" ? (
          <div>
            <label className="form-label" htmlFor="mapping-rule-action-assembly">
              Assemblage
            </label>
            <select
              id="mapping-rule-action-assembly"
              className={`form-input form-select ${errors.applyAssemblyId ? "border-[var(--error)]" : ""}`}
              value={state.applyAssemblyId}
              onChange={(event) => {
                setField("applyAssemblyId", event.target.value);
                clearError("applyAssemblyId");
              }}
              disabled={
                isSubmitting || (assemblies.length === 0 && !selectedAssemblyMissing)
              }
            >
              <option value="">
                {assemblies.length === 0
                  ? "Aucun assemblage disponible"
                  : "Selectionner un assemblage"}
              </option>
              {selectedAssemblyMissing ? (
                <option value={state.applyAssemblyId}>
                  Assemblage existant ({state.applyAssemblyId})
                </option>
              ) : null}
              {assemblies.map((assembly) => (
                <option key={assembly.id} value={assembly.id}>
                  {assembly.name} ({assembly.itemCount} ligne(s))
                </option>
              ))}
            </select>
            {errors.applyAssemblyId ? (
              <p className="mt-1 text-xs text-rose-700">{errors.applyAssemblyId}</p>
            ) : (
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                Charge depuis la bibliotheque d&apos;assemblages du tenant (limite 100).
              </p>
            )}
          </div>
        ) : null}

        {state.action === "skip" ? (
          <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4 text-sm text-[var(--slate-600)]">
            Cette action ignore l&apos;item source: aucun parametre supplementaire requis.
          </div>
        ) : null}

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={state.isActive}
            onChange={(event) => setField("isActive", event.target.checked)}
            disabled={isSubmitting}
          />
          <span className="text-sm font-medium text-[var(--slate-700)]">
            Regle active
          </span>
        </label>

        <div className="flex flex-wrap justify-end gap-3">
          {onCancel ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Annuler
            </button>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {submitLabel}
          </button>
        </div>
      </form>
    </section>
  );
}
