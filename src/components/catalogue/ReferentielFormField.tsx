import type { ReactNode } from "react";

import { FieldLabel } from "@/components/ui/field";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ReferentielFormFieldProps = InputProps & {
  id: string;
  label: string;
  /** Replaces the default text input (textarea, select…); it must carry the same `id`. */
  control?: ReactNode;
  className?: string;
};

/** Label + control pair used by the référentiel forms (fournisseurs, chantiers). */
export function ReferentielFormField({
  id,
  label,
  control,
  className,
  ...inputProps
}: ReferentielFormFieldProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {control ?? <Input id={id} {...inputProps} />}
    </div>
  );
}
