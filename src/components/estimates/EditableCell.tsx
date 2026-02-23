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
  type?: EditableCellInputType;
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
  type = "text",
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

  const inputValue = isEditing && localEditingValue !== null
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
      setLocalEditingValue(null);
      if (parseOnCommit) {
        onCommit(parseOnCommit(nextValue));
        return;
      }

      onCommit(nextValue as TCommitValue);
    },
    [editorProps, localEditingValue, onCommit, parseOnCommit]
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
      {!isEditing ? (
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
        value={inputValue}
        className={inputClassName}
        placeholder={placeholder}
        aria-label={ariaLabel}
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
          onChange(next);
        }}
        style={isEditing ? undefined : HIDDEN_EDITOR_STYLE}
      />
    </div>
  );
}

export default EditableCell;
