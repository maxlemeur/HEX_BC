"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import {
  useSpreadsheetNavigation,
  type SpreadsheetCell,
} from "@/hooks/useSpreadsheetNavigation";
import { NUMERIC_INPUT_ERROR } from "@/lib/numeric-input/parsers";

type EditableCellInputType = "text" | "number";
type EditableCellValue = string | number | null | undefined;

export type EditableCellProps<TCommitValue = string> = {
  cell: SpreadsheetCell;
  navigation: ReturnType<typeof useSpreadsheetNavigation>;
  value: EditableCellValue;
  onChange: (value: string) => void;
  onCommit: (value: TCommitValue) => void;
  readOnly?: boolean;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
  formatDisplayValue?: (value: EditableCellValue) => string;
  parseOnCommit?: (value: string) => TCommitValue;
  isValidInput?: (value: string) => boolean;
  type?: EditableCellInputType;
  inputMode?: "decimal" | "numeric" | "text";
  step?: number | string;
  min?: number | string;
  max?: number | string;
};

const HIDDEN_EDITOR_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0,
  pointerEvents: "none",
};

function joinClassNames(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

function toInputValue(value: EditableCellValue) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

export function EditableCell<TCommitValue = string>({
  cell,
  navigation,
  value,
  onChange,
  onCommit,
  readOnly = false,
  className,
  inputClassName,
  placeholder,
  ariaLabel,
  formatDisplayValue,
  parseOnCommit,
  isValidInput,
  type = "text",
  inputMode,
  step,
  min,
  max,
}: EditableCellProps<TCommitValue>) {
  const cellProps = navigation.getCellProps(cell);
  const editorProps = navigation.getEditorProps<HTMLInputElement>(cell);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isEditing = navigation.isCellEditing(cell);
  const propInputValue = toInputValue(value);

  // Keep a local editing value so intermediate keystrokes are not clobbered
  // by the parent re-rendering with a converted (e.g. cents→euros) value.
  const [localEditingValue, setLocalEditingValue] = useState<string | null>(null);
  const invalid = localEditingValue !== null && isValidInput !== undefined && !isValidInput(localEditingValue);

  const inputValue = (isEditing || invalid) && localEditingValue !== null
    ? localEditingValue
    : propInputValue;

  const displayValue = useMemo(() => {
    if (formatDisplayValue) {
      return formatDisplayValue(value);
    }

    return propInputValue;
  }, [formatDisplayValue, propInputValue, value]);

  const showPlaceholder = displayValue.trim().length === 0 && Boolean(placeholder);
  const displayContent = showPlaceholder ? placeholder : displayValue || " ";

  const handleEditorRef = useCallback(
    (element: HTMLInputElement | null) => {
      inputRef.current = element;
      editorProps.ref(element);
    },
    [editorProps]
  );

  const handleCellClick = useCallback(() => {
    if (readOnly || isEditing) {
      return;
    }

    inputRef.current?.focus();
  }, [isEditing, readOnly]);

  const handleCellDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (readOnly) {
      return;
    }

    cellProps.onDoubleClick(event);
  }, [cellProps, readOnly]);

  const handleCellKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }

      cellProps.onKeyDown(event);
    },
    [cellProps]
  );

  const handleInputBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      editorProps.onBlur(event);

      const nextValue = localEditingValue ?? event.currentTarget.value;
      if (isValidInput && !isValidInput(nextValue)) {
        event.currentTarget.setCustomValidity(NUMERIC_INPUT_ERROR);
        event.currentTarget.reportValidity();
        return;
      }
      setLocalEditingValue(null);
      if (parseOnCommit) {
        onCommit(parseOnCommit(nextValue));
        return;
      }

      onCommit(nextValue as TCommitValue);
    },
    [editorProps, isValidInput, localEditingValue, onCommit, parseOnCommit]
  );

  return (
    <div
      {...cellProps}
      onKeyDown={handleCellKeyDown}
      onDoubleClick={handleCellDoubleClick}
      onClick={handleCellClick}
      className={className}
      style={{ position: "relative" }}
      aria-readonly={readOnly || undefined}
    >
      {!isEditing && !invalid ? (
        <span
          className={joinClassNames(
            "editable-cell__display",
            showPlaceholder && "editable-cell__display--placeholder"
          )}
        >
          {displayContent}
        </span>
      ) : null}
      <input
        ref={handleEditorRef}
        tabIndex={editorProps.tabIndex}
        type={type}
        inputMode={inputMode}
        value={inputValue}
        className={inputClassName}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        title={invalid ? NUMERIC_INPUT_ERROR : undefined}
        step={type === "number" ? step : undefined}
        min={type === "number" ? min : undefined}
        max={type === "number" ? max : undefined}
        disabled={readOnly}
        onFocus={(event) => {
          setLocalEditingValue(event.currentTarget.value);
          editorProps.onFocus(event);
        }}
        onBlur={handleInputBlur}
        onKeyDown={editorProps.onKeyDown}
        onChange={(event) => {
          const next = event.target.value;
          setLocalEditingValue(next);
          event.currentTarget.setCustomValidity(isValidInput && !isValidInput(next) ? NUMERIC_INPUT_ERROR : "");
          // Numeric drafts commit atomically on blur: a valid prefix of a later
          // invalid token must not enter autosave while the user is still typing.
          if (!isValidInput) onChange(next);
        }}
        style={isEditing || invalid ? undefined : HIDDEN_EDITOR_STYLE}
      />
    </div>
  );
}

export default EditableCell;
