"use client";

import { type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";
import {
  formatLaborRoleOptionLabel,
  formatMajorationPercentInput,
  parseMajorationPercentToCoefficient,
  type EstimateItem,
  type LaborRole,
} from "@/components/estimates/components/estimate-editor-row/shared";
import { useEstimateEditorRowActions } from "@/components/estimates/context/EstimateEditorRowActionsContext";
import {
  formatCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import {
  ESTIMATE_LINE_NATURE_LABELS,
  ESTIMATE_LINE_NATURES,
  resolveEstimateLineNature,
  type EstimateLineNature,
} from "@/lib/estimates/line-nature";

type MobileEstimateLineEditorProps = {
  open: boolean;
  item: EstimateItem;
  itemNumber: string | null;
  estimateCurrency: SupportedEstimateCurrency;
  unitValue: string;
  supplyTypeValue: string;
  laborRoles: LaborRole[];
  isReadOnly: boolean;
  isLaborSplitEnabled: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onOpenChange: (open: boolean) => void;
  onGoPrevious: () => void;
  onGoNext: () => void;
};

function Field({
  label,
  children,
}: Readonly<{
  label: string;
  children: ReactNode;
}>) {
  return (
    <label className="block min-w-0">
      <span className="form-label mb-1.5 block text-xs">{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--slate-500)]">
      {children}
    </h3>
  );
}

export function MobileEstimateLineEditor({
  open,
  item,
  itemNumber,
  estimateCurrency,
  unitValue,
  supplyTypeValue,
  laborRoles,
  isReadOnly,
  isLaborSplitEnabled,
  canGoPrevious,
  canGoNext,
  onOpenChange,
  onGoPrevious,
  onGoNext,
}: Readonly<MobileEstimateLineEditorProps>) {
  const {
    onPatchItem,
    onUnitChange,
    onUnitCommit,
    onSupplyTypeChange,
    onSupplyTypeCommit,
  } = useEstimateEditorRowActions();
  const majorationPercent = formatMajorationPercentInput(item.h_mo_majoration);
  const inputClassName = "form-input min-h-12 w-full text-base";
  const lineLabel = item.title || "sans titre";

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content
        containerClassName="!absolute inset-x-0 bottom-0 !w-full !max-w-none"
        className="flex max-h-[92dvh] flex-col overflow-hidden rounded-b-none rounded-t-[24px] border-x-0 border-b-0 p-0"
        data-testid="estimate-mobile-line-editor"
      >
        <Modal.Header className="mb-0 shrink-0 border-b border-[var(--slate-200)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-blue)]">
              {itemNumber ? `Ligne ${itemNumber}` : "Ligne de chiffrage"}
            </p>
            <Modal.Title className="mt-0.5 truncate text-lg">
              Modifier la ligne
            </Modal.Title>
          </div>
          <Modal.Close className="shrink-0">Fermer</Modal.Close>
        </Modal.Header>

        <Modal.Body
          key={item.id}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"
        >
          <section className="space-y-3" aria-label="Essentiel">
            <SectionTitle>Essentiel</SectionTitle>
            <Field label="Désignation">
              <input
                className={inputClassName}
                value={item.title}
                disabled={isReadOnly}
                data-modal-autofocus="true"
                data-testid="estimate-mobile-line-title-input"
                onChange={(event) =>
                  onPatchItem(
                    item.id,
                    { title: event.currentTarget.value },
                    { persist: false },
                  )
                }
                onBlur={(event) =>
                  onPatchItem(
                    item.id,
                    { title: event.currentTarget.value },
                    { persist: true },
                  )
                }
              />
            </Field>
            <Field label="Nature de ligne">
              <select
                className={`${inputClassName} form-select`}
                value={resolveEstimateLineNature(item)}
                aria-label={`Nature de ligne pour ${lineLabel}`}
                disabled={isReadOnly}
                onChange={(event) =>
                  onPatchItem(
                    item.id,
                    {
                      line_nature: event.currentTarget
                        .value as EstimateLineNature,
                    },
                    { persist: true },
                  )
                }
              >
                {ESTIMATE_LINE_NATURES.map((nature) => (
                  <option key={nature} value={nature}>
                    {ESTIMATE_LINE_NATURE_LABELS[nature]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <Field label="Quantité">
                <DecimalDraftInput
                  className={inputClassName}
                  value={item.quantity ?? 0}
                  disabled={isReadOnly}
                  aria-label={`Quantité pour ${lineLabel}`}
                  onValueChange={(value) =>
                    onPatchItem(item.id, { quantity: value }, { persist: false })
                  }
                  onValueCommit={(value) =>
                    onPatchItem(item.id, { quantity: value }, { persist: true })
                  }
                />
              </Field>
              <Field label="Unité">
                <input
                  className={inputClassName}
                  value={unitValue}
                  aria-label={`Unité pour ${lineLabel}`}
                  list="estimate-unit-options"
                  disabled={isReadOnly}
                  onChange={(event) =>
                    onUnitChange(item.id, event.currentTarget.value)
                  }
                  onBlur={() => onUnitCommit(item.id)}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-3" aria-label="Fournitures">
            <SectionTitle>Fournitures</SectionTitle>
            <Field label="Prix d’achat unitaire HT">
              <DecimalDraftInput
                className={inputClassName}
                value={(item.unit_price_ht_cents ?? 0) / 100}
                disabled={isReadOnly}
                aria-label={`Prix d’achat unitaire HT pour ${lineLabel}`}
                onValueChange={(value) =>
                  onPatchItem(
                    item.id,
                    { unit_price_ht_cents: Math.round(value * 100) },
                    { persist: false },
                  )
                }
                onValueCommit={(value) =>
                  onPatchItem(
                    item.id,
                    { unit_price_ht_cents: Math.round(value * 100) },
                    { persist: true },
                  )
                }
              />
            </Field>
          </section>

          <section className="space-y-3 rounded-2xl border border-amber-100 bg-amber-50/70 p-3" aria-label="Main d’œuvre">
            <SectionTitle>Main d’œuvre</SectionTitle>
            {isLaborSplitEnabled ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Heures atelier">
                  <DecimalDraftInput
                    className={inputClassName}
                    value={item.h_mo_atelier ?? 0}
                    disabled={isReadOnly}
                    aria-label={`Heures de main-d’œuvre en atelier pour ${lineLabel}`}
                    onValueChange={(value) =>
                      onPatchItem(item.id, { h_mo_atelier: value }, { persist: false })
                    }
                    onValueCommit={(value) =>
                      onPatchItem(item.id, { h_mo_atelier: value }, { persist: true })
                    }
                  />
                </Field>
                <Field label="Heures chantier">
                  <DecimalDraftInput
                    className={inputClassName}
                    value={item.h_mo_chantier ?? 0}
                    disabled={isReadOnly}
                    aria-label={`Heures de main-d’œuvre sur chantier pour ${lineLabel}`}
                    onValueChange={(value) =>
                      onPatchItem(item.id, { h_mo_chantier: value }, { persist: false })
                    }
                    onValueCommit={(value) =>
                      onPatchItem(item.id, { h_mo_chantier: value }, { persist: true })
                    }
                  />
                </Field>
              </div>
            ) : (
              <Field label="Heures de main d’œuvre">
                <DecimalDraftInput
                  className={inputClassName}
                  value={item.h_mo ?? 0}
                  disabled={isReadOnly}
                  aria-label={`Heures de main-d’œuvre pour ${lineLabel}`}
                  onValueChange={(value) =>
                    onPatchItem(item.id, { h_mo: value }, { persist: false })
                  }
                  onValueCommit={(value) =>
                    onPatchItem(item.id, { h_mo: value }, { persist: true })
                  }
                />
              </Field>
            )}
          </section>

          <details className="rounded-2xl border border-[var(--slate-200)] bg-white">
            <summary className="flex min-h-12 cursor-pointer items-center px-3 text-sm font-semibold text-[var(--slate-700)]">
              Paramètres avancés
            </summary>
            <div className="space-y-3 border-t border-[var(--slate-200)] p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type fourniture">
                  <input
                    className={inputClassName}
                    value={supplyTypeValue}
                    aria-label={`Type de fourniture pour ${lineLabel}`}
                    list="estimate-fo-type-options"
                    disabled={isReadOnly}
                    onChange={(event) =>
                      onSupplyTypeChange(item.id, event.currentTarget.value)
                    }
                    onBlur={() => onSupplyTypeCommit(item.id)}
                  />
                </Field>
                <Field label="Coefficient K FO">
                  <DecimalDraftInput
                    className={inputClassName}
                    value={item.k_fo ?? 1}
                    emptyValue={1}
                    disabled={isReadOnly}
                    aria-label={`Coefficient fourniture K FO pour ${lineLabel}`}
                    onValueChange={(value) =>
                      onPatchItem(item.id, { k_fo: value }, { persist: false })
                    }
                    onValueCommit={(value) =>
                      onPatchItem(item.id, { k_fo: value }, { persist: true })
                    }
                  />
                </Field>
              </div>
              <Field label="Majoration main d’œuvre (%)">
                <input
                  className={inputClassName}
                  type="number"
                  min={0}
                  step="0.1"
                  value={majorationPercent}
                  aria-label={`Majoration de main-d’œuvre en pourcentage pour ${lineLabel}`}
                  disabled={isReadOnly}
                  onChange={(event) =>
                    onPatchItem(
                      item.id,
                      {
                        h_mo_majoration: parseMajorationPercentToCoefficient(
                          event.currentTarget.value,
                        ),
                      },
                      { persist: false },
                    )
                  }
                  onBlur={(event) =>
                    onPatchItem(
                      item.id,
                      {
                        h_mo_majoration: parseMajorationPercentToCoefficient(
                          event.currentTarget.value,
                        ),
                      },
                      { persist: true },
                    )
                  }
                />
              </Field>

              {isLaborSplitEnabled ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Rôle atelier">
                      <select
                        className={`${inputClassName} form-select`}
                        value={item.labor_role_atelier_id ?? ""}
                        aria-label={`Rôle de main-d’œuvre en atelier pour ${lineLabel}`}
                        disabled={isReadOnly}
                        onChange={(event) =>
                          onPatchItem(
                            item.id,
                            { labor_role_atelier_id: event.currentTarget.value || null },
                            { persist: true },
                          )
                        }
                      >
                        <option value="">Non défini</option>
                        {laborRoles.map((role) => (
                          <option key={role.id} value={role.id} disabled={!role.is_active}>
                            {formatLaborRoleOptionLabel(role)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="K MO atelier">
                      <DecimalDraftInput
                        className={inputClassName}
                        value={item.k_mo_atelier ?? 1}
                        emptyValue={1}
                        disabled={isReadOnly}
                        aria-label={`Coefficient de main-d’œuvre en atelier pour ${lineLabel}`}
                        onValueChange={(value) =>
                          onPatchItem(item.id, { k_mo_atelier: value }, { persist: false })
                        }
                        onValueCommit={(value) =>
                          onPatchItem(item.id, { k_mo_atelier: value }, { persist: true })
                        }
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Rôle chantier">
                      <select
                        className={`${inputClassName} form-select`}
                        value={item.labor_role_chantier_id ?? ""}
                        aria-label={`Rôle de main-d’œuvre sur chantier pour ${lineLabel}`}
                        disabled={isReadOnly}
                        onChange={(event) =>
                          onPatchItem(
                            item.id,
                            { labor_role_chantier_id: event.currentTarget.value || null },
                            { persist: true },
                          )
                        }
                      >
                        <option value="">Non défini</option>
                        {laborRoles.map((role) => (
                          <option key={role.id} value={role.id} disabled={!role.is_active}>
                            {formatLaborRoleOptionLabel(role)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="K MO chantier">
                      <DecimalDraftInput
                        className={inputClassName}
                        value={item.k_mo_chantier ?? 1}
                        emptyValue={1}
                        disabled={isReadOnly}
                        aria-label={`Coefficient de main-d’œuvre sur chantier pour ${lineLabel}`}
                        onValueChange={(value) =>
                          onPatchItem(item.id, { k_mo_chantier: value }, { persist: false })
                        }
                        onValueCommit={(value) =>
                          onPatchItem(item.id, { k_mo_chantier: value }, { persist: true })
                        }
                      />
                    </Field>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Rôle main d’œuvre">
                    <select
                      className={`${inputClassName} form-select`}
                      value={item.labor_role_id ?? ""}
                      aria-label={`Rôle de main-d’œuvre pour ${lineLabel}`}
                      disabled={isReadOnly}
                      onChange={(event) =>
                        onPatchItem(
                          item.id,
                          { labor_role_id: event.currentTarget.value || null },
                          { persist: true },
                        )
                      }
                    >
                      <option value="">Non défini</option>
                      {laborRoles.map((role) => (
                        <option key={role.id} value={role.id} disabled={!role.is_active}>
                          {formatLaborRoleOptionLabel(role)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Coefficient K MO">
                    <DecimalDraftInput
                      className={inputClassName}
                      value={item.k_mo ?? 1}
                      emptyValue={1}
                      disabled={isReadOnly}
                      aria-label={`Coefficient main-d’œuvre K MO pour ${lineLabel}`}
                      onValueChange={(value) =>
                        onPatchItem(item.id, { k_mo: value }, { persist: false })
                      }
                      onValueCommit={(value) =>
                        onPatchItem(item.id, { k_mo: value }, { persist: true })
                      }
                    />
                  </Field>
                </div>
              )}
            </div>
          </details>
        </Modal.Body>

        <Modal.Footer className="mt-0 shrink-0 border-t border-[var(--slate-200)] bg-white px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
          <div className="mr-auto grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="block text-xs text-[var(--slate-500)]">P.U. HT</span>
              <strong className="tabular-nums text-[var(--slate-800)]">
                {formatCurrency(item.pu_ht_cents ?? 0, estimateCurrency)}
              </strong>
            </div>
            <div>
              <span className="block text-xs text-[var(--slate-500)]">Total HT</span>
              <strong className="tabular-nums text-[var(--slate-900)]">
                {formatCurrency(item.line_total_ht_cents ?? 0, estimateCurrency)}
              </strong>
            </div>
          </div>
          <div className="flex w-full gap-2">
            <button
              className="btn btn-secondary min-h-11 flex-1"
              type="button"
              onClick={onGoPrevious}
              disabled={!canGoPrevious}
            >
              Précédente
            </button>
            <button
              className="btn btn-secondary min-h-11 flex-1"
              type="button"
              onClick={onGoNext}
              disabled={!canGoNext}
            >
              Suivante
            </button>
            <Modal.Close className="btn btn-primary min-h-11 flex-1 text-white">
              Terminer
            </Modal.Close>
          </div>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
