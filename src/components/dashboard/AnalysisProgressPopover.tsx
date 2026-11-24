"use client";

import { Activity, ArrowUpRight } from "lucide-react";
import { useEffect, useRef } from "react";

import { NavigationLink } from "@/components/navigation/NavigationFeedback";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { AnalysisProgress } from "@/lib/affaires/analysis-progress-contract";

const LABEL = "Suivi des analyses";

export default function AnalysisProgressPopover({ affaires, open, unavailable, pageCursor, nextCursor, onPageChange, onOpenChange, onSeen }: {
  affaires: AnalysisProgress["affaires"];
  open: boolean;
  unavailable: boolean;
  pageCursor: string | null;
  nextCursor: string | null;
  onPageChange: (cursor: string | null) => void;
  onOpenChange: (open: boolean) => void;
  onSeen: (keys: string[]) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const element = list.current;
    if (!open || !element) return;
    const observedKeys = new WeakMap<Element, string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const keys = observedKeys.get(entry.target);
        if (keys && keys === (entry.target as HTMLElement).dataset.completionKeys &&
            entry.isIntersecting && entry.intersectionRatio >= 0.5) onSeen(keys.split(","));
      }
    }, { root: element, threshold: 0.5 });
    const observe = () => element.querySelectorAll<HTMLElement>("[data-completion-keys]").forEach((row) => {
      const keys = row.dataset.completionKeys;
      if (keys) {
        observedKeys.set(row, keys);
        observer.observe(row);
      }
    });
    // Start observing after the popup's entrance and only while these rows are mounted.
    let disposed = false;
    const frame = requestAnimationFrame(async () => {
      await Promise.allSettled(element.closest("[data-slot='popover-content']")?.getAnimations().map((animation) => animation.finished) ?? []);
      if (!disposed) observe();
    });
    const refreshVisibility = () => {
      if (document.visibilityState !== "visible") return;
      observer.disconnect();
      observe();
    };
    document.addEventListener("visibilitychange", refreshVisibility);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", refreshVisibility);
      observer.disconnect();
    };
  }, [affaires, open, onSeen]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger className="dashboard-global-topbar__tool dashboard-global-topbar__activity relative" aria-label={LABEL} title={LABEL}>
        <Activity size={19} aria-hidden="true" />
        <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-brand-orange" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="no-print w-[min(24rem,calc(100vw-1rem))] border border-border p-3">
        <PopoverTitle className="px-2 text-base font-semibold">{LABEL}</PopoverTitle>
        {affaires.length > 0 ? (
          <ul ref={list} key={pageCursor} className="max-h-[min(60dvh,30rem)] space-y-3 overflow-y-auto">
            {affaires.map((affaire) => (
              <li key={affaire.id} className="min-w-0 rounded-md border border-border p-2">
                <h3 className="mb-1 break-words px-2 text-sm font-semibold">{affaire.name}</h3>
                <ul className="space-y-0.5">
                  {affaire.lines.map((line) => (
                    <li key={`${line.kind}:${line.id}`} data-completion-keys={line.completionKeys.length ? line.completionKeys.join(",") : undefined}>
                      <NavigationLink href={line.href} prefetch={false} onClick={() => {
                        onSeen(line.completionKeys);
                        onOpenChange(false);
                      }}
                        className="flex items-start justify-between gap-2 rounded-sm px-2 py-1.5 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                        <span className="min-w-0 break-words">
                          <span className="block text-xs font-medium text-muted-foreground">{line.kind === "dossier" ? "Dossier" : "Métré"}</span>
                          <span className="block">{line.status}</span>
                          {line.detail && <span className="block text-xs text-muted-foreground">{line.detail}</span>}
                        </span>
                        <ArrowUpRight size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </NavigationLink>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 text-muted-foreground" role="status">
            {unavailable ? "Le suivi est momentanément indisponible." : "Aucune analyse à suivre."}
          </p>
        )}
        {pageCursor || nextCursor ? (
          <div className="flex flex-wrap justify-end gap-2 px-2">
            {pageCursor && <Button variant="ghost" size="sm" onClick={() => onPageChange(null)}>Première page des analyses</Button>}
            {nextCursor && <Button variant="outline" size="sm" onClick={() => onPageChange(nextCursor)}>Afficher la suite</Button>}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
