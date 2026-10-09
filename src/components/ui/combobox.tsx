"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"
import { controlSizes, controlSurface, type ControlSize } from "@/components/ui/input"

type ComboboxOption = {
  value: string
  label: string
  /** Extra search terms (reference, e-mail…) matched besides the label. */
  keywords?: string[]
  disabled?: boolean
}

type ComboboxProps = {
  options: ComboboxOption[]
  /** Selected option value; "" means none. Leave undefined for an uncontrolled field. */
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Text typed by the user, e.g. to drive a remote search (selection does not trigger it). */
  onQueryChange?: (query: string) => void
  /** Put on the input: pair it with `<FieldLabel htmlFor>`. */
  id?: string
  /** Submits the selected value through a hidden input. */
  name?: string
  placeholder?: string
  emptyMessage?: string
  loadingMessage?: string
  isLoading?: boolean
  disabled?: boolean
  required?: boolean
  size?: ControlSize
  /** Wrapper (input group) classes. */
  className?: string
  inputClassName?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}

/** Accent- and case-insensitive match on the label and the keywords. */
function matchesComboboxOption(option: ComboboxOption, query: string) {
  const needle = normalizeSearch(query.trim())
  if (!needle) return true
  return normalizeSearch([option.label, ...(option.keywords ?? [])].join(" ")).includes(needle)
}

/**
 * Searchable single select on Base UI Combobox, with the control surface of `Input`
 * (role="combobox" input + listbox popup, arrows / Enter / Escape, portal above dialogs).
 * Options are plain `{ value, label }`; the selected option stays listed while remote
 * results (`onQueryChange` + `isLoading`) replace the others.
 */
function Combobox({
  options,
  value,
  defaultValue = "",
  onValueChange,
  onQueryChange,
  id,
  name,
  placeholder = "Rechercher…",
  emptyMessage = "Aucun résultat",
  loadingMessage = "Recherche…",
  isLoading = false,
  disabled = false,
  required,
  size = "md",
  className,
  inputClassName,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: ComboboxProps) {
  const isControlled = value !== undefined
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
  const currentValue = isControlled ? value : uncontrolledValue

  const optionMap = React.useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options]
  )

  // Remote searches may drop the selected option from `options`: remember it to keep its label.
  const [knownSelection, setKnownSelection] = React.useState<ComboboxOption | null>(null)
  React.useEffect(() => {
    const option = currentValue ? optionMap.get(currentValue) : undefined
    if (option) setKnownSelection(option)
  }, [currentValue, optionMap])

  const selectedOption = currentValue
    ? (optionMap.get(currentValue) ??
      (knownSelection?.value === currentValue ? knownSelection : null))
    : null

  const getOption = React.useCallback(
    (itemValue: string) =>
      optionMap.get(itemValue) ??
      (selectedOption?.value === itemValue ? selectedOption : undefined),
    [optionMap, selectedOption]
  )

  const items = React.useMemo(() => {
    const values = options.map((option) => option.value)
    if (selectedOption && !optionMap.has(selectedOption.value)) values.push(selectedOption.value)
    return values
  }, [optionMap, options, selectedOption])

  return (
    <ComboboxPrimitive.Root<string>
      items={items}
      value={currentValue || null}
      onValueChange={(nextValue) => {
        const normalized = nextValue ?? ""
        if (!isControlled) setUncontrolledValue(normalized)
        const option = normalized ? getOption(normalized) : undefined
        if (option) setKnownSelection(option)
        onValueChange?.(normalized)
      }}
      onInputValueChange={(query, details) => {
        if (details.reason === "input-change" || details.reason === "input-clear") {
          onQueryChange?.(query)
        }
      }}
      itemToStringLabel={(itemValue) => getOption(itemValue)?.label ?? ""}
      filter={(itemValue, query) => {
        const option = getOption(itemValue)
        return option ? matchesComboboxOption(option, query) : false
      }}
      name={name}
      required={required}
      disabled={disabled}
    >
      <ComboboxPrimitive.InputGroup
        data-slot="combobox"
        className={cn("relative w-full min-w-0", className)}
      >
        <ComboboxPrimitive.Input
          id={id}
          data-slot="combobox-input"
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid || undefined}
          className={cn(controlSurface, controlSizes[size], "w-full pr-10", inputClassName)}
        />
        <ComboboxPrimitive.Trigger
          data-slot="combobox-trigger"
          aria-label="Afficher les suggestions"
          className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <ChevronDownIcon aria-hidden="true" className="size-4" />
          )}
        </ComboboxPrimitive.Trigger>
      </ComboboxPrimitive.InputGroup>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner sideOffset={4} className="isolate z-(--z-popover) outline-none">
          <ComboboxPrimitive.Popup
            data-slot="combobox-content"
            aria-busy={isLoading || undefined}
            className="max-h-[min(var(--available-height),18rem)] w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-dropdown duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none"
          >
            <ComboboxPrimitive.Status className="px-3 py-2 text-sm text-muted-foreground empty:hidden">
              {isLoading ? loadingMessage : null}
            </ComboboxPrimitive.Status>
            <ComboboxPrimitive.Empty className="px-3 py-2 text-sm text-muted-foreground empty:hidden">
              {isLoading ? null : emptyMessage}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="outline-none">
              {(itemValue: string) => {
                const option = getOption(itemValue)
                return (
                  <ComboboxPrimitive.Item
                    key={itemValue}
                    value={itemValue}
                    disabled={option?.disabled}
                    className="relative flex cursor-default items-center gap-2 rounded-md py-2 pr-8 pl-3 text-sm text-foreground outline-none select-none data-disabled:pointer-events-none data-disabled:text-subtle-foreground data-highlighted:bg-muted data-selected:font-medium"
                  >
                    <span className="min-w-0 flex-1 break-words">{option?.label ?? itemValue}</span>
                    <ComboboxPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center text-primary">
                      <CheckIcon aria-hidden="true" className="size-4" />
                    </ComboboxPrimitive.ItemIndicator>
                  </ComboboxPrimitive.Item>
                )
              }}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}

export { Combobox, matchesComboboxOption, type ComboboxOption, type ComboboxProps }
