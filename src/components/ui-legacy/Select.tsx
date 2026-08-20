import { useId } from "react";

import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: SelectOption[];
  label?: string;
  placeholder?: string;
  helperText?: string;
  error?: string;
  className?: string;
  onValueChange?: (value: string) => void;
  ref?: React.Ref<HTMLSelectElement>;
};

export function Select({
  id,
  label,
  placeholder,
  helperText,
  error,
  options,
  className,
  onChange,
  onValueChange,
  ref,
  ...props
}: Readonly<SelectProps>) {
  const generatedId = useId();
  const selectId = id ?? `select-${generatedId}`;
  const helperId = helperText ? `${selectId}-helper` : null;
  const errorId = error ? `${selectId}-error` : null;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      {label ? (
        <label className="block font-body text-sm font-medium text-slate-700" htmlFor={selectId}>
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          "relative flex h-[var(--density-input-h)] items-center rounded-button border bg-surface transition",
          "border-slate-200 hover:border-slate-300 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/12",
          error ? "border-danger" : null
        )}
      >
        <select
          id={selectId}
          ref={ref}
          className={cn(
            "font-body h-full w-full appearance-none rounded-button bg-transparent px-3 pr-10 text-base text-foreground",
            "focus-visible:outline-none",
            className
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => {
            onChange?.(event);
            onValueChange?.(event.target.value);
          }}
          {...props}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 text-slate-400">
          ▾
        </span>
      </div>

      {error ? (
        <p id={errorId ?? undefined} role="alert" className="typo-caption text-danger">
          {error}
        </p>
      ) : null}

      {!error && helperText ? (
        <p id={helperId ?? undefined} className="typo-caption text-slate-500">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
