import type { TreeFilterKey } from "@/lib/estimates/estimate-structure-draft";

export const WIZARD_STEPS = [
  { step: 1, label: "Sources" },
  { step: 2, label: "Sélection" },
  { step: 3, label: "Application" },
] as const;

export type WizardStep = 1 | 2 | 3 | 4;

export const TREE_FILTER_CHIPS: Array<{
  key: TreeFilterKey;
  label: string;
  activeClass: string;
  inactiveClass: string;
}> = [
  {
    key: "create",
    label: "Nouveau",
    activeClass: "bg-emerald-100 text-emerald-800 border-emerald-300",
    inactiveClass: "bg-surface text-slate-600 border-border hover:bg-surface-subtle",
  },
  {
    key: "merge",
    label: "Fusion",
    activeClass: "bg-amber-100 text-amber-800 border-amber-300",
    inactiveClass: "bg-surface text-slate-600 border-border hover:bg-surface-subtle",
  },
  {
    key: "skip",
    label: "Ignore",
    activeClass: "bg-slate-200 text-slate-800 border-slate-400",
    inactiveClass: "bg-surface text-slate-600 border-border hover:bg-surface-subtle",
  },
  {
    key: "low_confidence",
    label: "Confiance faible",
    activeClass: "bg-rose-100 text-rose-800 border-rose-300",
    inactiveClass: "bg-surface text-slate-600 border-border hover:bg-surface-subtle",
  },
  {
    key: "duplicate",
    label: "Doublons",
    activeClass: "bg-violet-100 text-violet-800 border-violet-300",
    inactiveClass: "bg-surface text-slate-600 border-border hover:bg-surface-subtle",
  },
];
