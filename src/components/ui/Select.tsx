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
        <label className="block text-xs font-semibold text-[var(--slate-700)]" htmlFor={selectId}>
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          "relative flex h-11 items-center rounded-[12px] border bg-white transition",
          "border-[var(--slate-200)] hover:border-[var(--slate-300)] focus-within:border-[var(--ring)]",
          error ? "border-danger" : null
        )}
      >
        <select
          id={selectId}
          ref={ref}
          className={cn(
            "h-full w-full appearance-none rounded-[12px] bg-transparent px-3 pr-10 text-sm",
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
        <span className="pointer-events-none absolute right-3 text-[var(--slate-400)]">
          ▾
        </span>
      </div>

      {error ? (
        <p id={errorId ?? undefined} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      {!error && helperText ? (
        <p id={helperId ?? undefined} className="text-xs text-[var(--slate-500)]">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
