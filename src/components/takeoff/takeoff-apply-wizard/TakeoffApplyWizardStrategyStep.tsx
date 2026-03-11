"use client";

import { STRATEGY_OPTIONS, type TakeoffApplyStrategy } from "./shared";

export function TakeoffApplyWizardStrategyStep({
  strategy,
  isSubmitting,
  onStrategyChange,
}: {
  strategy: TakeoffApplyStrategy;
  isSubmitting: boolean;
  onStrategyChange: (value: TakeoffApplyStrategy) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--info)]/20 bg-[var(--info)]/5 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--info)]">
          Strategie d&apos;application
        </p>
        <p className="mt-2 text-sm text-[var(--slate-700)]">
          Choisissez comment enrichir le devis. Le wizard vous montre l&apos;impact avant confirmation.
        </p>
      </div>
      {STRATEGY_OPTIONS.map((option) => (
        <label
          key={option.value}
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${
            strategy === option.value
              ? "border-[var(--info)] bg-[var(--info)]/5"
              : "border-[var(--slate-200)]"
          }`}
        >
          <input
            type="radio"
            name="takeoff-apply-strategy"
            value={option.value}
            checked={strategy === option.value}
            onChange={() => onStrategyChange(option.value)}
            disabled={isSubmitting}
          />
          <span>
            <span className="block text-sm font-semibold text-[var(--slate-800)]">
              {option.label}
            </span>
            <span className="mt-1 block text-sm text-[var(--slate-600)]">
              {option.description}
            </span>
            <span className="mt-2 block text-xs font-medium text-[var(--slate-700)]">
              {option.impactLabel}
            </span>
            <span className="mt-1 block text-xs text-[var(--slate-500)]">
              {option.caution}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}
