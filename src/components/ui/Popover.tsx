"use client";

import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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
  /** Render above overflow-clipped ancestors while keeping the trigger as the anchor. */
  portal?: boolean;
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
  portal = false,
}: PopoverProps) {
  const {
    isOpen,
    toggle,
    containerEl,
    setContainerRef,
    setContentRef,
    handleMouseEnter,
    handleMouseLeave,
  } = usePopover();
  const currentPlacement = placementClasses[placement];
  const [portalStyle, setPortalStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !portal || !containerEl) {
      setPortalStyle(null);
      return;
    }

    const updatePosition = () => {
      const rect = containerEl.getBoundingClientRect();

      if (placement === "top") {
        setPortalStyle({
          left: rect.left + rect.width / 2,
          top: rect.top - 8,
          transform: "translate(-50%, -100%)",
        });
        return;
      }

      if (placement === "right") {
        setPortalStyle({
          left: rect.right + 8,
          top: rect.top + rect.height / 2,
          transform: "translateY(-50%)",
        });
        return;
      }

      if (placement === "left") {
        setPortalStyle({
          left: rect.left - 8,
          top: rect.top + rect.height / 2,
          transform: "translate(-100%, -50%)",
        });
        return;
      }

      setPortalStyle({
        left: rect.left + rect.width / 2,
        top: rect.bottom + 8,
        transform: "translateX(-50%)",
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [containerEl, isOpen, placement, portal]);

  const content = isOpen ? (
    <div
      ref={setContentRef}
      className={
        portal
          ? "fixed z-50"
          : `absolute z-30 ${currentPlacement.container}`
      }
      style={
        portal
          ? {
              ...portalStyle,
              visibility: portalStyle ? "visible" : "hidden",
            }
          : undefined
      }
      data-popover-portal={portal ? "true" : undefined}
      {...(hover
        ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave }
        : {})}
    >
      <div
        className={`absolute h-3 w-3 border-slate-200 bg-surface ${currentPlacement.arrow} ${arrowClassName}`}
      />
      <div
        className={`relative w-max max-w-sm whitespace-normal rounded-lg border border-slate-200 bg-surface p-2.5 text-xs font-normal text-slate-600 shadow-lg ${contentClassName}`}
      >
        {children}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={`relative inline-flex ${className}`}
      ref={setContainerRef}
      {...(hover ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave } : {})}
    >
      <div onClick={toggle} className="cursor-pointer">
        {trigger}
      </div>
      {portal && content && typeof document !== "undefined"
        ? createPortal(content, document.body)
        : content}
    </div>
  );
}
