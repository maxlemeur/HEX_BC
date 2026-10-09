import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { controlSizes, controlSurface, type ControlSize } from "@/components/ui/input"

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: ControlSize
  wrapperClassName?: string
}

/**
 * Styled native <select>: keyboard, mobile pickers and Playwright `selectOption` keep working.
 * Prefer it to the Base UI Select unless options need custom rendering.
 */
function NativeSelect({ className, wrapperClassName, size = "md", ...props }: NativeSelectProps) {
  return (
    <div data-slot="native-select-wrapper" className={cn("relative w-full min-w-0", wrapperClassName)}>
      <select
        data-slot="native-select"
        className={cn(controlSurface, controlSizes[size], "w-full cursor-pointer appearance-none pr-9", className)}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { NativeSelect }
