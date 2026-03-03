"use client";

import { type ReactNode } from "react";
import { usePopover } from "@/hooks/usePopover";

type PopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Popover({ trigger, children, className = "" }: PopoverProps) {
  const { isOpen, toggle, setContainerRef } = usePopover();

  return (
    <div className={`relative inline-flex ${className}`} ref={setContainerRef}>
      <div onClick={toggle} className="cursor-pointer">
        {trigger}
      </div>
      {isOpen && (
        <div className="absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2">
          <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-[var(--slate-200)] bg-white" />
          <div className="relative w-max max-w-sm whitespace-normal rounded-lg border border-[var(--slate-200)] bg-white p-2.5 text-xs font-normal text-[var(--slate-600)] shadow-lg">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
