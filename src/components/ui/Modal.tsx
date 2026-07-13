"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";

type ModalContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
};

const ModalContext = createContext<ModalContextValue | null>(null);

function useModalContext() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("Modal compound components must be used inside Modal.Root");
  }
  return context;
}

function findFocusableNodes(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    )
  ).filter((node) => !node.hasAttribute("disabled") && node.getAttribute("aria-hidden") !== "true");
}

type ModalRootProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

function Root({ open, onOpenChange, children }: Readonly<ModalRootProps>) {
  const titleId = useId();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    if (typeof document !== "undefined") {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      const dialog = contentRef.current;
      const modalRoot = dialog?.closest<HTMLElement>("[data-ui-modal-root]");
      const backgroundNodes = Array.from(document.body.children).filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement &&
          node !== modalRoot &&
          !node.contains(dialog) &&
          !["SCRIPT", "STYLE", "LINK"].includes(node.tagName)
      );
      const backgroundState = backgroundNodes.map((node) => ({
        node,
        inert: Boolean(node.inert),
        ariaHidden: node.getAttribute("aria-hidden"),
      }));

      backgroundNodes.forEach((node) => {
        node.inert = true;
        node.setAttribute("aria-hidden", "true");
      });

      const timer = window.setTimeout(() => {
        const container = contentRef.current;
        if (!container) return;
        const focusable = findFocusableNodes(container);
        const preferred = container.querySelector<HTMLElement>(
          "[data-modal-autofocus='true'], [autofocus]"
        );
        const initialFocus =
          preferred && focusable.includes(preferred) ? preferred : focusable[0];
        if (initialFocus) {
          initialFocus.focus();
        } else {
          container.focus();
        }
      }, 0);

      return () => {
        window.clearTimeout(timer);
        document.body.style.overflow = originalOverflow;
        backgroundState.forEach(({ node, inert, ariaHidden }) => {
          node.inert = inert;
          if (ariaHidden === null) {
            node.removeAttribute("aria-hidden");
          } else {
            node.setAttribute("aria-hidden", ariaHidden);
          }
        });
        previousFocusRef.current?.focus();
      };
    }

    return;
  }, [open]);

  const value = useMemo(
    () => ({
      open,
      onOpenChange,
      titleId,
      contentRef,
    }),
    [open, onOpenChange, titleId]
  );

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

type ModalContentProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
  closeOnOverlayClick?: boolean;
  closeOnEscapeKey?: boolean;
  containerClassName?: string;
};

function Content({
  children,
  className,
  closeOnOverlayClick = true,
  closeOnEscapeKey = true,
  containerClassName,
  ...props
}: Readonly<ModalContentProps>) {
  const { open, onOpenChange, titleId, contentRef } = useModalContext();

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div
          data-ui-modal-root="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgb(2_6_23_/_0.45)] p-4"
        >
          <button
            aria-hidden="true"
            data-ui-modal-overlay="true"
            type="button"
            tabIndex={-1}
            className="absolute inset-0 cursor-default border-0 bg-transparent p-0 focus-visible:outline-none"
            onMouseDown={() => {
              if (closeOnOverlayClick) {
                onOpenChange(false);
              }
            }}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "relative z-10 w-full max-w-[calc(100vw-2rem)] sm:max-w-2xl",
              containerClassName
            )}
          >
            <div
              {...props}
              ref={contentRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              className={cn(
                "rounded-[18px] border border-slate-200 bg-surface p-6 shadow-modal",
                className
              )}
              onMouseDown={(event) => {
                event.stopPropagation();
                props.onMouseDown?.(event);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (closeOnEscapeKey) {
                    onOpenChange(false);
                  }
                }

                if (event.key === "Tab") {
                  if (typeof document === "undefined") return;
                  const container = contentRef.current;
                  if (!container) return;
                  const focusable = findFocusableNodes(container);
                  if (focusable.length === 0) return;

                  const currentIndex = focusable.findIndex((element) => element === document.activeElement);

                  if (event.shiftKey) {
                    if (currentIndex <= 0) {
                      event.preventDefault();
                      focusable[focusable.length - 1]?.focus();
                    }
                  } else if (currentIndex === focusable.length - 1) {
                    event.preventDefault();
                    focusable[0]?.focus();
                  }
                }

                props.onKeyDown?.(event);
              }}
            >
              {children}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

function Header({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex items-start justify-between gap-4", className)} {...props} />;
}

function Title({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useModalContext();
  return (
    <h2
      id={titleId}
      className={cn("typo-h3 text-slate-800", className)}
      {...props}
    />
  );
}

function Body({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-4", className)} {...props} />;
}

function Footer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mt-6 flex flex-wrap items-center justify-end gap-3", className)} {...props} />
  );
}

type ModalCloseProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

function Close({ className, children = "Fermer", ...props }: Readonly<ModalCloseProps>) {
  const { onOpenChange } = useModalContext();
  return (
    <button
      type="button"
      className={cn(
        "font-body inline-flex h-11 min-w-11 items-center justify-center rounded-button-sm px-3 text-sm font-medium sm:h-8 sm:min-w-8",
        "text-slate-600 transition hover:bg-slate-100 hover:text-slate-900",
        className
      )}
      onClick={(event) => {
        onOpenChange(false);
        props.onClick?.(event);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export const Modal = {
  Root,
  Content,
  Header,
  Title,
  Body,
  Footer,
  Close,
};
