"use client";

import { type ReactNode } from "react";
import { usePopover } from "@/hooks/usePopover";

type PopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  /** When true, the popover opens on hover in addition to click. Default: false */
  hover?: boolean;
};

export function Popover({ trigger, children, className = "", hover = false }: PopoverProps) {
  const { isOpen, toggle, setContainerRef, handleMouseEnter, handleMouseLeave } = usePopover();

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
        <div className="absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2">
          <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-slate-200 bg-surface" />
          <div className="relative w-max max-w-sm whitespace-normal rounded-lg border border-slate-200 bg-surface p-2.5 text-xs font-normal text-slate-600 shadow-lg">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
