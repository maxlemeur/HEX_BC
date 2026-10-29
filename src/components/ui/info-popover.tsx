"use client";

import { useState, type ReactNode } from "react";
import { InfoIcon, XIcon } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function InfoPopover({
  label,
  title,
  children,
  className,
}: {
  label: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:size-9",
          className,
        )}
      >
        <InfoIcon className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="max-h-[min(28rem,calc(100dvh-2rem))] w-80 max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto p-4 motion-reduce:animate-none"
      >
        <div className="flex items-start justify-between gap-3">
          <PopoverTitle className="pt-1 text-sm font-semibold">
            {title}
          </PopoverTitle>
          <button
            type="button"
            aria-label={`Fermer : ${title}`}
            onClick={() => setOpen(false)}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-control sm:size-9 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
