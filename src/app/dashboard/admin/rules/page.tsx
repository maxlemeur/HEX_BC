import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import {
  createEstimateRuleForCurrentTenant,
  deleteEstimateRuleForCurrentTenant,
  listEstimateRulesForCurrentTenant,
  updateEstimateRuleForCurrentTenant,
} from "@/lib/estimates/rules-engine";
import {
  DEFAULT_APPROVAL_THRESHOLD_EUROS,
  formatRuleThreshold,
  toDisplayedRuleThreshold,
  toPersistedRuleThreshold,
} from "@/lib/estimates/rule-threshold";

type RuleType =
  | "min_margin"
  | "max_discount"
  | "require_approval"
  | "critical_exceptions_max"
  | "missing_line_evidence_max"
  | "dpgf_coverage_min"
  | "takeoff_evidence_coverage_min";
type ScopeType = "global" | "category" | "client";
type RuleAction = "warn" | "block" | "require_approval";

const RULE_TYPE_OPTIONS: Array<{ value: RuleType; label: string }> = [
  { value: "min_margin", label: "Marge minimum" },
  { value: "max_discount", label: "Remise maximum" },
  { value: "require_approval", label: "Seuil montant HT" },
  { value: "dpgf_coverage_min", label: "Couverture DPGF minimum" },
  {
    value: "takeoff_evidence_coverage_min",
    label: "Couverture preuves takeoff minimum",
  },
  {
    value: "critical_exceptions_max",
    label: "Exceptions critiques maximum",
  },
  {
    value: "missing_line_evidence_max",
    label: "Lignes sans preuve maximum",
  },
];

const SCOPE_TYPE_OPTIONS: Array<{ value: ScopeType; label: string }> = [
  { value: "global", label: "Global" },
  { value: "category", label: "Categorie" },
  { value: "client", label: "Client" },
];

const ACTION_OPTIONS: Array<{ value: RuleAction; label: string }> = [
  { value: "warn", label: "Alerte" },
  { value: "block", label: "Blocage" },
  { value: "require_approval", label: "Demande d'approbation" },
];

function normalizeOptionalUuid(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseRequiredEnum<T extends string>(input: {
  value: FormDataEntryValue | null;
  fieldName: string;
  allowed: readonly T[];
}): T {
  const value = typeof input.value === "string" ? input.value.trim() : "";

  if ((input.allowed as readonly string[]).includes(value)) {
    return value as T;
  }

  throw new Error(`${input.fieldName} invalide.`);
}

function parseThresholdValue(
  value: FormDataEntryValue | null,
  ruleType: RuleType,
) {
  const raw = typeof value === "string" ? value.trim().replace(",", ".") : "";
  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("threshold_value invalide.");
  }

  return toPersistedRuleThreshold(ruleType, parsed);
}

async function createRuleAction(formData: FormData) {
  "use server";

  const ruleType = parseRequiredEnum<RuleType>({
    value: formData.get("rule_type"),
    fieldName: "rule_type",
    allowed: RULE_TYPE_OPTIONS.map((option) => option.value),
  });

  const scopeType = parseRequiredEnum<ScopeType>({
    value: formData.get("scope_type"),
    fieldName: "scope_type",
    allowed: SCOPE_TYPE_OPTIONS.map((option) => option.value),
  });

  const action = parseRequiredEnum<RuleAction>({
    value: formData.get("action"),
    fieldName: "action",
    allowed: ACTION_OPTIONS.map((option) => option.value),
  });

  await createEstimateRuleForCurrentTenant({
    rule_type: ruleType,
    scope_type: scopeType,
    scope_id: normalizeOptionalUuid(formData.get("scope_id")),
    threshold_value: parseThresholdValue(
      formData.get("threshold_value"),
      ruleType,
    ),
    action,
    is_active: formData.get("is_active") === "on",
  });

  revalidatePath("/dashboard/admin/rules");
}

async function updateRuleAction(formData: FormData) {
  "use server";

  const ruleId = normalizeOptionalUuid(formData.get("rule_id"));
  if (!ruleId) {
    throw new Error("rule_id invalide.");
  }

  const ruleType = parseRequiredEnum<RuleType>({
    value: formData.get("rule_type"),
    fieldName: "rule_type",
    allowed: RULE_TYPE_OPTIONS.map((option) => option.value),
  });

  const scopeType = parseRequiredEnum<ScopeType>({
    value: formData.get("scope_type"),
    fieldName: "scope_type",
    allowed: SCOPE_TYPE_OPTIONS.map((option) => option.value),
  });

  const action = parseRequiredEnum<RuleAction>({
    value: formData.get("action"),
    fieldName: "action",
    allowed: ACTION_OPTIONS.map((option) => option.value),
  });

  await updateEstimateRuleForCurrentTenant({
    id: ruleId,
    patch: {
      rule_type: ruleType,
      scope_type: scopeType,
      scope_id: normalizeOptionalUuid(formData.get("scope_id")),
      threshold_value: parseThresholdValue(
        formData.get("threshold_value"),
        ruleType,
      ),
      action,
      is_active: formData.get("is_active") === "on",
    },
  });

  revalidatePath("/dashboard/admin/rules");
}

async function toggleRuleAction(formData: FormData) {
  "use server";

  const ruleId = normalizeOptionalUuid(formData.get("rule_id"));
  if (!ruleId) {
    throw new Error("rule_id invalide.");
  }

  const ruleType = parseRequiredEnum<RuleType>({
    value: formData.get("rule_type"),
    fieldName: "rule_type",
    allowed: RULE_TYPE_OPTIONS.map((option) => option.value),
  });

  const scopeType = parseRequiredEnum<ScopeType>({
    value: formData.get("scope_type"),
    fieldName: "scope_type",
    allowed: SCOPE_TYPE_OPTIONS.map((option) => option.value),
  });

  const action = parseRequiredEnum<RuleAction>({
    value: formData.get("action"),
    fieldName: "action",
    allowed: ACTION_OPTIONS.map((option) => option.value),
  });

  const nextIsActive = formData.get("next_is_active") === "true";

  await updateEstimateRuleForCurrentTenant({
    id: ruleId,
    patch: {
      rule_type: ruleType,
      scope_type: scopeType,
      scope_id: normalizeOptionalUuid(formData.get("scope_id")),
      threshold_value: parseThresholdValue(
        formData.get("threshold_value"),
        ruleType,
      ),
      action,
      is_active: nextIsActive,
    },
  });

  revalidatePath("/dashboard/admin/rules");
}

async function deleteRuleAction(formData: FormData) {
  "use server";

  const ruleId = normalizeOptionalUuid(formData.get("rule_id"));
  if (!ruleId) {
    throw new Error("rule_id invalide.");
  }

  await deleteEstimateRuleForCurrentTenant(ruleId);
  revalidatePath("/dashboard/admin/rules");
}

function renderRuleTypeLabel(value: RuleType) {
  return RULE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function renderScopeTypeLabel(value: ScopeType) {
  return SCOPE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function renderActionLabel(value: RuleAction) {
  return ACTION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export default async function AdminRulesPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  const { rules } = await listEstimateRulesForCurrentTenant();

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Règles d’approbation</h1>
        <p className="page-description">
          Configurez les garde-fous de marge/remise et les seuils d&apos;approbation.
        </p>
      </div>

      <div className="dashboard-card mb-6 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--slate-500)]">
          Nouvelle règle
        </h2>
        <form action={createRuleAction} className="grid gap-3 lg:grid-cols-6">
          <label className="lg:col-span-1">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">Type</span>
            <select name="rule_type" defaultValue="require_approval" className="form-input h-10">
              {RULE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="lg:col-span-1">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">Scope</span>
            <select name="scope_type" defaultValue="global" className="form-input h-10">
              {SCOPE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="lg:col-span-1">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">Scope ID</span>
            <input
              name="scope_id"
              type="text"
              className="form-input h-10"
              placeholder="UUID optionnel"
            />
          </label>

          <label className="lg:col-span-1">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">Seuil</span>
            <input
              name="threshold_value"
              type="number"
              min="0"
              step="0.01"
              className="form-input h-10"
              defaultValue={DEFAULT_APPROVAL_THRESHOLD_EUROS}
              required
            />
            <span className="mt-1 block text-[11px] text-[var(--slate-500)]">
              Pour une approbation, saisissez le montant en euros HT. La règle
              se déclenche dès que ce seuil est atteint.
            </span>
          </label>

          <label className="lg:col-span-1">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">Action</span>
            <select name="action" defaultValue="require_approval" className="form-input h-10">
              {ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end gap-3 lg:col-span-1">
            <label className="inline-flex items-center gap-2 text-sm text-[var(--slate-700)]">
              <input name="is_active" type="checkbox" defaultChecked />
              Active
            </label>
            <button type="submit" className="btn btn-primary ml-auto">
              Ajouter
            </button>
          </div>
        </form>
      </div>

      <div className="dashboard-card overflow-hidden">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Règle</th>
                <th>Scope</th>
                <th>Scope ID</th>
                <th>Seuil</th>
                <th>Action</th>
                <th>État</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--slate-500)]">
                    Aucune règle configurée.
                  </td>
                </tr>
              ) : (
                rules.map((rule) => (
                  <tr key={rule.id}>
                    <td className="text-sm text-[var(--slate-700)]">
                      {renderRuleTypeLabel(rule.rule_type)}
                    </td>
                    <td className="text-sm text-[var(--slate-700)]">
                      {renderScopeTypeLabel(rule.scope_type)}
                    </td>
                    <td className="font-mono text-xs text-[var(--slate-600)]">
                      {rule.scope_id ?? "—"}
                    </td>
                    <td className="text-sm text-[var(--slate-700)]">
                      {formatRuleThreshold(
                        rule.rule_type,
                        rule.threshold_value,
                      )}
                    </td>
                    <td className="text-sm text-[var(--slate-700)]">{renderActionLabel(rule.action)}</td>
                    <td>
                      {rule.is_active ? (
                        <span className="inline-flex items-center rounded-full bg-[var(--success-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--success)]">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-[var(--slate-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--slate-600)]">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex flex-col items-end gap-2">
                        <details className="dashboard-card w-full max-w-[760px] p-3 text-left">
                          <summary className="cursor-pointer text-sm font-medium text-[var(--slate-700)]">
                            Éditer
                          </summary>
                          <form action={updateRuleAction} className="mt-3 grid gap-2 lg:grid-cols-6">
                            <input type="hidden" name="rule_id" value={rule.id} />
                            <select name="rule_type" defaultValue={rule.rule_type} className="form-input h-9 text-sm">
                              {RULE_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <select name="scope_type" defaultValue={rule.scope_type} className="form-input h-9 text-sm">
                              {SCOPE_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <input
                              name="scope_id"
                              defaultValue={rule.scope_id ?? ""}
                              className="form-input h-9 text-sm"
                              placeholder="UUID optionnel"
                            />
                            <input
                              name="threshold_value"
                              type="number"
                              min="0"
                              step="0.01"
                              defaultValue={toDisplayedRuleThreshold(
                                rule.rule_type,
                                rule.threshold_value,
                              )}
                              className="form-input h-9 text-sm"
                              required
                            />
                            <select name="action" defaultValue={rule.action} className="form-input h-9 text-sm">
                              {ACTION_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <div className="flex items-center justify-between gap-2">
                              <label className="inline-flex items-center gap-2 text-xs text-[var(--slate-700)]">
                                <input type="checkbox" name="is_active" defaultChecked={rule.is_active} />
                                Actif
                              </label>
                              <button type="submit" className="btn btn-secondary btn-sm">
                                Enregistrer
                              </button>
                            </div>
                          </form>
                        </details>

                        <div className="inline-flex items-center gap-2">
                          <form action={toggleRuleAction}>
                            <input type="hidden" name="rule_id" value={rule.id} />
                            <input type="hidden" name="rule_type" value={rule.rule_type} />
                            <input type="hidden" name="scope_type" value={rule.scope_type} />
                            <input type="hidden" name="scope_id" value={rule.scope_id ?? ""} />
                            <input
                              type="hidden"
                              name="threshold_value"
                              value={toDisplayedRuleThreshold(
                                rule.rule_type,
                                rule.threshold_value,
                              )}
                            />
                            <input type="hidden" name="action" value={rule.action} />
                            <input
                              type="hidden"
                              name="next_is_active"
                              value={rule.is_active ? "false" : "true"}
                            />
                            <button type="submit" className="btn btn-secondary btn-sm">
                              {rule.is_active ? "Désactiver" : "Activer"}
                            </button>
                          </form>

                          <form action={deleteRuleAction}>
                            <input type="hidden" name="rule_id" value={rule.id} />
                            <button type="submit" className="btn btn-danger btn-sm">
                              Supprimer
                            </button>
                          </form>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
