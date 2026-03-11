import type { TreeFilterKey } from "@/lib/estimates/estimate-structure-draft";

export const WIZARD_STEPS = [
  { step: 1, label: "Sources" },
  { step: 2, label: "Selection" },
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
    inactiveClass: "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
  },
  {
    key: "merge",
    label: "Fusion",
    activeClass: "bg-amber-100 text-amber-800 border-amber-300",
    inactiveClass: "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
  },
  {
    key: "skip",
    label: "Ignore",
    activeClass: "bg-slate-200 text-slate-800 border-slate-400",
    inactiveClass: "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
  },
  {
    key: "low_confidence",
    label: "Confiance faible",
    activeClass: "bg-rose-100 text-rose-800 border-rose-300",
    inactiveClass: "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
  },
  {
    key: "duplicate",
    label: "Doublons",
    activeClass: "bg-violet-100 text-violet-800 border-violet-300",
    inactiveClass: "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
  },
];
