import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * False in the server HTML and during hydration, true once React owns the
 * client tree. Gate a control whose action exists only in a client handler, so
 * a press that lands before hydration is refused visibly instead of lost.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
