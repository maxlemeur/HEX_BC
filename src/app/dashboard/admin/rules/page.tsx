import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PlusIcon, SlidersHorizontalIcon } from "lucide-react";

import { EmptyTableRow } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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

import { DeleteRuleButton } from "./DeleteRuleButton";

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
    label: "Couverture des preuves de métré minimum",
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
  { value: "category", label: "Catégorie" },
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
      <PageHeader
        breadcrumbs={[
          { label: "Administration", href: "/dashboard/admin" },
          { label: "Règles de contrôle" },
        ]}
        title="Règles de contrôle"
        description="Configurez les garde-fous de marge et de remise ainsi que les seuils d'approbation."
      />

      <div className="flex flex-col gap-6">
        <PageSection title="Nouvelle règle">
          <form action={createRuleAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-start">
            <Field>
              <FieldLabel htmlFor="rule-create-type">Type</FieldLabel>
              <NativeSelect id="rule-create-type" name="rule_type" defaultValue="require_approval">
                {RULE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field>
              <FieldLabel htmlFor="rule-create-scope">Portée</FieldLabel>
              <NativeSelect id="rule-create-scope" name="scope_type" defaultValue="global">
                {SCOPE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field>
              <FieldLabel htmlFor="rule-create-scope-id">Identifiant de portée</FieldLabel>
              <Input
                id="rule-create-scope-id"
                name="scope_id"
                type="text"
                placeholder="UUID (facultatif)"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="rule-create-threshold">Seuil</FieldLabel>
              <Input
                id="rule-create-threshold"
                name="threshold_value"
                type="number"
                min="0"
                step="0.01"
                defaultValue={DEFAULT_APPROVAL_THRESHOLD_EUROS}
                aria-describedby="rule-create-threshold-hint"
                required
              />
              <FieldDescription id="rule-create-threshold-hint" className="text-xs">
                Pour une approbation, saisissez le montant en euros HT. La règle
                se déclenche dès que ce seuil est atteint.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="rule-create-action">Action</FieldLabel>
              <NativeSelect id="rule-create-action" name="action" defaultValue="require_approval">
                {ACTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <div className="flex flex-wrap items-center gap-3 lg:mt-7">
              <label className="inline-flex min-h-11 items-center gap-2 text-sm text-foreground-secondary">
                <input name="is_active" type="checkbox" className="size-4 accent-primary" defaultChecked />
                Active
              </label>
              <button type="submit" className={buttonVariants({ variant: "primary", size: "lg", className: "ml-auto" })}>
                <PlusIcon aria-hidden="true" />
                Ajouter la règle
              </button>
            </div>
          </form>
        </PageSection>

        <PageSection title="Règles configurées" flush>
          <div
            role="region"
            aria-label="Règles configurées"
            tabIndex={0}
            className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Règle</th>
                  <th scope="col">Portée</th>
                  <th scope="col">Identifiant</th>
                  <th scope="col">Seuil</th>
                  <th scope="col">Action</th>
                  <th scope="col">État</th>
                  <th scope="col" className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 ? (
                  <EmptyTableRow
                    colSpan={7}
                    icon={<SlidersHorizontalIcon />}
                    title="Aucune règle configurée"
                    description="Ajoutez une règle pour encadrer les marges, les remises ou les approbations."
                  />
                ) : (
                  rules.map((rule) => {
                    const ruleLabel = renderRuleTypeLabel(rule.rule_type);
                    return (
                      <tr key={rule.id}>
                        <td className="text-sm text-foreground-secondary">{ruleLabel}</td>
                        <td className="text-sm text-foreground-secondary">
                          {renderScopeTypeLabel(rule.scope_type)}
                        </td>
                        <td className="font-mono text-xs text-muted-foreground">
                          {rule.scope_id ?? "—"}
                        </td>
                        <td className="text-sm text-foreground-secondary">
                          {formatRuleThreshold(
                            rule.rule_type,
                            rule.threshold_value,
                          )}
                        </td>
                        <td className="text-sm text-foreground-secondary">{renderActionLabel(rule.action)}</td>
                        <td>
                          <Badge variant={rule.is_active ? "success" : "neutral"} dot>
                            {rule.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <div className="flex flex-col items-end gap-2">
                            <details className="w-full max-w-[760px] rounded-lg border border-border bg-surface p-3 text-left shadow-card">
                              <summary className="min-h-9 cursor-pointer rounded-control text-sm font-medium text-foreground-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                                Modifier
                              </summary>
                              <form action={updateRuleAction} className="mt-3 grid gap-2 lg:grid-cols-6">
                                <input type="hidden" name="rule_id" value={rule.id} />
                                <NativeSelect
                                  size="sm"
                                  name="rule_type"
                                  aria-label={`Type de la règle ${ruleLabel}`}
                                  defaultValue={rule.rule_type}
                                >
                                  {RULE_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </NativeSelect>
                                <NativeSelect
                                  size="sm"
                                  name="scope_type"
                                  aria-label={`Portée de la règle ${ruleLabel}`}
                                  defaultValue={rule.scope_type}
                                >
                                  {SCOPE_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </NativeSelect>
                                <Input
                                  size="sm"
                                  name="scope_id"
                                  aria-label={`Identifiant de portée de la règle ${ruleLabel}`}
                                  defaultValue={rule.scope_id ?? ""}
                                  placeholder="UUID (facultatif)"
                                />
                                <Input
                                  size="sm"
                                  name="threshold_value"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  aria-label={`Seuil de la règle ${ruleLabel}`}
                                  defaultValue={toDisplayedRuleThreshold(
                                    rule.rule_type,
                                    rule.threshold_value,
                                  )}
                                  required
                                />
                                <NativeSelect
                                  size="sm"
                                  name="action"
                                  aria-label={`Action de la règle ${ruleLabel}`}
                                  defaultValue={rule.action}
                                >
                                  {ACTION_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </NativeSelect>
                                <div className="flex items-center justify-between gap-2">
                                  <label className="inline-flex items-center gap-2 text-xs text-foreground-secondary">
                                    <input
                                      type="checkbox"
                                      name="is_active"
                                      className="size-4 accent-primary"
                                      defaultChecked={rule.is_active}
                                    />
                                    Active
                                  </label>
                                  <button type="submit" className={buttonVariants({ variant: "outline", size: "md" })}>
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
                                <button type="submit" className={buttonVariants({ variant: "outline", size: "md" })}>
                                  {rule.is_active ? "Désactiver" : "Activer"}
                                </button>
                              </form>

                              <form action={deleteRuleAction}>
                                <input type="hidden" name="rule_id" value={rule.id} />
                                <DeleteRuleButton
                                  ruleLabel={`${ruleLabel} · ${renderScopeTypeLabel(rule.scope_type)}`}
                                />
                              </form>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </PageSection>
      </div>
    </div>
  );
}
