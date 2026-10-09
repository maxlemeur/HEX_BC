import type { TreeFilterKey } from "@/lib/estimates/estimate-structure-draft";

export const WIZARD_STEPS = [
  { step: 1, label: "Sources" },
  { step: 2, label: "Sélection" },
  { step: 3, label: "Application" },
] as const;

export type WizardStep = 1 | 2 | 3 | 4;

const INACTIVE_CHIP_CLASS =
  "bg-surface text-foreground-secondary border-border hover:bg-surface-subtle";

export const TREE_FILTER_CHIPS: Array<{
  key: TreeFilterKey;
  label: string;
  activeClass: string;
  inactiveClass: string;
}> = [
  {
    key: "create",
    label: "Nouveau",
    activeClass: "bg-success-light text-success border-success-border",
    inactiveClass: INACTIVE_CHIP_CLASS,
  },
  {
    key: "merge",
    label: "Fusion",
    activeClass: "bg-warning-light text-warning border-warning-border",
    inactiveClass: INACTIVE_CHIP_CLASS,
  },
  {
    key: "skip",
    label: "Ignoré",
    activeClass: "bg-muted text-foreground border-border-strong",
    inactiveClass: INACTIVE_CHIP_CLASS,
  },
  {
    key: "low_confidence",
    label: "Confiance faible",
    activeClass: "bg-danger-light text-danger border-danger-border",
    inactiveClass: INACTIVE_CHIP_CLASS,
  },
  {
    key: "duplicate",
    label: "Doublons",
    activeClass: "bg-info-light text-info border-info-border",
    inactiveClass: INACTIVE_CHIP_CLASS,
  },
];
