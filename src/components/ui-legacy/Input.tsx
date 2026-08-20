import { useId } from "react";

import { cn } from "@/lib/utils";

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label?: string;
  helperText?: string;
  error?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
};

export function Input({
  id,
  label,
  helperText,
  error,
  prefix,
  suffix,
  className,
  ref,
  ...props
}: Readonly<InputProps>) {
  const generatedId = useId();
  const inputId = id ?? `input-${generatedId}`;
  const helperId = helperText ? `${inputId}-helper` : null;
  const errorId = error ? `${inputId}-error` : null;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      {label ? (
        <label className="block font-body text-sm font-medium text-slate-700" htmlFor={inputId}>
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          "group flex h-[var(--density-input-h)] items-center rounded-button border bg-surface transition",
          "border-slate-200 hover:border-slate-300 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/12",
          error ? "border-danger" : null
        )}
      >
        {prefix ? (
          <span className="flex h-full items-center pl-3 text-slate-500">{prefix}</span>
        ) : null}

        <input
          id={inputId}
          ref={ref}
          className={cn(
            "font-body h-full w-full border-0 bg-transparent px-3 py-0 text-base text-foreground transition-colors",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-0",
            prefix ? "pl-2" : null,
            suffix ? "pr-2" : null,
            className
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...props}
        />

        {suffix ? (
          <span className="flex h-full items-center pr-3 text-slate-500">{suffix}</span>
        ) : null}
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
