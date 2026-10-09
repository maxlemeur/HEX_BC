import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/** Shared look of text fields and selects (the legacy `.form-input`). */
const controlSurface =
  "min-w-0 rounded-control border border-input bg-surface text-foreground transition-[border-color,box-shadow] outline-none placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger/15"

const controlSizes = {
  sm: "h-9 px-3 text-sm",
  md: "h-(--density-input-h) px-4 text-base",
  lg: "h-11 px-4 text-base",
} as const

type ControlSize = keyof typeof controlSizes

type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  size?: ControlSize
}

function Input({ className, type, size = "md", ...props }: InputProps) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        controlSurface,
        controlSizes[size],
        "w-full file:mr-3 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input, controlSizes, controlSurface, type ControlSize, type InputProps }
