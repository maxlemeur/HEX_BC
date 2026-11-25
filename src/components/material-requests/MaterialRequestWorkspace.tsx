import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { SELECTED_ROW } from "./cells";

export function MaterialRequestWorkspace({ label, choices, children }: Readonly<{
  label: string;
  choices: ReactNode;
  children: ReactNode;
}>) {
  return (
    <div className="grid min-w-0 overflow-hidden rounded-lg border border-border bg-surface xl:grid-cols-[20rem_minmax(0,1fr)]">
      <ul role="list" aria-label={label} className="min-w-0 divide-y divide-border border-b border-border xl:border-r xl:border-b-0">
        {choices}
      </ul>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function MaterialRequestWorkspaceChoice({ label, title, status, scope, scopeTitle, amount, warning, selected, onSelect }: Readonly<{
  label: string;
  title: ReactNode;
  status: ReactNode;
  scope: string;
  scopeTitle?: string;
  amount?: string;
  warning?: string;
  selected: boolean;
  onSelect: () => void;
}>) {
  return (
    <li className="min-w-0">
      <Button type="button" variant="ghost" size="sm" aria-label={label} aria-pressed={selected} onClick={onSelect}
        className={cn("mr-workspace-choice block h-auto w-full min-w-0 rounded-none border-0 px-3 py-2 text-left font-normal whitespace-normal text-foreground hover:bg-surface-subtle focus-visible:outline-offset-[-3px]", selected && SELECTED_ROW)}>
        <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="min-w-0 break-words font-semibold">{title}</span>
          {status}
        </span>
        <span className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={scopeTitle}>{scope}</span>
          {amount ? <span className="font-medium tabular-nums">{amount}</span> : null}
        </span>
        {warning ? <span className="mt-1 flex items-center gap-1 text-xs font-medium text-warning"><TriangleAlert aria-hidden="true" className="size-3.5" />{warning}</span> : null}
      </Button>
    </li>
  );
}
