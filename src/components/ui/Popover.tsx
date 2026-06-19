"use client";

import { type ReactNode } from "react";
import { usePopover } from "@/hooks/usePopover";

type PopoverPlacement = "top" | "right" | "bottom" | "left";

type PopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  arrowClassName?: string;
  placement?: PopoverPlacement;
  /** When true, the popover opens on hover in addition to click. Default: false */
  hover?: boolean;
};

const placementClasses: Record<
  PopoverPlacement,
  { container: string; arrow: string }
> = {
  top: {
    container: "bottom-full left-1/2 mb-2 -translate-x-1/2",
    arrow: "-bottom-1.5 left-1/2 -translate-x-1/2 rotate-45 border-b border-r",
  },
  right: {
    container: "left-full top-1/2 ml-2 -translate-y-1/2",
    arrow: "-left-1.5 top-1/2 -translate-y-1/2 rotate-45 border-b border-l",
  },
  bottom: {
    container: "left-1/2 top-full mt-2 -translate-x-1/2",
    arrow: "-top-1.5 left-1/2 -translate-x-1/2 rotate-45 border-l border-t",
  },
  left: {
    container: "right-full top-1/2 mr-2 -translate-y-1/2",
    arrow: "-right-1.5 top-1/2 -translate-y-1/2 rotate-45 border-r border-t",
  },
};

export function Popover({
  trigger,
  children,
  className = "",
  contentClassName = "",
  arrowClassName = "",
  placement = "bottom",
  hover = false,
}: PopoverProps) {
  const { isOpen, toggle, setContainerRef, handleMouseEnter, handleMouseLeave } = usePopover();
  const currentPlacement = placementClasses[placement];

  return (
    <div
      className={`relative inline-flex ${className}`}
      ref={setContainerRef}
      {...(hover ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave } : {})}
    >
      <div onClick={toggle} className="cursor-pointer">
        {trigger}
      </div>
      {isOpen && (
        <div className={`absolute z-30 ${currentPlacement.container}`}>
          <div
            className={`absolute h-3 w-3 border-slate-200 bg-surface ${currentPlacement.arrow} ${arrowClassName}`}
          />
          <div
            className={`relative w-max max-w-sm whitespace-normal rounded-lg border border-slate-200 bg-surface p-2.5 text-xs font-normal text-slate-600 shadow-lg ${contentClassName}`}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
