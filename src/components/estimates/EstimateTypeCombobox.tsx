"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SpreadsheetEditorProps } from "@/hooks/useSpreadsheetNavigation";
import {
  resolveUniqueEstimateType,
  searchEstimateTypes,
  type EstimateTypeOption,
} from "@/lib/estimates/type-search";

type Props = {
  value: string | null;
  options: readonly EstimateTypeOption[];
  label: string;
  emptyLabel: string;
  disabled: boolean;
  className?: string;
  error?: string;
  editorProps?: SpreadsheetEditorProps<HTMLInputElement>;
  onCommit: (id: string | null) => void;
};

export function EstimateTypeCombobox({
  value, options, label, emptyLabel, disabled, className = "estimate-input",
  error, editorProps, onCommit,
}: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState<{ text: string; base: string | null } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0, width: 280, maxHeight: 240 });
  const isOpen = search !== null && search.base === value && !disabled;
  const query = isOpen ? search.text : "";
  const selected = options.find((option) => option.id === value);
  const selectedLabel = selected
    ? `${selected.label}${selected.disabled ? " (inactif)" : ""}`
    : value ? "Type indisponible" : "";
  const matches = isOpen ? searchEstimateTypes(options, query) : [];
  const choices: EstimateTypeOption[] = query.trim()
    ? matches
    : [{ id: "", label: emptyLabel }, ...matches];
  const active = choices.find((option) => option.id === activeId && !option.disabled);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < 180 && above > below;
      const maxHeight = Math.max(40, Math.min(240, upwards ? above : below));
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: upwards ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
        width,
        maxHeight,
      });
    };
    place();
    const reposition = (event: Event) => {
      if (event.target instanceof Node && listRef.current?.contains(event.target)) return;
      place();
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", place);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeId === null) return;
    const element = listRef.current?.querySelector('[data-active="true"]');
    element?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, isOpen]);

  function close() {
    setSearch(null);
    setActiveId(null);
  }

  function commit(option: EstimateTypeOption) {
    if (disabled || option.disabled || !isOpen) return;
    const next = option.id || null;
    close();
    if (next !== value) onCommit(next);
  }

  return (
    <>
      <input
        ref={(element) => {
          inputRef.current = element;
          editorProps?.ref(element);
        }}
        className={className}
        tabIndex={editorProps?.tabIndex}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={isOpen && active ? `${listId}-${active.id || "empty"}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? `${listId}-status` : undefined}
        title={error ?? selected?.label}
        autoComplete="off"
        disabled={disabled}
        placeholder={emptyLabel}
        value={isOpen ? query : selectedLabel}
        onFocus={(event) => {
          if (!disabled) {
            setSearch({ text: "", base: value });
            setActiveId(null);
            setMessage("");
          }
          editorProps?.onFocus(event);
        }}
        onClick={() => {
          if (!disabled && !isOpen) setSearch({ text: "", base: value });
        }}
        onChange={(event) => {
          setSearch({ text: event.currentTarget.value, base: value });
          setActiveId(null);
          setMessage("");
        }}
        onBlur={(event) => {
          close();
          editorProps?.onBlur(event);
        }}
        onKeyDown={(event) => {
          // Keep document shortcuts (notably Ctrl/Cmd+S) and native clipboard
          // actions available while searching. The grid ignores bubbled input events.
          if (event.ctrlKey || event.metaKey) {
            editorProps?.onKeyDown(event);
            return;
          }
          // The grid's bubbling handler must not also process the same key.
          if (editorProps) event.stopPropagation();
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.stopPropagation();
            event.preventDefault();
            if (!isOpen) {
              setSearch({ text: "", base: value });
              setActiveId(null);
              return;
            }
            const enabled = choices.filter((option) => !option.disabled);
            if (enabled.length === 0) return;
            const index = enabled.findIndex((option) => option.id === activeId);
            const next = event.key === "ArrowDown"
              ? (index + 1) % enabled.length
              : (index < 0 ? enabled.length - 1 : (index - 1 + enabled.length) % enabled.length);
            setActiveId(enabled[next]?.id ?? null);
            return;
          }
          if (event.key === "Escape") {
            if (!isOpen && !editorProps) return;
            event.stopPropagation();
            event.preventDefault();
            editorProps?.onKeyDown(event);
            close();
            return;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            const candidate = isOpen ? active ?? resolveUniqueEstimateType(options, query) : undefined;
            if (candidate) commit(candidate);
            else if (isOpen && query.trim()) {
              setMessage("Type inchangé : choisissez une suggestion pour valider.");
              if (event.key === "Enter") {
                event.preventDefault();
                return;
              }
            }
            close();
            if (editorProps) editorProps.onKeyDown(event);
            else if (event.key === "Enter") event.preventDefault();
            return;
          }
          editorProps?.onKeyDown(event);
        }}
      />
      <span id={`${listId}-status`} role="status" className="sr-only">{message}</span>
      {isOpen && inputRef.current ? createPortal(
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="fixed z-[100] overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
          style={position}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {choices.length === 0 ? <p className="p-2 text-muted-foreground">Aucun type correspondant</p> : null}
          {choices.map((option) => (
            <div
              key={option.id}
              id={`${listId}-${option.id || "empty"}`}
              role="option"
              aria-selected={option.id === (value ?? "")}
              aria-disabled={option.disabled || undefined}
              data-active={active?.id === option.id}
              className={`cursor-pointer rounded px-3 py-2 ${option.disabled ? "opacity-50" : "hover:bg-muted"} ${active?.id === option.id ? "bg-muted" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                commit(option);
              }}
            >
              <span>{option.code ? `${option.code} — ` : ""}{option.label}{option.disabled ? " (inactif)" : ""}</span>
              {option.detail ? <span className="block text-xs text-muted-foreground">{option.detail}</span> : null}
            </div>
          ))}
        </div>,
        inputRef.current.closest('[role="dialog"]') ?? document.body,
      ) : null}
    </>
  );
}
