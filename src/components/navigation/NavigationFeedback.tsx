"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  useTransition,
  type ComponentProps,
  type ReactNode,
} from "react";

import { Spinner } from "@/components/ui/spinner";

type FeedbackAction = () => void | Promise<void>;
type FeedbackContext = {
  router: ReturnType<typeof useRouter>;
  run: (action: FeedbackAction) => void;
};

const NavigationFeedbackContext = createContext<FeedbackContext | null>(null);

/** Own the transition above menus, which unmount as soon as an action is chosen. */
export function NavigationFeedbackProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, run] = useTransition();
  // Keep the context stable: streamed page boundaries must not client-render
  // again just because the shell's pending indicator changed.
  const feedback = useMemo<FeedbackContext>(() => ({
    run: (action) => {
      // Start the action first: its disabled/error state must be urgent, not
      // deferred until the async transition finishes. Track its promise only.
      const pending = action();
      run(() => pending);
    },
    router: {
      ...router,
      push: (...args) => run(() => router.push(...args)),
      replace: (...args) => run(() => router.replace(...args)),
      refresh: () => run(() => router.refresh()),
      back: () => run(() => router.back()),
      forward: () => run(() => router.forward()),
    },
  }), [router, run]);

  return (
    <NavigationFeedbackContext value={feedback}>
      {children}
      {isPending ? (
        <div className="navigation-feedback no-print" role="status" aria-live="polite" aria-atomic="true">
          <div className="navigation-feedback__track" aria-hidden="true">
            <span className="navigation-feedback__bar" />
          </div>
          <div className="navigation-feedback__label">
            <Spinner aria-hidden="true" role={undefined} />
            <span>Chargement en cours…</span>
          </div>
        </div>
      ) : null}
    </NavigationFeedbackContext>
  );
}

/** Programmatic navigation and refresh share the shell's actual React transition. */
export function useFeedbackRouter() {
  const router = useRouter();
  return useContext(NavigationFeedbackContext)?.router ?? router;
}

export function useActionFeedback() {
  return useContext(NavigationFeedbackContext)?.run ?? runWithoutFeedback;
}

function runWithoutFeedback(action: FeedbackAction) {
  void action();
}

/** Retain Next's prefetch, modified clicks, downloads and native link semantics. */
export function NavigationLink({
  href,
  replace,
  scroll,
  onNavigate,
  ...props
}: ComponentProps<typeof Link>) {
  const feedback = useContext(NavigationFeedbackContext);

  return (
    <Link
      {...props}
      href={href}
      replace={replace}
      scroll={scroll}
      onNavigate={(event) => {
        let prevented = false;
        onNavigate?.({ preventDefault: () => {
          prevented = true;
          event.preventDefault();
        } });
        if (prevented || !feedback || typeof href !== "string" || props.as) return;

        const target = new URL(href, window.location.href);
        // In-page anchors and already active links need no loading feedback.
        if (target.pathname === window.location.pathname && target.search === window.location.search) return;

        event.preventDefault();
        feedback.router[replace ? "replace" : "push"](href, { scroll });
      }}
    />
  );
}
