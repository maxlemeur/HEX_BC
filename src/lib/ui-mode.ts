export const UI_MODE_VALUES = ["simplified", "expert"] as const;

export type UiMode = (typeof UI_MODE_VALUES)[number];

export const DEFAULT_UI_MODE: UiMode = "simplified";

export function normalizeUiMode(value: unknown): UiMode {
  return value === "expert" ? "expert" : DEFAULT_UI_MODE;
}

export function isUiMode(value: unknown): value is UiMode {
  return value === "simplified" || value === "expert";
}
