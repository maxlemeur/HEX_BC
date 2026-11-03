import { waitFor } from "@testing-library/react";
import { onTestFinished } from "vitest";

/**
 * Runs `action` in the first DOM mutation callback where `isShown()` holds, i.e. right after
 * React committed that render (DOM and layout effects) and before it runs the render's passive
 * effects: react-dom requests a paint at commit, so the scheduler yields and leaves `useEffect`
 * work to a later task. A click or a key aimed at what just appeared lands there in a browser,
 * and `findBy*` sometimes resolves there under CI load. Use it to replay that ordering every time.
 *
 * Register it before the change that shows the element (not inside `act`, which flushes the
 * effects first), then await `done()`, which waits like `findBy*` and rethrows the action's error.
 */
export function beforePassiveEffectsOf(isShown: () => boolean, action: () => void) {
  if (isShown()) throw new Error("Register beforePassiveEffectsOf before the change that shows the element.");
  let ran = false;
  let failure: unknown = null;
  const observer = new MutationObserver(() => {
    if (ran || !isShown()) return;
    ran = true;
    observer.disconnect();
    try {
      action();
    } catch (error) {
      failure = error;
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  onTestFinished(() => observer.disconnect());
  return {
    done: async () => {
      await waitFor(() => {
        if (!ran) throw new Error("The element was not shown.");
      });
      if (failure) throw failure;
    },
  };
}
